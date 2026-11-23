<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
use PDO;
use RuntimeException;
final class Center
{
    public function __construct(private readonly PDO $db,private readonly array $config) {}
    public function login(object $input,string $ip,int $now,bool $explainOtp=false): ?array
    {
        $email=is_string($input->email ?? null)?strtolower(trim($input->email)):'';
        $password=$input->password ?? ''; $otp=$input->otp ?? '';
        (new DealerLogin($this->db,$this->config['rateSecret']))->throttle('center-ip:'.$ip,$now);
        (new DealerLogin($this->db,$this->config['rateSecret']))->throttle('center-account:'.$email,$now);
        if(!is_string($password)||strlen($password)>512||!is_string($otp)) return null;
        $this->db->beginTransaction();
        try {
            $q=$this->db->prepare("SELECT a.* FROM identity_account a JOIN identity_center c ON c.account_id=a.id WHERE a.kind='center' AND a.identifier=? AND a.blocked=0 FOR UPDATE");
            $q->execute([$email]);$account=$q->fetch();
            if (!$account || !password_verify($password,(string)$account['password_hash'])) {
                $this->db->rollBack();
                error_log('VetZimo center login: account or password rejected');
                return null;
            }
            $secret=Totp::decrypt($account['totp_seed'],$this->config['encryptionKey'] ?? '');
            $step=Totp::verify($secret,trim($otp),$now,(int)$account['totp_step']);
            if ($step===null) {
                $this->db->rollBack();
                $reason=Totp::verify($secret,trim($otp),$now)!==null?'code already used':'code or clock mismatch';
                error_log('VetZimo center login: '.$reason);
                if ($explainOtp) throw new RuntimeException($reason==='code already used'
                    ? 'Bu kod daha önce kullanılmış. Doğrulama uygulamasındaki bir sonraki kodu girin.'
                    : 'Doğrulama kodu eşleşmedi. VetZimo kaydını ve telefonunuzun otomatik tarih ve saat ayarını kontrol edin.',422);
                return null;
            }
            $token=bin2hex(random_bytes(32));$device=bin2hex(random_bytes(32));
            $this->db->prepare('UPDATE identity_account SET totp_step=? WHERE id=?')->execute([$step,$account['id']]);
            $this->db->prepare('INSERT INTO identity_session(token_hash,device_hash,account_id,account_version,membership_id,created,touched,expires,reauth_at) VALUES (?,?,?,?,NULL,?,?,?,?)')
                ->execute([base64_encode(hash('sha256',$token,true)),base64_encode(hash('sha256',$device,true)),$account['id'],$account['version'],$now,$now,$now+3600,$now]);
            $this->audit($account['id'],'center.login');
            $this->db->commit();return ['token'=>$token,'device'=>$device,'age'=>3600,'destination'=>'/yonetim'];
        } catch(\Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
    }
    public function requireOwner(array $cookies,int $now,bool $write=false): array
    {
        $actor=(new SessionRepository($this->db))->resolve($cookies,$now);
        if(!$actor||$actor['kind']!=='center'||!(int)$actor['is_owner']) throw new RuntimeException('Merkez yöneticisi yetkisi gerekli.',403);
        if($write&&$now-(int)$actor['reauth_at']>300) throw new RuntimeException('Bu işlem için yeni doğrulama koduyla tekrar giriş yapın.',403);
        return $actor;
    }
    public function partners(array $actor): array
    {
        return $this->partnerDirectory();
    }
    public function partnerPage(mixed $requested,mixed $search,mixed $status): array
    {
        if (!is_string($requested)||!preg_match('/\A[1-9][0-9]{0,8}\z/D',$requested)||
            !is_string($search)||!preg_match('/\A.{0,120}\z/us',$search)||
            !in_array($status,['','active','closed'],true)) throw new RuntimeException('Bayi listesi filtresi geçersiz.',422);
        $where=' WHERE 1=1';
        $params=[];
        if ($status!=='') {
            $where.=' AND p.active=?';
            $params[]=$status==='active'?1:0;
        }
        if (trim($search)!=='') {
            $where.=" AND CONCAT_WS(' ',p.name,p.code,p.email,p.phone) COLLATE utf8mb4_turkish_ci LIKE ? ESCAPE '!'";
            $params[]='%'.strtr(trim($search),['!'=>'!!','%'=>'!%','_'=>'!_']).'%';
        }
        $count=$this->db->prepare('SELECT COUNT(*) FROM partner_account p'.$where);
        $count->execute($params);
        $total=(int)$count->fetchColumn();
        $pages=max(1,(int)ceil($total/25));
        $page=min((int)$requested,$pages);
        return ['partners'=>$this->partnerDirectory($where,$params,($page-1)*25),'page'=>$page,'pages'=>$pages,'total'=>$total];
    }
    private function partnerDirectory(string $where='',array $params=[],?int $offset=null): array
    {
        $source=$offset===null?'partner_account p':"(SELECT id,code,name,email,phone,active,created_at
            FROM partner_account p".$where." ORDER BY p.name,p.id LIMIT 25 OFFSET ".$offset.") p";
        $query=$this->db->prepare("SELECT p.id,p.code,p.name,p.email,p.phone,p.active,p.created_at,
            COALESCE(w.branch_count,0) AS branches,COALESCE(s.client_count,w.client_count,0) AS clients,COALESCE(s.patient_count,w.patient_count,0) AS patients,
            (SELECT COUNT(DISTINCT m.account_id) FROM identity_membership m WHERE m.partner_id=p.id AND m.status='active') AS users
            FROM ".$source." LEFT JOIN clinic_workspace w ON w.user_id=CONCAT('partner:',p.id) LEFT JOIN clinic_record_set s ON s.workspace_id=w.user_id ORDER BY p.name,p.id");
        $query->execute($params);
        $rows=$query->fetchAll();
        foreach ($rows as &$row) foreach (['branches','clients','patients','users'] as $key) $row[$key]=(int)$row[$key];
        unset($row);
        return $rows;
    }
    public function details(string $id): array
    {
        $q=$this->db->prepare('SELECT id,name,code,email,phone,active FROM partner_account WHERE id=?');$q->execute([$id]);$partner=$q->fetch();
        if(!$partner) throw new RuntimeException('Bayi bulunamadı.',404);
        $branches=(new WorkspaceRepository($this->db))->branches('partner:'.$id);
        $q=$this->db->prepare('SELECT m.id,m.name,m.role,m.branch_id,m.status,m.modules,a.identifier AS phone FROM identity_membership m JOIN identity_account a ON a.id=m.account_id WHERE m.partner_id=? ORDER BY m.name');$q->execute([$id]);
        return ['partner'=>$partner,'branches'=>$branches,'members'=>$q->fetchAll()];
    }
    public function reauthenticate(array $actor, array $cookies, object $body, string $ip, int $now): void
    {
        $limiter = new DealerLogin($this->db,$this->config['rateSecret']);
        $limiter->throttle('center-reauth-ip:'.$ip,$now);
        $limiter->throttle('center-reauth-account:'.$actor['account_id'],$now);
        $password = $body->password ?? null;
        $otp = $body->otp ?? null;
        if (!is_string($password) || strlen($password)>512 || !is_string($otp)) {
            throw new RuntimeException('Şifre ve altı haneli doğrulama kodu gerekli.',422);
        }
        $this->db->beginTransaction();
        try {
            $query = $this->db->prepare("SELECT password_hash,totp_seed,totp_step FROM identity_account WHERE id=? AND blocked=0 FOR UPDATE");
            $query->execute([$actor['account_id']]);
            $account = $query->fetch();
            if (!$account || !password_verify($password,$account['password_hash'])) {
                throw new RuntimeException('Mevcut yönetici şifresi doğrulanamadı.',422);
            }
            $step = Totp::verify(Totp::decrypt($account['totp_seed'],$this->config['encryptionKey']),$otp,$now,(int)$account['totp_step']);
            if ($step === null) {
                throw new RuntimeException('Kod geçersiz, süresi geçmiş veya kullanılmış. Uygulamada bir sonraki altı haneli kodu bekleyin.',422);
            }
            $session = (new SessionRepository($this->db))->resolve($cookies,$now,true);
            if (!$session || $session['account_id'] !== $actor['account_id']) {
                throw new RuntimeException('Yönetici oturumu sona erdi. Yeniden giriş yapın.',401);
            }
            $this->db->prepare('UPDATE identity_account SET totp_step=? WHERE id=?')->execute([$step,$actor['account_id']]);
            $token = base64_encode(hash('sha256',$cookies[SessionRepository::SESSION_COOKIE],true));
            $this->db->prepare('UPDATE identity_session SET reauth_at=? WHERE token_hash=? AND account_id=?')->execute([$now,$token,$actor['account_id']]);
            $this->audit($actor['account_id'],'center.reauth');
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function finance(string $month): array
    {
        if (!preg_match('/\A20[0-9]{2}-(?:0[1-9]|1[0-2])\z/',$month)) {
            throw new RuntimeException('Geçerli bir ay seçin.',422);
        }
        $start = new \DateTimeImmutable($month.'-01');
        $dates = [$start->format('Y-m-d'),$start->modify('+1 month')->format('Y-m-d')];
        $query = $this->db->prepare('SELECT source_type,COUNT(*) AS quantity,SUM(amount_cents) AS cents FROM finance_entry WHERE entry_date>=? AND entry_date<? GROUP BY source_type');
        $query->execute($dates);
        $totals = $query->fetchAll();
        $query = $this->db->prepare('SELECT f.entry_date,f.source_type,f.amount_cents,p.name FROM finance_entry f JOIN partner_account p ON p.id=f.partner_id WHERE f.entry_date>=? AND f.entry_date<? ORDER BY f.entry_date DESC,f.id DESC LIMIT 300');
        $query->execute($dates);
        return ['totals'=>$totals,'entries'=>$query->fetchAll()];
    }

    public function partnerFinance(string $partner, array $filters): array
    {
        $this->details($partner);
        $today=new \DateTimeImmutable('today',new \DateTimeZone('Europe/Istanbul'));
        $period=$filters['period'] ?? 'month';
        $range=match($period) {
            'day'=>[$today,$today],
            'week'=>[$today->modify('monday this week'),$today],
            'month'=>[$today->modify('first day of this month'),$today],
            'all'=>null,
            'custom'=>[$this->financeDate($filters['from'] ?? null),$this->financeDate($filters['to'] ?? null)],
            default=>throw new RuntimeException('Geçerli dönem seçin.',422)
        };
        if ($range && $range[0]>$range[1]) throw new RuntimeException('Başlangıç bitişten sonra olamaz.',422);
        $where='f.partner_id=?';
        $args=[$partner];
        if ($range) {
            $where.=' AND f.entry_date BETWEEN ? AND ?';
            $args[]=$range[0]->format('Y-m-d');
            $args[]=$range[1]->format('Y-m-d');
        }
        $q=$this->db->prepare("SELECT COALESCE(SUM(CASE WHEN (amount_cents>0 AND source_type NOT IN ('purchases','payments_void','cash_adjust_expense')) OR source_type IN ('sales_void','collections_void','cash_adjust_income') THEN amount_cents ELSE 0 END),0) AS income,
            COALESCE(SUM(CASE WHEN (amount_cents<0 AND source_type NOT IN ('sales_void','collections_void','cash_adjust_income')) OR source_type IN ('payments_void','cash_adjust_expense') THEN -amount_cents ELSE 0 END),0) AS expense FROM finance_entry f WHERE $where");
        $q->execute($args);
        $totals=$q->fetch();
        $q=$this->db->prepare("SELECT entry_date,source_type,amount_cents,branch_id FROM finance_entry f WHERE $where ORDER BY entry_date DESC,id DESC LIMIT 300");
        $q->execute($args);
        return ['totals'=>$totals,'entries'=>$q->fetchAll()];
    }

    private function financeDate(mixed $value): \DateTimeImmutable
    {
        $date=is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d',$value) : false;
        if (!$date || $date->format('Y-m-d')!==$value) throw new RuntimeException('Geçerli tarih aralığı girin.',422);
        return $date;
    }

    public function overview(): array
    {
        $metrics = $this->db->query("SELECT
            (SELECT COUNT(*) FROM partner_account) AS partners,
            (SELECT COUNT(*) FROM partner_account WHERE active=1) AS active,
            (SELECT COUNT(*) FROM identity_membership WHERE status='active' AND role<>'customer') AS team,
            (SELECT COUNT(*) FROM clinic_lead WHERE stage='new') AS applications,
            (SELECT COUNT(*) FROM clinic_support WHERE status='Açık') AS support")->fetch();
        $today = new \DateTimeImmutable('today', new \DateTimeZone('Europe/Istanbul'));
        $query = $this->db->prepare('SELECT COUNT(DISTINCT partner_id) FROM clinic_subscription WHERE starts_on<=? AND ends_on>=?');
        $query->execute([$today->format('Y-m-d'),$today->format('Y-m-d')]);
        $metrics['subscriptions'] = (int)$query->fetchColumn();
        $query = $this->db->prepare("SELECT COALESCE(SUM(amount_cents),0) FROM finance_entry WHERE entry_date=? AND source_type IN ('sales','collections','sales_void','collections_void')");
        $query->execute([$today->format('Y-m-d')]);
        $metrics['receipts'] = (int)$query->fetchColumn();
        $daily = $this->db->prepare("SELECT DATE(created_at) AS day,COUNT(*) AS total FROM clinic_lead WHERE created_at>=? GROUP BY DATE(created_at)");
        $daily->execute([$today->modify('-29 days')->format('Y-m-d')]);
        $stages = $this->db->query('SELECT stage, COUNT(*) AS total FROM clinic_lead GROUP BY stage')->fetchAll();
        return ['metrics'=>$metrics,'day'=>$today->format('Y-m-d'),'daily'=>$daily->fetchAll(),'stages'=>$stages];
    }

    public function savePermissions(array $actor, object $input): void
    {
        $partner = $input->partnerId ?? null;
        $member = $input->membershipId ?? null;
        if (!is_string($partner) || !is_string($member) || !is_object($input->modules ?? null)) {
            throw new RuntimeException('Bayi, üyelik ve izinleri kontrol edin.',422);
        }
        $this->db->beginTransaction();
        try {
            $query = $this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');
            $query->execute([$partner]);
            if (!$query->fetchColumn()) throw new RuntimeException('Bayi bulunamadı.',404);
            $query = $this->db->prepare("SELECT role FROM identity_membership WHERE id=? AND partner_id=?
                AND role IN ('branch','staff','customer') AND status IN ('active','pending') FOR UPDATE");
            $query->execute([$member,$partner]);
            $role = $query->fetchColumn();
            if (!$role) throw new RuntimeException('Düzenlenebilir üyelik bulunamadı.',404);
            $modules = IdentityApi::grants($role,$input->modules);
            $this->db->prepare('UPDATE identity_membership SET modules=? WHERE id=? AND partner_id=?')->execute([$modules,$member,$partner]);
            $this->db->prepare('DELETE FROM identity_session WHERE membership_id=?')->execute([$member]);
            $this->audit($actor['account_id'],'membership.permissions',$member);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function create(array $actor,object $input,int $now): array
    {
        $name=$input->name ?? ''; $phone=is_string($input->phone ?? null)?DealerLogin::normalizePhone($input->phone):'';
        $email=is_string($input->email ?? null)?strtolower(trim($input->email)):'';
        if(!is_string($name)||trim($name)===''||strlen($name)>160||!$phone||!filter_var($email,FILTER_VALIDATE_EMAIL)||strlen($email)>254) throw new RuntimeException('Bayi adı, telefon ve e-posta gerekli.',422);
        $state=json_decode(file_get_contents(dirname(__DIR__).'/initial-workspace.json'));
        $state->preferences->clinic=$name;$state->branches[0]->name='Merkez';$state->branches[0]->city='';
        $ownsTransaction=!$this->db->inTransaction();
        if ($ownsTransaction) $this->db->beginTransaction();
        try {
            $partner=bin2hex(random_bytes(16));$stamp=gmdate('c',$now);
            $this->db->prepare('INSERT INTO partner_account(id,code,name,email,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')->execute([$partner,strtoupper(substr($partner,0,12)),$name,$email,$phone,$stamp,$stamp]);
            $q=$this->db->prepare("SELECT id FROM identity_account WHERE kind='phone' AND identifier=? FOR UPDATE");$q->execute([$phone]);$account=$q->fetchColumn();
            if(!$account){$account=bin2hex(random_bytes(16));$this->db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES (?,'phone',?)")->execute([$account,$phone]);}
            $member=bin2hex(random_bytes(16));
            $this->db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES (?,?,?,'dealer',?,'{}','pending')")->execute([$member,$account,$partner,$name]);
            (new WorkspaceRepository($this->db))->save('partner:'.$partner, 0, $state);
            $token=bin2hex(random_bytes(32));
            $this->db->prepare('INSERT INTO identity_activation(token_hash,membership_id,expires) VALUES (?,?,?)')->execute([hash('sha256',$token),$member,$now+900]);
            $this->audit($actor['account_id'],'partner.created',$partner);
            if ($ownsTransaction) $this->db->commit();
            return ['id'=>$partner,'link'=>'/giris#aktivasyon/'.$token];
        } catch(\Throwable $e){if ($ownsTransaction) $this->db->rollBack();throw $e;}
    }
    public function toggle(array $actor,object $input,int $now): void
    {
        if(!is_string($input->partnerId ?? null)||!is_bool($input->active ?? null)) throw new RuntimeException('Bayi durumu geçersiz.',422);
        $this->db->beginTransaction();
        try {
            $q=$this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');$q->execute([$input->partnerId]);if(!$q->fetch())throw new RuntimeException('Bayi bulunamadı.',404);
            $this->db->prepare('UPDATE partner_account SET active=?,updated_at=? WHERE id=?')->execute([(int)$input->active,gmdate('c',$now),$input->partnerId]);
            if(!$input->active) $this->db->prepare('DELETE s FROM identity_session s JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id=?')->execute([$input->partnerId]);
            $this->audit($actor['account_id'],$input->active?'partner.enabled':'partner.disabled',$input->partnerId);$this->db->commit();
        } catch(\Throwable $e){$this->db->rollBack();throw $e;}
    }
    public function audit(string $account,string $action,string $target=''): void
    {
        $this->db->prepare('INSERT INTO center_audit(account_id,action,target_id) VALUES (?,?,?)')->execute([$account,$action,$target]);
    }
}
