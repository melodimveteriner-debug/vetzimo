<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
use PDO;
use RuntimeException;

final class IdentityApi
{
    public function __construct(private readonly PDO $db) {}
    public function actor(array $cookies,int $now): array
    {
        $actor=(new SessionRepository($this->db))->resolve($cookies,$now);
        if (!$actor || !ClinicAccess::valid($actor,$this->validationState($actor))) throw new RuntimeException('Oturum doğrulanamadı.',401);
        return $actor;
    }
    /**
     * Yetki denetimi yalnız şubelere ve (hasta sahibinde) kendi müşteri kaydına bakar; büyük klinikte
     * tüm alanı yüklemez. Kayıt bulunamazsa (eski biçimli alan) güvenli tam yüklemeye geçer.
     */
    private function validationState(array $actor): ?object
    {
        $customer=($actor['role'] ?? '')==='customer'?(string)($actor['customer_id'] ?? ''):'';
        $state=(new ClinicRecords($this->db))->slice('partner:'.$actor['partner_id'],['clients'=>$customer===''?[]:[$customer]]);
        if ($state && ($customer==='' || $state->clients)) return $state;
        return $this->state($actor);
    }
    private function state(array $actor): ?object
    {
        // Ekip, paylaşım ve görsel işlemleri yalnız sahip/hasta/muayene/tetkik listelerini kullanır (salt okunur).
        return (new ClinicRecords($this->db))->collections('partner:'.$actor['partner_id'],['clients','patients','exams','labs'])
            ?? (new WorkspaceRepository($this->db))->load('partner:'.$actor['partner_id'])['state'];
    }
    public function members(array $actor): array
    {
        $q=$this->db->prepare("SELECT m.*,a.identifier,p.name AS partner_name,p.phone AS partner_phone FROM identity_membership m JOIN identity_account a ON a.id=m.account_id JOIN partner_account p ON p.id=m.partner_id WHERE m.account_id=? AND m.status='active' AND p.active=1 ORDER BY p.name,m.role");
        $q->execute([$actor['account_id']]);
        $result=[];
        foreach ($q->fetchAll() as $row) {
            $state=$this->validationState($row);
            if (!ClinicAccess::valid($row,$state)) continue;
            $branch=$state?ClinicAccess::branch($state,$row['branch_id']):null;
            $result[]=['id'=>$row['id'],'partner'=>$row['partner_name'],'branch'=>$branch->name ?? '',
                'phone'=>$branch->phone ?? $row['partner_phone'],'role'=>$row['role']];
        }
        return $result;
    }
    public function session(array $actor,int $now): array
    {
        $members=$this->members($actor);
        $active=null;
        foreach($members as $member) if($member['id']===$actor['membership_id']) $active=$member;
        return ['kind'=>'phone','scopeId'=>$actor['membership_id'],'active'=>$active,'members'=>$members,'reauthRequired'=>$now-(int)$actor['reauth_at']>300,'previewReauth'=>false];
    }
    public function select(array $cookies,array $actor,string $id,int $now): void
    {
        $allowed=array_column($this->members($actor),'id');
        if (!in_array($id,$allowed,true)) throw new RuntimeException('Bu kurumda yetkiniz yok.',403);
        $q=$this->db->prepare("UPDATE identity_session SET membership_id=? WHERE token_hash=? AND account_id=?");
        $q->execute([$id,base64_encode(hash('sha256',$cookies[SessionRepository::SESSION_COOKIE],true)),$actor['account_id']]);
        if ($id!==$actor['membership_id']) {
            // Uygulama cihazı yeni çalışma alanına taşınır; bildirimler hesap bazında gelmeye devam eder.
            try {
                $this->db->prepare('UPDATE app_device SET membership_id=? WHERE session_device=? AND account_id=?')
                    ->execute([$id,base64_encode(hash('sha256',$cookies[SessionRepository::DEVICE_COOKIE],true)),$actor['account_id']]);
            } catch (\PDOException) {}
        }
    }
    public function reauth(array $cookies,array $actor,string $password,int $now): void
    {
        $q=$this->db->prepare('SELECT password_hash FROM identity_account WHERE id=?');
        $q->execute([$actor['account_id']]);
        if(strlen($password)>512 || !password_verify($password,(string)$q->fetchColumn())) throw new RuntimeException('Şifre doğrulanamadı.',403);
        $this->db->prepare('UPDATE identity_session SET reauth_at=? WHERE token_hash=? AND account_id=?')->execute([$now,base64_encode(hash('sha256',$cookies[SessionRepository::SESSION_COOKIE],true)),$actor['account_id']]);
    }
    public function directory(array $actor): array
    {
        if($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $state=(new ClinicRecords($this->db))->collections('partner:'.$actor['partner_id'],['clients','patients','exams','labs']) ?? $this->state($actor);
        $q=$this->db->prepare("SELECT m.id,m.role,m.branch_id,m.customer_id,m.name,m.status,m.modules,a.identifier AS phone FROM identity_membership m JOIN identity_account a ON a.id=m.account_id WHERE m.partner_id=? AND m.role<>'dealer' ORDER BY m.name");
        $q->execute([$actor['partner_id']]);
        $members=$q->fetchAll();
        $count=$this->db->prepare("SELECT COUNT(DISTINCT account_id) FROM identity_membership WHERE partner_id=? AND role IN ('branch','staff') AND status<>'revoked'");
        $count->execute([$actor['partner_id']]);
        $records=['exam'=>[],'lab'=>[],'xray'=>[]];
        $patients=array_column($state->patients ?? [],null,'id');
        foreach (['exam'=>'exams','lab'=>'labs','xray'=>'labs'] as $category=>$collection) {
            foreach ($state->$collection ?? [] as $row) {
                $patient=$patients[$row->patient ?? ''] ?? null;
                if ($patient && $patient->branch===$row->branch) {
                    $records[$category][]=['id'=>$row->id,'client'=>$patient->owner,'branch'=>$row->branch,
                        'title'=>$patient->name.' · '.($row->title ?? $row->type ?? $row->date ?? $row->id)];
                }
            }
        }
        $query=$this->db->prepare("SELECT s.membership_id,s.category,s.record_id,s.summary FROM clinic_portal_share s
            JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id=? ORDER BY s.created_at DESC");
        $query->execute([$actor['partner_id']]);
        $shares=$query->fetchAll();
        return ['staffSetup'=>true,'partnerId'=>$actor['partner_id'],'branches'=>$state->branches,'clients'=>$state->clients,'members'=>$members,'sharedRecords'=>$records,'shares'=>$shares,
            'quotas'=>(function() use ($actor,$count){$lim=(new Commerce($this->db))->packageActor(['partner_id'=>$actor['partner_id']])['packageLimits']??[];
                $u=$lim['users']??null;$br=$lim['branches']??null;
                return ['branchCap'=>$br??999999,'userCap'=>$u??999999,'unlimitedUsers'=>$u===null,'users'=>(int)$count->fetchColumn()];})()];
    }
    private function sensitive(array $actor,string $scope,int $now): void
    {
        if($actor['role']!=='dealer' || !hash_equals($actor['membership_id'],$scope)) throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        if($now-(int)$actor['reauth_at']>900) throw new RuntimeException('Kimliğinizi yeniden doğrulayın.',403);
    }
    public static function grants(string $role,object $input): string
    {
        $keys=$role==='customer'?ClinicAccess::CUSTOMER_SECTIONS:[...array_keys(ClinicAccess::MODULES),...array_unique(array_values(ClinicAccess::ACTION_GRANTS)),...array_keys(ClinicAccess::FEATURES)];
        $result=[];
        foreach($keys as $key) {
            $value=$input->$key ?? (isset(ClinicAccess::FEATURES[$key]) || ($role==='customer' && in_array($key,ClinicAccess::CUSTOMER_DEFAULT_ON,true)) ? ($role==='customer'?'read':'write') : 'none');
            if(!in_array($value,$role==='customer'?['none','read']:['none','read','write'],true)) throw new RuntimeException('İzin değeri geçersiz.',422);
            $result[$key]=$value;
        }
        return json_encode($result,JSON_THROW_ON_ERROR);
    }
    /** Aktivasyon bağlantısını seçilen yolla iletir (SMS: kliniğin hattından; e-posta; bu cihazda / yüz yüze: bağlantı döner). */
    private function deliverActivation(array $actor,string $id,string $phone,string $method,string $email,string $token,int $now,array $config): array
    {
        $link=rtrim((string)($config['origin'] ?? ''),'/').'/app#aktivasyon/'.$token;
        if ($method==='in-person'||$method==='device') return ['status'=>$method==='device'?'device':'pending','link'=>$link];
        if ($method==='sms') {
            // Kliniğin kendi hattından (Telefon Bağlantısı); hat yoksa bağlantı ekranda gösterilir, elle/WhatsApp ile paylaşılır.
            $clinic=(string)($this->db->query('SELECT name FROM partner_account WHERE id='.$this->db->quote($actor['partner_id']))->fetchColumn() ?: 'Kliniğiniz');
            $text=$clinic.' sizi VetZimo\'ya davet etti. Hesabınızı açmak için (24 saat geçerli): '.$link;
            try {
                $gw=new PhoneGateway($this->db);
                if ($gw->route($actor['partner_id'],'sms')) {
                    $gw->enqueue($actor['partner_id'],'sms',$phone,$text,'manual','invite:'.$id.':'.$now,0,$now,$now+86400,(string)($actor['name'] ?? ''));
                    return ['status'=>'sms_queued','link'=>$link];
                }
            } catch (RuntimeException $e) { if ($e->getCode()===429) throw $e; }
            catch (\Throwable) {}
            return ['status'=>'sms_unavailable','link'=>$link,'share'=>$text];
        }
        try {
            (new Notifications($this->db,$config['encryptionKey']??''))->send('smtp',$email,'VetZimo · Hesabınızı açın',
                "Kliniğiniz VetZimo üyeliğinizi oluşturdu. Şifrenizi belirlemek veya mevcut hesabınızla üyeliği etkinleştirmek için 24 saat içinde bu bağlantıyı açın.\n\n".$link);
            return ['status'=>'email_sent'];
        } catch (\Throwable $error) {
            return ['status'=>'email_failed','link'=>$link];
        }
    }

    /** Aktivasyon bekleyen üyeliğe yeni bağlantı: SMS, e-posta veya bu cihazda. Eski bağlantılar geçersiz olur. */
    public function resend(array $actor,string $scope,object $input,int $now,array $config=[]): array
    {
        $this->sensitive($actor,$scope,$now);
        $id=$input->membershipId ?? '';
        $method=$input->method ?? '';
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/',$id) || !in_array($method,['sms','email','device'],true)) throw new RuntimeException('Üyelik ve gönderim yolunu seçin.',422);
        $email=is_string($input->email ?? null)?trim($input->email):'';
        if ($method==='email' && (strlen($email)>254 || !filter_var($email,FILTER_VALIDATE_EMAIL))) throw new RuntimeException('Geçerli bir e-posta adresi girin.',422);
        $q=$this->db->prepare("SELECT m.id,a.identifier AS phone FROM identity_membership m JOIN identity_account a ON a.id=m.account_id WHERE m.id=? AND m.partner_id=? AND m.status='pending' AND m.role IN ('branch','staff','customer')");
        $q->execute([$id,$actor['partner_id']]);
        $row=$q->fetch();
        if (!$row) throw new RuntimeException('Aktivasyon bekleyen üyelik bulunamadı.',404);
        $token=bin2hex(random_bytes(32));
        $this->db->beginTransaction();
        try {
            $this->db->prepare('UPDATE identity_activation SET used=1 WHERE membership_id=?')->execute([$id]);
            $this->db->prepare('INSERT INTO identity_activation(token_hash,membership_id,expires) VALUES (?,?,?)')->execute([hash('sha256',$token),$id,$now+($method==='device'?900:86400)]);
            $this->audit($actor,'membership.reinvited');
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollBack(); throw $e; }
        return $this->deliverActivation($actor,$id.':'.$now,$row['phone'],$method,$email,$token,$now,$config);
    }

    public function invite(array $actor,string $scope,object $input,int $now,array $config=[]): array
    {
        // Şube yöneticisi, personel ve hasta sahibi için aynı aktivasyon yöntemleri:
        // sms (kliniğin hattından bağlantı), email (bağlantı), device (bu cihazda açılır, kişi şifresini belirleyip onaylar),
        // in-person (kimlik yüz yüze doğrulandı), password (ekip hesabına şifreyi yönetici belirler; hasta sahibinde yok).
        $role=$input->role ?? '';
        $method=['staff-password'=>'password','staff-email'=>'email'][$input->method ?? ''] ?? ($input->method ?? '');
        $this->sensitive($actor,$scope,$now);
        if (!in_array($role,['branch','staff','customer'],true)) throw new RuntimeException('Hesap türü geçersiz.',422);
        if (!in_array($method,['sms','email','device','in-person','password'],true) || ($method==='password'&&$role==='customer')) throw new RuntimeException('Aktivasyon yöntemini seçin.',422);
        if ($method==='in-person'&&($input->verifiedInPerson??false)!==true) throw new RuntimeException('Yüz yüze aktivasyonda kimliği doğruladığınızı işaretleyin.',422);
        $staffSetup=in_array($method,['sms','email'],true); // uzaktan bağlantılar 24 saat geçerli
        $email=$input->email??'';
        if ($method==='email'&&(!is_string($email)||strlen($email)>254||!filter_var($email,FILTER_VALIDATE_EMAIL))) {
            throw new RuntimeException('Geçerli bir e-posta adresi girin.',422);
        }
        $password=$input->password??'';
        $direct=$method==='password';
        if ($direct&&(!is_string($password)||strlen($password)<12||strlen($password)>128)) throw new RuntimeException('En az 12 karakterli bir şifre girin.',422);
        $branchId=$input->branchId ?? '';
        if(!is_string($branchId) || !is_string($input->phone ?? null)) throw new RuntimeException('Hesap bilgileri geçersiz.',422);
        $phone=DealerLogin::normalizePhone($input->phone);
        if(!$phone) throw new RuntimeException('Cep telefonu geçersiz.',422);
        $name=$input->name ?? '';
        if(!is_string($name) || strlen($name)>160) throw new RuntimeException('Ad soyad geçersiz.',422);
        $modules=self::grants($role,is_object($input->modules ?? null)?$input->modules:(object)[]);
        $this->db->beginTransaction();
        try {
            $this->lockPartner($actor['partner_id']);
            $state=$this->state($actor);
            $branch=ClinicAccess::branch($state,$branchId);
            if(!$branch) throw new RuntimeException('Aktif şube seçin.',422);
            $customer='';
            if($role==='customer') {
                $customer=$input->customerId ?? '';
                $found=false;
                foreach($state->clients as $client) if($client->id===$customer && $client->branch===(($branch->sharedWith ?? '') ?: $branch->id) && DealerLogin::normalizePhone($client->phone ?? '')===$phone) { $name=$client->name; $found=true; }
                if(!$found) throw new RuntimeException('Hasta sahibi ve telefon eşleşmiyor.',422);
            }
            if(trim($name)==='') throw new RuntimeException('Ad soyad gerekli.',422);
            $q=$this->db->prepare("SELECT id,password_hash,blocked FROM identity_account WHERE kind='phone' AND identifier=? FOR UPDATE");
            $q->execute([$phone]); $account=$q->fetch();
            if (!empty($account['blocked'])) throw new RuntimeException('Bu telefon hesabı kapalı.',409);
            if ($direct&&!empty($account['password_hash'])) {
                throw new RuntimeException('Bu telefon için mevcut hesap var. Şifre değiştirilmeden üyelik açılması için e-posta bağlantısı seçin.',409);
            }
            if(!$account) {
                $account=['id'=>bin2hex(random_bytes(16))];
                $this->db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES (?,'phone',?)")->execute([$account['id'],$phone]);
            }
            if($role!=='customer') {
                $q=$this->db->prepare("SELECT DISTINCT account_id FROM identity_membership WHERE partner_id=? AND role IN ('branch','staff') AND status<>'revoked'");
                $q->execute([$actor['partner_id']]); $ids=$q->fetchAll(PDO::FETCH_COLUMN);
                $cap=(new Commerce($this->db))->packageActor(['partner_id'=>$actor['partner_id']])['packageLimits']['users']??null;
                if($cap!==null && count($ids)>=$cap && !in_array($account['id'],$ids,true)) {
                    throw new RuntimeException('Kullanıcı hakkınız bitmiştir ('.$cap.'). Kullanılmayan üyelikleri kapatın veya Abonelik mağazası › Ek paketler bölümünden ek kullanıcı alın.',422);
                }
            }
            $q=$this->db->prepare('SELECT id,status FROM identity_membership WHERE account_id=? AND partner_id=? AND role=? AND branch_id=? AND customer_id=?');
            $q->execute([$account['id'],$actor['partner_id'],$role,$branchId,$customer]);
            $existing=$q->fetch();
            if($existing) {
                // Bekleyen davet yeniden gönderilir (eski bağlantılar geçersiz olur); kapalı üyelik istenirse yeniden açılır.
                if($existing['status']==='active') throw new RuntimeException('Bu kişinin üyeliği zaten etkin. Şifre sıfırlama için üyelik kartını kullanın.',409);
                if($existing['status']!=='pending' && ($input->reopen??false)!==true) throw new RuntimeException('Bu üyelik kapatılmış. Yeniden açmak için "Kapalı üyeliği yeniden aç" kutusunu işaretleyin.',409);
                $id=$existing['id'];
                $this->db->prepare('UPDATE identity_activation SET used=1 WHERE membership_id=?')->execute([$id]);
                $this->db->prepare('UPDATE identity_membership SET name=?,modules=?,status=? WHERE id=?')->execute([$name,$modules,$direct?'active':'pending',$id]);
            } else {
                $id=bin2hex(random_bytes(16));
                $this->db->prepare('INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([$id,$account['id'],$actor['partner_id'],$role,$branchId,$customer,$name,$modules,$direct?'active':'pending']);
            }
            if ($direct) {
                $this->db->prepare('UPDATE identity_account SET password_hash=?,verified_at=?,version=version+1 WHERE id=?')
                    ->execute([password_hash($password,PASSWORD_ARGON2ID),$now,$account['id']]);
            } else {
                $token=bin2hex(random_bytes(32));
                $this->db->prepare('INSERT INTO identity_activation(token_hash,membership_id,expires) VALUES (?,?,?)')
                    ->execute([hash('sha256',$token),$id,$now+($staffSetup?86400:900)]);
            }
            $this->audit($actor,$direct?'membership.staff_created':'membership.invited');
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollBack(); throw $e; }
        if ($direct) return ['status'=>'active'];
        return $this->deliverActivation($actor,$id,$phone,$method,(string)$email,$token,$now,$config);
    }
    /** Aktivasyon bağlantısı ön bilgisi: hesap türü ve imzalanması gereken sözleşme. Bağlantıyı tüketmez. */
    public function activationInfo(string $token,int $now): array
    {
        if(!preg_match('/\A[a-f0-9]{64}\z/',$token)) throw new RuntimeException('Bağlantı geçersiz veya süresi dolmuş.',422);
        $q=$this->db->prepare("SELECT m.role,m.partner_id,p.name FROM identity_activation t JOIN identity_membership m ON m.id=t.membership_id JOIN partner_account p ON p.id=m.partner_id WHERE token_hash=? AND t.used=0 AND t.expires>? AND m.status='pending' AND p.active=1");
        $q->execute([hash('sha256',$token),$now]); $row=$q->fetch();
        if(!$row) throw new RuntimeException('Bağlantı geçersiz veya süresi dolmuş.',422);
        $agreement=new DealerAgreement($this->db);
        $required=$row['role']==='dealer' && !$agreement->signed($row['partner_id']);
        return ['role'=>$row['role'],'clinic'=>$row['name'],'agreementRequired'=>$required,'agreement'=>$required?$agreement->current():null];
    }
    /**
     * Şifremi unuttum: yalnız telefon numarası. Numara kayıtlıysa hasta sahibinin/ekibin bağlı olduğu kliniğin kendi hattından
     * 30 dakika geçerli yenileme bağlantısı gönderilir. Yanıt her durumda aynıdır (numaranın kayıtlı olup olmadığı açığa çıkmaz).
     */
    public function recover(object $input,int $now,array $config): array
    {
        $generic=['message'=>'Bu numaraya kayıtlı bir hesap varsa şifre yenileme bağlantısı kliniğinizin hattından SMS ile gönderildi. Birkaç dakika içinde gelmezse kliniğinizi arayın.'];
        $phone=DealerLogin::normalizePhone(is_string($input->phone ?? null)?$input->phone:'');
        if($phone==='') throw new RuntimeException('Geçerli bir cep telefonu numarası girin (05xx xxx xx xx).',422);
        $q=$this->db->prepare("SELECT a.id, m.partner_id, p.name, m.id AS mid, m.role, m.branch_id, m.customer_id, m.name AS mname FROM identity_account a JOIN identity_membership m ON m.account_id=a.id AND m.status='active'
            JOIN partner_account p ON p.id=m.partner_id AND p.active=1 WHERE a.kind='phone' AND a.identifier=? AND a.blocked=0 AND a.password_hash IS NOT NULL
            ORDER BY FIELD(m.role,'customer','staff','branch','dealer') DESC");
        $q->execute([$phone]);
        $rows=$q->fetchAll(PDO::FETCH_ASSOC);
        if(!$rows) return $generic;
        PasswordResets::ensure($this->db);
        $account=$rows[0]['id'];
        // Aynı hesaba 2 dakikada en fazla bir bağlantı (eşzamanlı isteklerde de: hesap satırı kilitlenir).
        $this->db->beginTransaction();
        try {
            $this->db->prepare('SELECT id FROM identity_account WHERE id=? FOR UPDATE')->execute([$account]);
            $last=$this->db->prepare('SELECT MAX(created) FROM identity_password_reset WHERE account_id=?'); $last->execute([$account]);
            if($now-(int)$last->fetchColumn()<120) { $this->db->commit(); return $generic; }
            // İstek kaydı açılır; SMS kliniğin hattından gider. Gidemezse klinik panelinde uyarı çıkar, ekip tek dokunuşla gönderir.
            (new PasswordResets($this->db))->request($account,$phone,$rows,(string)($config['origin'] ?? ''),$now);
            $this->db->commit();
        } catch(\Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        return $generic;
    }
    public static function ensureReset(PDO $db): void
    {
        $db->exec('CREATE TABLE IF NOT EXISTS identity_password_reset (token_hash CHAR(64) NOT NULL PRIMARY KEY, account_id VARCHAR(80) NOT NULL,
            created INT UNSIGNED NOT NULL, expires INT UNSIGNED NOT NULL, used TINYINT NOT NULL DEFAULT 0, KEY account (account_id)) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin');
    }
    /** Şifre yenileme bağlantısıyla yeni şifre: hesap sürümü artar, tüm oturumlar kapanır. */
    private function resetPassword(string $token,object $input,int $now): bool
    {
        try { $q=$this->db->prepare('SELECT account_id FROM identity_password_reset WHERE token_hash=? AND used=0 AND expires>? FOR UPDATE'); $q->execute([hash('sha256',$token),$now]); }
        catch(\PDOException $e) { if($e->getCode()==='42S02') return false; throw $e; }
        $account=$q->fetchColumn();
        if($account===false) return false;
        $password=$input->password ?? '';
        if(!is_string($password)||strlen($password)<12||strlen($password)>512) throw new RuntimeException('En az 12 karakterli bir şifre belirleyin.',422);
        $this->db->prepare('UPDATE identity_account SET password_hash=?,version=version+1 WHERE id=? AND blocked=0')->execute([password_hash($password,PASSWORD_ARGON2ID),$account]);
        $this->db->prepare('UPDATE identity_password_reset SET used=1 WHERE account_id=?')->execute([$account]);
        $this->db->prepare('DELETE FROM identity_session WHERE account_id=?')->execute([$account]);
        (new PasswordResets($this->db))->complete((string)$account,$now);
        return true;
    }
    public function redeem(object $input,int $now): void
    {
        $token=$input->token ?? '';
        if(!is_string($token)||!preg_match('/\A[a-f0-9]{64}\z/',$token)) throw new RuntimeException('Bağlantı geçersiz veya süresi dolmuş.',422);
        $this->db->beginTransaction();
        try { if($this->resetPassword($token,$input,$now)) { $this->db->commit(); return; } }
        catch(\Throwable $e) { $this->db->rollBack(); throw $e; }
        try {
            $q=$this->db->prepare("SELECT t.*,m.account_id,m.status,m.partner_id,m.role AS member_role,a.password_hash,a.blocked FROM identity_activation t JOIN identity_membership m ON m.id=t.membership_id JOIN identity_account a ON a.id=m.account_id JOIN partner_account p ON p.id=m.partner_id WHERE token_hash=? AND t.used=0 AND t.expires>? AND m.status='pending' AND a.blocked=0 AND p.active=1 FOR UPDATE");
            $q->execute([hash('sha256',$token),$now]); $row=$q->fetch();
            if(!$row) throw new RuntimeException('Bağlantı geçersiz veya süresi dolmuş.',422);
            if($row['password_hash']) {
                $password=$input->currentPassword ?? '';
                if(!is_string($password)||strlen($password)>512||!password_verify($password,$row['password_hash'])) throw new RuntimeException('Mevcut hesabınızın şifresini doğrulayın.',403);
            } else {
                $password=$input->password ?? '';
                if(!is_string($password)||strlen($password)<12||strlen($password)>512) throw new RuntimeException('En az 12 karakterli bir şifre belirleyin.',422);
                $this->db->prepare('UPDATE identity_account SET password_hash=?,verified_at=?,version=version+1 WHERE id=?')->execute([password_hash($password,PASSWORD_ARGON2ID),$now,$row['account_id']]);
            }
            // Bayi (deneme dahil) hesabı, VetZimo Kullanım Sözleşmesi imzalanmadan açılmaz.
            $agreement=new DealerAgreement($this->db);
            if ($row['member_role']==='dealer' && !$agreement->signed($row['partner_id'])) {
                $agreement->sign($row['partner_id'],$row['account_id'],$input->agreement ?? null,(string)($_SERVER['REMOTE_ADDR'] ?? ''),(string)($_SERVER['HTTP_USER_AGENT'] ?? ''),$now);
            }
            $this->db->prepare("UPDATE identity_membership SET status='active' WHERE id=?")->execute([$row['membership_id']]);
            $this->db->prepare('UPDATE identity_activation SET used=1 WHERE token_hash=?')->execute([hash('sha256',$token)]);
            $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$row['partner_id'],$row['account_id'],'membership.activated']);
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    /**
     * Görev şablonları (Danışma, Klinik personeli, Kasa personeli…): bayi adını ve izinlerini düzenler, yenisini ekler.
     * Şablon yalnız bir izin kalıbıdır; personele uygulandığında üyeliğin kendi izinleri olarak yazılır ve sunucu onu uygular.
     * Şablonda belirtilmeyen her izin KAPALI sayılır (açıkça verilmeyen yetki yoktur).
     */
    public const PRESET_DEFAULTS = [
        'branch-manager'=>['Şube yöneticisi (şubede tam yetki)',['appointments'=>'write','clients'=>'write','patients'=>'write','followups'=>'write','sales'=>'write','collections'=>'write','products'=>'write','expenses'=>'write','reports'=>'read','messages'=>'write','support'=>'write','overviewClients'=>'read','overviewPatients'=>'read',
            'overviewSales'=>'read','deletePatients'=>'write','deleteClients'=>'write','deleteAppointments'=>'write','deleteProducts'=>'write','deleteSales'=>'write','deleteCollections'=>'write','deleteCash'=>'write','deleteNotes'=>'write','deleteMessages'=>'write','deleteTemplates'=>'write','deleteHomeVisit'=>'write',
            'smsSend'=>'write','whatsappSend'=>'write','smsHistory'=>'read','whatsappHistory'=>'read','backup'=>'read','spreadsheet'=>'write','cashCorrect'=>'write',
            'inbox'=>'write','phoneGateway'=>'write','reminders'=>'write','bulkMessages'=>'write','permits'=>'write','consents'=>'write','edocs'=>'write','bridge'=>'write','icu'=>'write','surgery'=>'write','homeCare'=>'write','homeVisit'=>'write',
            'webSite'=>'write','onlineBooking'=>'write','vebot'=>'write','voice'=>'write','xray'=>'write','dicom'=>'write','labAi'=>'write','calculators'=>'write','taskBoard'=>'write','commission'=>'read','debtReminders'=>'write','bulkPrice'=>'write','invoiceImport'=>'write','okc'=>'write','devices'=>'write']],
        'sales-desk'=>['Satış / tezgâh personeli',['sales'=>'write','collections'=>'write','clients'=>'write','patients'=>'read','appointments'=>'read','products'=>'read','followups'=>'read','overviewClients'=>'read','overviewPatients'=>'read',
            'okc'=>'write','permits'=>'write','debtReminders'=>'write','taskBoard'=>'write','vebot'=>'write','voice'=>'write','inbox'=>'read']],
        'reception'=>['Danışma / Resepsiyon',['appointments'=>'write','clients'=>'write','patients'=>'read','followups'=>'write','sales'=>'read','collections'=>'read','messages'=>'read','overviewClients'=>'read','overviewPatients'=>'read',
            'inbox'=>'write','permits'=>'write','consents'=>'write','reminders'=>'read','onlineBooking'=>'write','homeVisit'=>'read','taskBoard'=>'write','vebot'=>'write','voice'=>'write']],
        'clinical'=>['Klinik personeli (hekim)',['appointments'=>'write','clients'=>'write','patients'=>'write','followups'=>'write','sales'=>'write','collections'=>'write','products'=>'read','reports'=>'read','overviewClients'=>'read','overviewPatients'=>'read',
            'inbox'=>'read','consents'=>'write','bridge'=>'write','icu'=>'write','surgery'=>'write','homeCare'=>'write','homeVisit'=>'write','xray'=>'write','dicom'=>'write','labAi'=>'write','calculators'=>'write','devices'=>'write','taskBoard'=>'write','vebot'=>'write','voice'=>'write']],
        'cashier'=>['Kasa personeli',['sales'=>'write','collections'=>'write','expenses'=>'write','clients'=>'read','patients'=>'read','appointments'=>'read','products'=>'read','reports'=>'read','overviewSales'=>'read',
            'okc'=>'write','edocs'=>'write','debtReminders'=>'write','taskBoard'=>'write']],
        'inventory'=>['Stok sorumlusu',['products'=>'write','sales'=>'read','reports'=>'read','invoiceImport'=>'write','bulkPrice'=>'write','taskBoard'=>'write']],
    ];
    private function ensurePresets(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS identity_role_preset (partner_id CHAR(32) NOT NULL, id VARCHAR(40) NOT NULL, label VARCHAR(80) NOT NULL,
            modules TEXT NOT NULL, position SMALLINT NOT NULL DEFAULT 0, updated_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }
    /** Şablon izinlerini tam ve kapalı-varsayılan biçime getirir. */
    private static function presetGrants(array $values): array
    {
        $keys=[...array_keys(ClinicAccess::MODULES),...array_unique(array_values(ClinicAccess::ACTION_GRANTS)),...array_keys(ClinicAccess::FEATURES)];
        // Tahsilat ayrı izin oldu: eski şablonda yoksa Muhasebe veya Satış izninin yükseği verilir (satış yapan tahsilat alabilir).
        if (!isset($values['collections'])) { $r=['none'=>0,'read'=>1,'write'=>2]; $values['collections']=array_search(max($r[$values['expenses'] ?? 'none'] ?? 0,$r[$values['sales'] ?? 'none'] ?? 0),$r,true); }
        $out=[];
        foreach ($keys as $key) {
            $value=$values[$key] ?? 'none';
            if (!in_array($value,['none','read','write'],true)) throw new RuntimeException('İzin değeri geçersiz.',422);
            $out[$key]=$value;
        }
        return $out;
    }
    /** @return list<array{id:string,label:string,modules:array<string,string>,custom:bool}> */
    public function rolePresets(array $actor): array
    {
        if (!in_array($actor['role'],['dealer','branch'],true)) throw new RuntimeException('Yönetici yetkisi gerekli.',403);
        $rows=[];
        try {
            $q=$this->db->prepare('SELECT id,label,modules FROM identity_role_preset WHERE partner_id=? ORDER BY position,label');
            $q->execute([$actor['partner_id']]);
            $rows=$q->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException $e) { if ($e->getCode()!=='42S02') throw $e; }
        if (!$rows) {
            // Hiç kaydedilmemişse hazır şablonlar gösterilir; bayi ilk düzenlemede kendi kopyasını oluşturur.
            return array_map(fn($id)=>['id'=>$id,'label'=>self::PRESET_DEFAULTS[$id][0],'modules'=>self::presetGrants(self::PRESET_DEFAULTS[$id][1]),'custom'=>false],array_keys(self::PRESET_DEFAULTS));
        }
        $out=array_map(static fn($r)=>['id'=>$r['id'],'label'=>$r['label'],'modules'=>self::presetGrants(json_decode($r['modules'],true) ?: []),'custom'=>true],$rows);
        // Sonradan eklenen hazır şablonlar (şube yöneticisi, satış personeli) kendi listesini kaydetmiş bayide de görünür.
        $have=array_column($out,'id');
        foreach (['branch-manager','sales-desk'] as $id) if (!in_array($id,$have,true))
            $out[]=['id'=>$id,'label'=>self::PRESET_DEFAULTS[$id][0],'modules'=>self::presetGrants(self::PRESET_DEFAULTS[$id][1]),'custom'=>false];
        return $out;
    }
    /** Şablon kaydet / sil. Bayi yöneticisi; ilk değişiklikte hazır şablonlar bayinin kendi listesine kopyalanır. */
    public function saveRolePreset(array $actor,string $scope,object $input,int $now): array
    {
        if ($actor['role']!=='dealer' || !hash_equals($actor['membership_id'],$scope)) throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $this->ensurePresets();
        $this->db->beginTransaction();
        try {
            $this->lockPartner($actor['partner_id']);
            $count=$this->db->prepare('SELECT COUNT(*) FROM identity_role_preset WHERE partner_id=?');$count->execute([$actor['partner_id']]);
            $upsert=$this->db->prepare('INSERT INTO identity_role_preset(partner_id,id,label,modules,position,updated_at) VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE label=VALUES(label),modules=VALUES(modules),updated_at=VALUES(updated_at)');
            if ((int)$count->fetchColumn()===0) {
                $i=0; foreach (self::PRESET_DEFAULTS as $id=>[$label,$values]) $upsert->execute([$actor['partner_id'],$id,$label,json_encode(self::presetGrants($values)),$i++,$now]);
            }
            $id=is_string($input->id ?? null)?$input->id:'';
            if ($id!=='' && !preg_match('/\A[a-z0-9-]{1,40}\z/',$id)) throw new RuntimeException('Şablon geçersiz.',422);
            if (($input->delete ?? false)===true) {
                $this->db->prepare('DELETE FROM identity_role_preset WHERE partner_id=? AND id=?')->execute([$actor['partner_id'],$id]);
            } else {
                $label=trim((string)($input->label ?? ''));
                if (!preg_match('/\A[^\x00-\x1f<>]{1,80}\z/u',$label)) throw new RuntimeException('Şablon adı 1–80 karakter olmalıdır.',422);
                $values=is_object($input->modules ?? null)?(array)$input->modules:[];
                if ($id==='') {
                    $count->execute([$actor['partner_id']]);
                    if ((int)$count->fetchColumn()>=30) throw new RuntimeException('En fazla 30 görev şablonu oluşturulabilir.',422);
                    $id='p-'.bin2hex(random_bytes(6));
                }
                $position=$this->db->prepare('SELECT COALESCE(MAX(position),0)+1 FROM identity_role_preset WHERE partner_id=?');$position->execute([$actor['partner_id']]);
                $upsert->execute([$actor['partner_id'],$id,$label,json_encode(self::presetGrants($values)),(int)$position->fetchColumn(),$now]);
            }
            $this->audit($actor,'membership.presets');
            $this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        return ['presets'=>$this->rolePresets($actor),'id'=>$id];
    }
    /** Şablonu seçilen şube yöneticisi / personel üyeliklerine uygular; oturumları kapanır, yeni izinler hemen geçerli olur. */
    public function applyRolePreset(array $actor,string $scope,object $input,int $now): int
    {
        $this->sensitive($actor,$scope,$now);
        $ids=is_array($input->membershipIds ?? null)?array_values(array_filter($input->membershipIds,'is_string')):[];
        if (!$ids || count($ids)>200) throw new RuntimeException('Şablonun uygulanacağı personeli seçin.',422);
        $preset=null; foreach ($this->rolePresets($actor) as $row) if ($row['id']===($input->id ?? null)) $preset=$row;
        if (!$preset) throw new RuntimeException('Şablon bulunamadı.',404);
        $this->db->beginTransaction();
        try {
            $this->lockPartner($actor['partner_id']);
            $find=$this->db->prepare("SELECT id FROM identity_membership WHERE id=? AND partner_id=? AND role IN ('branch','staff')");
            $update=$this->db->prepare('UPDATE identity_membership SET modules=? WHERE id=?');
            $sessions=$this->db->prepare('DELETE FROM identity_session WHERE membership_id=?');
            $done=0;
            foreach ($ids as $id) {
                $find->execute([$id,$actor['partner_id']]);
                if (!$find->fetchColumn()) continue;
                $update->execute([json_encode($preset['modules'],JSON_THROW_ON_ERROR),$id]);
                $sessions->execute([$id]);
                $done++;
            }
            $this->audit($actor,'membership.grants');
            $this->db->commit();
            return $done;
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    public function manage(array $actor,string $scope,string $action,object $input,int $now): void
    {
        $this->sensitive($actor,$scope,$now);
        if(!is_string($input->membershipId ?? null)) throw new RuntimeException('Üyelik seçin.',422);
        $this->db->beginTransaction();
        try {
            $this->lockPartner($actor['partner_id']);
            $q=$this->db->prepare("SELECT * FROM identity_membership WHERE id=? AND partner_id=? AND role<>'dealer' FOR UPDATE");
            $q->execute([$input->membershipId,$actor['partner_id']]); $member=$q->fetch();
            if(!$member) throw new RuntimeException('Üyelik bulunamadı.',404);
            $this->db->prepare('DELETE FROM identity_session WHERE membership_id=?')->execute([$member['id']]);
            if ($action==='delete') {
                if (($input->confirm ?? false)!==true) throw new RuntimeException('Üyeliği kaldırmayı onaylayın.',422);
                foreach (['identity_activation','clinic_visit_read','clinic_delivery_notice'] as $table) {
                    $this->db->prepare("DELETE FROM $table WHERE membership_id=?")->execute([$member['id']]);
                }
                $this->db->prepare('DELETE FROM identity_membership WHERE id=?')->execute([$member['id']]);
            } elseif ($action==='revoke') {
                $this->db->prepare("UPDATE identity_membership SET status='revoked' WHERE id=?")->execute([$member['id']]);
            } elseif ($action==='edit') {
                $name=is_string($input->name??null)?trim($input->name):'';
                if (!preg_match('/\A.{1,160}\z/usD',$name)) throw new RuntimeException('Üyelik adını kontrol edin.',422);
                $branch=$member['role']==='customer' ? $member['branch_id'] : ($input->branchId??null);
                if (!is_string($branch) || !ClinicAccess::branch($this->state($actor),$branch)) throw new RuntimeException('Etkin bir şube seçin.',422);
                $existing=$this->db->prepare("SELECT 1 FROM identity_membership WHERE partner_id=? AND account_id=? AND role=? AND branch_id=?
                    AND customer_id=? AND id<>?");
                $existing->execute([$actor['partner_id'],$member['account_id'],$member['role'],$branch,$member['customer_id'],$member['id']]);
                if ($existing->fetchColumn()) throw new RuntimeException('Bu hesap seçilen şubede zaten kayıtlı.',409);
                $this->db->prepare('UPDATE identity_membership SET name=?,branch_id=? WHERE id=?')->execute([$name,$branch,$member['id']]);
            } else {
                $this->db->prepare('UPDATE identity_membership SET modules=? WHERE id=?')->execute([
                    self::grants($member['role'],is_object($input->modules??null)?$input->modules:(object)[]),$member['id']]);
            }
            $this->audit($actor,'membership.'.$action);
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    private function lockPartner(string $partner): void
    {
        $q=$this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE'); $q->execute([$partner]); $q->fetch();
    }
    private function audit(array $actor,string $action): void
    {
        $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$actor['partner_id'],$actor['account_id'],$action]);
    }
    public static function shortPassword(): string
    {
        $alphabet='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        $out='';
        for ($i=0;$i<8;$i++) $out.=$alphabet[random_int(0,strlen($alphabet)-1)];
        return $out;
    }
    public function customerPassword(array $actor,string $id,?object $input,int $now,array $config=[]): array
    {
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $sms=($input->welcomeSms ?? false)===true;
        // SMS seçiliyse şifre gönderilmez: hasta sahibi bağlantıda önce KVKK metnini onaylar, sonra şifresini kendisi oluşturur.
        $password=$sms ? null : ($input->password ?? null);
        $request=null;
        if ($input && !$sms && (!is_string($password) || !preg_match('/\A.{6,128}\z/us',$password))) {
            throw new RuntimeException('Şifre 6 ile 128 karakter arasında olmalı.',422);
        }
        if ($input) $this->db->beginTransaction();
        try {
            if ($input) $this->lockPartner($actor['partner_id']);
            $state=$this->state($actor);
            $client=null;
            foreach ($state->clients ?? [] as $row) if ($row->id===$id) { $client=$row; break; }
            if (!$client) throw new RuntimeException('Müşteri bulunamadı.',404);
            $phone=DealerLogin::normalizePhone($client->phone ?? '');
            if (!$phone || !ClinicAccess::branch($state,$client->branch)) throw new RuntimeException('Geçerli telefon ve etkin şube gerekli.',422);
            $query=$this->db->prepare("SELECT m.id,m.account_id,m.status,a.password_hash,a.identifier FROM identity_membership m
                JOIN identity_account a ON a.id=m.account_id WHERE m.partner_id=? AND m.customer_id=?
                AND m.branch_id=? AND m.role='customer' AND m.status<>'revoked'".($input?' FOR UPDATE':''));
            $query->execute([$actor['partner_id'],$id,$client->branch]);
            $member=$query->fetch();
            if (!$input) return ['configured'=>!empty($member['password_hash']) && $member['identifier']===$phone && $member['status']==='active'];
            if ($sms) {
                if (($client->sms ?? '')!=='Var') throw new RuntimeException('Müşteri kartında SMS iznini Var olarak seçin.',422);
                if (!function_exists('curl_init')) throw new RuntimeException('SMS için sunucuda PHP cURL gerekli.',503);
                $provider=$config['appointmentReminderConnections'][$actor['partner_id']]['sms'] ?? [];
                $clinic=AppointmentReminders::clinicName((string)($state->preferences->clinic ?? '') ?: (string)$this->db->query('SELECT name FROM partner_account WHERE id='.$this->db->quote($actor['partner_id']))->fetchColumn(),ClinicAccess::branch($state,$client->branch));
                $template=$state->preferences->customerReminder_welcome_text ?? 'Sayın {musteri}, {klinik} ailesine hoş geldiniz.';
                $message=trim(strtr($template,['{musteri}'=>$client->name,'{klinik}'=>$clinic]));
                $site=preg_replace('~\Ahttps://~','',rtrim((string)$config['origin'],'/'));
                // Şifre SMS'te yer almaz; bağlantı aşağıda (onay formu oluşturulunca) eklenir.
                // Telefon Bağlantısı açıksa ilk giriş SMS'i kliniğin kendi hattından gider; Netgsm gerekmez.
                $viaPhone=class_exists(PhoneGateway::class) && (new PhoneGateway($this->db))->route($actor['partner_id'],'sms');
                if (!$viaPhone) {
                    $request=AppointmentReminders::request($provider,[
                        'channel'=>'sms','phone'=>$phone,'parameters'=>[$client->name,'',$clinic],'message'=>$message,
                    ],bin2hex(random_bytes(16)));
                    if ($request===null) throw new RuntimeException('SMS gönderimi için Telefon Bağlantısı sayfasından kliniğin telefonunu bağlayın veya Netgsm ayarlarını kontrol edin.',422);
                }
            }
            foreach ($state->clients as $other) if ($other->id!==$id && DealerLogin::normalizePhone($other->phone ?? '')===$phone) {
                throw new RuntimeException('Bu telefon birden fazla müşteri kaydında kullanılıyor.',409);
            }
            if ($member && $member['identifier']!==$phone) throw new RuntimeException('Müşteri üyeliği eski telefona bağlı. Merkezi Hesaplar ekranından üyeliği iptal edip yeni telefonla aktivasyon başlatın.',409);
            $query=$this->db->prepare("SELECT id,blocked,password_hash FROM identity_account WHERE kind='phone' AND identifier=? FOR UPDATE");
            $query->execute([$phone]);
            $account=$query->fetch();
            if ($sms && !empty($account['password_hash'])) {
                throw new RuntimeException('Bu telefonun giriş şifresi zaten var. İlk giriş SMS’i mevcut şifreyi değiştirmez.',409);
            }
            if ($account) {
                $query=$this->db->prepare("SELECT COUNT(*) FROM identity_membership WHERE account_id=? AND id<>? AND status<>'revoked'");
                $query->execute([$account['id'],$member['id'] ?? '']);
                if ($account['blocked'] || (int)$query->fetchColumn()>0 || (!$member && $account['password_hash'])) {
                    throw new RuntimeException('Telefon başka bir hesaba bağlı. Merkezi Hesaplar üzerinden kişiye özel aktivasyon bağlantısı kullanın.',409);
                }
            }
            $accountId=$account['id'] ?? bin2hex(random_bytes(16));
            if (!$account) $this->db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES (?,'phone',?)")->execute([$accountId,$phone]);
            // SMS akışında üyelik "bekliyor" olarak açılır; hasta sahibi KVKK onayı + şifre oluşturunca etkinleşir.
            $memberStatus=$sms?'pending':'active';
            if ($member) {
                $this->db->prepare("UPDATE identity_membership SET status=? WHERE id=?")->execute([$memberStatus,$member['id']]);
                $this->db->prepare('UPDATE identity_activation SET used=1 WHERE membership_id=?')->execute([$member['id']]);
            } else {
                $this->db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status)
                    VALUES (?,?,?,'customer',?,?,?,?,?)")->execute([bin2hex(random_bytes(16)),$accountId,$actor['partner_id'],$client->branch,$id,$client->name,'{"vaccines":"read","appointments":"read","shares":"none"}',$memberStatus]);
            }
            if (!$sms) {
                $this->db->prepare('UPDATE identity_account SET password_hash=?,verified_at=?,version=version+1 WHERE id=?')
                    ->execute([password_hash($password,PASSWORD_ARGON2ID),$now,$accountId]);
                $this->db->prepare('DELETE FROM identity_session WHERE account_id=?')->execute([$accountId]);
            }
            $this->audit($actor,$sms?'customer.onboard_sent':'customer.password_set');
            $this->db->commit();
            if (!$sms) return ['configured'=>true];
            // Hoş geldin SMS'i yalnız tek bağlantı içerir: KVKK metni ve onayı → teşekkür + şifre oluşturma → giriş.
            $permitUrl=(new ClientPermit($this->db,rtrim((string)($config['origin'] ?? ''),'/')))->create($actor,(object)['client'=>$id,'method'=>'sms','silent'=>true,'onboard'=>true],$now)['short'];
            $message.="\nKVKK onayı ve şifre oluşturma: ".$permitUrl;
            if (!empty($viaPhone)) {
                try {
                    (new PhoneGateway($this->db))->enqueue($actor['partner_id'],'sms',$phone,$message,'manual','welcome:'.$id.':'.$now,0,$now,$now+86400,(string)($actor['name'] ?? ''));
                    return ['configured'=>true,'sms'=>'queued','permit'=>$permitUrl!==''];
                } catch (\Throwable) { return ['configured'=>true,'sms'=>'unknown']; }
            }
            if ($request!==null) $request[2]['messages'][0]['msg']=$message;
            try {
                [$status]=AppointmentReminders::send($request,'sms');
            } catch (\Throwable) {
                $status='unknown';
            }
            return ['configured'=>true,'sms'=>$status];
        } catch (\Throwable $error) {
            if ($input && $this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }
    public function share(array $actor,string $scope,string $action,object $input,int $now): void
    {
        $this->sensitive($actor,$scope,$now);
        $membership=$input->membershipId ?? null;
        $category=$input->category ?? null;
        $id=$input->recordId ?? null;
        if (!is_string($membership) || !in_array($category,['notice','exam','lab','xray'],true)
            || !is_string($id) || !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/',$id)) throw new RuntimeException('Paylaşım bilgileri geçersiz.',422);
        $q=$this->db->prepare("SELECT m.*,a.identifier FROM identity_membership m JOIN identity_account a ON a.id=m.account_id
            WHERE m.id=? AND m.partner_id=? AND m.role='customer' AND m.status='active'");
        $q->execute([$membership,$actor['partner_id']]);
        $member=$q->fetch();
        $state=$this->state($actor);
        if (!$member || !ClinicAccess::valid($member,$state)) throw new RuntimeException('Etkin hasta sahibi üyeliği bulunamadı.',404);
        if ($action==='unshare') {
            $this->db->prepare('DELETE FROM clinic_portal_share WHERE membership_id=? AND category=? AND record_id=?')->execute([$membership,$category,$id]);
            return;
        }
        $modules=ClinicAccess::modules($member);
        $permission=$category==='notice'?'shares':$category;
        if (($modules->$permission ?? 'none')!=='read') throw new RuntimeException('Önce bu paylaşım türüne izin verin.',403);
        if ($category!=='notice' && !$this->sharedRecord($state,$member,$category,$id)) throw new RuntimeException('Kayıt bu hasta sahibine ait değil.',404);
        $summary=$input->summary ?? null;
        $photo=$input->photo ?? '';
        if (!is_string($summary) || !preg_match('/\A.{1,4000}\z/us',trim($summary)) || !is_string($photo) || strlen($photo)>500000) throw new RuntimeException('Paylaşım metni veya görsel geçersiz.',422);
        if (in_array($category,['lab','xray'],true) && $photo==='') throw new RuntimeException('Tetkik görselini ekleyin.',422);
        if ($photo!=='') {
            if (!preg_match('~\Adata:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)\z~D',$photo,$match)) throw new RuntimeException('JPEG, PNG veya WebP görseli seçin.',422);
            $bytes=base64_decode($match[2],true);
            $info=$bytes===false?false:@getimagesizefromstring($bytes);
            if (!$info || $info['mime']!=='image/'.$match[1] || max($info[0],$info[1])>2400) throw new RuntimeException('Görsel geçersiz.',422);
        }
        $this->db->prepare('INSERT INTO clinic_portal_share(membership_id,category,record_id,summary,photo) VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE summary=VALUES(summary),photo=VALUES(photo)')->execute([$membership,$category,$id,trim($summary),$photo?:null]);
        if (class_exists(DeliveryNotice::class)) {
            $client=array_column($state->clients??[],null,'id')[$member['customer_id']]??null;
            $branch=ClinicAccess::branch($state,$member['branch_id']);
            (new DeliveryNotice($this->db))->add($actor['partner_id'],($branch->sharedWith??'')?:$member['branch_id'],$member['customer_id'],
                $permission,implode(':',['share',$membership,$category,$id,hash('sha256',$summary.$photo)]),
                $category==='notice'?'Klinikten yeni mesaj':'Klinikten yeni sağlık kaydı',
                '/hasta-sahibi?bildirim=health&kayit='.rawurlencode($id),$client->email??'',$membership);
        }
    }

    private function sharedRecord(object $state,array $member,string $category,string $id): ?object
    {
        $branch=ClinicAccess::branch($state,$member['branch_id']);
        if (!$branch) return null;
        $dataBranch=($branch->sharedWith ?? '') ?: $branch->id;
        $collection=$category==='exam'?'exams':'labs';
        foreach ($state->$collection ?? [] as $row) {
            if ($row->id!==$id || $row->branch!==$dataBranch) continue;
            foreach ($state->patients ?? [] as $patient) {
                if ($patient->id===($row->patient ?? '') && $patient->branch===$dataBranch && $patient->owner===$member['customer_id']) return $row;
            }
        }
        return null;
    }

    public function labPhoto(array $actor,string $id,?object $input): array
    {
        $state=$this->state($actor);
        if ($actor['role']==='customer') {
            $lab=$this->sharedRecord($state,$actor,'lab',$id);
            $modules=ClinicAccess::modules($actor);
            $category=($lab->kind ?? '')==='Röntgen'?'xray':'lab';
            $exam=$lab && !empty($lab->exam)?$this->sharedRecord($state,$actor,'exam',$lab->exam):null;
            if ($input || !$exam || $exam->patient!==$lab->patient ||
                ($modules->exam ?? '')!=='read' || ($modules->$category ?? '')!=='read') {
                throw new RuntimeException('Görsel erişime açık değil.',404);
            }
        } else {
            if (!ClinicAccess::allowed($actor,'labs',$input!==null)) throw new RuntimeException('Tetkik erişimi gerekli.',403);
            $visible=ClinicAccess::visible($state,$actor);
            if (!in_array($id,array_column($visible->labs ?? [],'id'),true)) throw new RuntimeException('Tetkik bulunamadı.',404);
        }
        if ($input) {
            $photo=$input->photo ?? null;
            if (!is_string($photo) || strlen($photo)>480000 || !preg_match('~\Adata:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)\z~D',$photo,$parts)) {
                throw new RuntimeException('Geçerli tetkik görseli seçin.',422);
            }
            $bytes=base64_decode($parts[2],true);
            $info=$bytes===false?false:@getimagesizefromstring($bytes);
            if (!$info || $info['mime']!=='image/'.$parts[1] || max($info[0],$info[1])>5000) throw new RuntimeException('Görsel geçersiz.',422);
            $this->db->prepare('INSERT INTO clinic_lab_attachment(partner_id,lab_id,photo) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE photo=VALUES(photo)')->execute([$actor['partner_id'],$id,$photo]);
            return ['ok'=>true];
        }
        $q=$this->db->prepare('SELECT photo FROM clinic_lab_attachment WHERE partner_id=? AND lab_id=?');
        $q->execute([$actor['partner_id'],$id]);
        return ['photo'=>$q->fetchColumn() ?: ''];
    }

    public function examPhotos(array $actor,string $id,?object $input): array
    {
        if (!in_array($actor['role'],['dealer','branch','staff'],true)||!ClinicAccess::allowed($actor,'exams',$input!==null)) {
            throw new RuntimeException('Muayene görseli erişimi gerekli.',403);
        }
        $visible=ClinicAccess::visible($this->state($actor),$actor);
        if (!in_array($id,array_column($visible->exams??[],'id'),true)) throw new RuntimeException('Muayene bulunamadı.',404);
        if ($input) {
            $append=isset($input->appendPhotos);
            $photos=$append?$input->appendPhotos:($input->photos??null);
            if (!is_array($photos)||count($photos)>6) throw new RuntimeException('En fazla altı fotoğraf eklenebilir.',422);
            foreach ($photos as $photo) {
                if (!is_string($photo)||strlen($photo)>450000||!preg_match('~\Adata:image/jpeg;base64,([A-Za-z0-9+/=]+)\z~D',$photo,$matches)) {
                    throw new RuntimeException('Geçerli bir muayene fotoğrafı seçin.',422);
                }
                $bytes=base64_decode($matches[1],true);
                $info=$bytes===false?false:@getimagesizefromstring($bytes);
                if (!$info||$info['mime']!=='image/jpeg'||max($info[0],$info[1])>2000) throw new RuntimeException('Muayene fotoğrafı geçersiz.',422);
            }
            if ($append) {
                $this->db->beginTransaction();
                try {
                    $this->db->prepare("INSERT IGNORE INTO clinic_exam_photos(partner_id,exam_id,photos) VALUES (?,?,'[]')")
                        ->execute([$actor['partner_id'],$id]);
                    $row=$this->db->prepare('SELECT photos FROM clinic_exam_photos WHERE partner_id=? AND exam_id=? FOR UPDATE');
                    $row->execute([$actor['partner_id'],$id]);
                    $photos=array_values(array_unique(array_merge(json_decode($row->fetchColumn(),true,16,JSON_THROW_ON_ERROR),$photos)));
                    if (count($photos)>6) throw new RuntimeException('En fazla altı fotoğraf eklenebilir.',409);
                    $this->db->prepare('UPDATE clinic_exam_photos SET photos=? WHERE partner_id=? AND exam_id=?')
                        ->execute([json_encode($photos,JSON_THROW_ON_ERROR),$actor['partner_id'],$id]);
                    $this->db->commit();
                    return ['ok'=>true];
                } catch (\Throwable $error) {
                    $this->db->rollBack();
                    throw $error;
                }
            }
            $this->db->prepare('INSERT INTO clinic_exam_photos(partner_id,exam_id,photos) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE photos=VALUES(photos)')->execute([$actor['partner_id'],$id,json_encode($photos,JSON_THROW_ON_ERROR)]);
            return ['ok'=>true];
        }
        $q=$this->db->prepare('SELECT photos FROM clinic_exam_photos WHERE partner_id=? AND exam_id=?');
        $q->execute([$actor['partner_id'],$id]);
        return ['photos'=>json_decode($q->fetchColumn()?:'[]',true,16,JSON_THROW_ON_ERROR)];
    }

    /** "Ad | Sonuç | Birim | Alt | Üst | İşaret" tablosundan yalnızca değer satırları (yorum içermez). */
    private static function ownerLabRows(string $values): array
    {
        $clean=static fn(string $text,int $limit): string=>mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u',' ',$text) ?? ''),0,$limit);
        $number=static fn(string $text): ?float=>preg_match('/[-+]?\d+(?:[.,]\d+)?/',$text,$m)?(float)str_replace(',','.',$m[0]):null;
        $rows=[];
        foreach (preg_split('/\R/',mb_substr($values,0,18000)) as $line) {
            $cells=array_map('trim',explode('|',$line));
            if (count($cells)<5 || count($cells)>8 || $cells[0]==='' || $cells[1]==='') continue;
            [$name,$value,$unit,$min,$max]=array_slice($cells,0,5);
            $mark=strtoupper($cells[5] ?? '');
            $v=$number($value); $lo=$number($min); $hi=$number($max);
            $flag=$v!==null&&$lo!==null&&$hi!==null&&$lo<=$hi?($v<$lo?'L':($v>$hi?'H':'')):(in_array($mark,['H','L'],true)?$mark:'');
            $rows[]=['name'=>$clean($name,60),'value'=>$clean($value,24),'unit'=>$clean($unit,24),
                'ref'=>$min!==''&&$max!==''?$clean($min,12).'–'.$clean($max,12):'','flag'=>$flag];
            if (count($rows)>=80) break;
        }
        return $rows;
    }

    public function portal(array $actor): array
    {
        if($actor['role']!=='customer') throw new RuntimeException('Hasta sahibi hesabı gerekli.',403);
        // Yalnız bu hasta sahibine ait kayıtlar okunur; aşağıdaki süzgeçler aynen uygulanır.
        $state=(new ClinicRecords($this->db))->ownerSlice('partner:'.$actor['partner_id'],(string)$actor['customer_id']) ?? $this->state($actor);
        if(!ClinicAccess::valid($actor,$state)) throw new RuntimeException('Hasta sahibi ilişkisi doğrulanamadı.',403);
        $branch=ClinicAccess::branch($state,$actor['branch_id']);
        $dataBranch=($branch->sharedWith ?? '') ?: $branch->id;
        $pets=[]; $ids=[];
        foreach($state->patients as $pet) if($pet->branch===$dataBranch && $pet->owner===$actor['customer_id']) {
            $pets[]=array_intersect_key((array)$pet,array_flip(['id','name','species','breed','birth','photo','sex'])); $ids[]=$pet->id;
        }
        $modules=ClinicAccess::modules($actor);
        $sections=[]; foreach(ClinicAccess::CUSTOMER_SECTIONS as $key) $sections[$key]=($modules->$key ?? 'none')==='read';
        $package=(new Commerce($this->db))->packageActor($actor)['packageFeatures'] ?? [];
        if (($package['homeCare'] ?? true)===false) $sections['homeCare']=false;
        if (($package['consents'] ?? true)===false && ($package['permits'] ?? true)===false) $sections['documents']=false;
        $vaccines=[]; $appointments=[];
        $today=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $soon=(new \DateTimeImmutable($today))->modify('+7 days')->format('Y-m-d');
        foreach($state->followups as $row) if($sections['vaccines'] && $row->branch===$dataBranch && in_array($row->patient,$ids,true) && ($row->kind ?? '')==='Aşı') {
            if(($row->status ?? '')==='İptal') continue;
            $status=!empty($row->done)||in_array($row->status ?? '',['Tamamlandı','Yapıldı'],true)?'done':(($row->date ?? '')<$today?'late':(($row->date ?? '')<=$soon?'soon':'planned'));
            $vaccines[]=['id'=>$row->id,'patient'=>$row->patient,'title'=>$row->title,'scheduledAt'=>$row->date,'administeredAt'=>$row->done ?? '', 'status'=>$status];
        }
        foreach($state->appointments as $row) if($sections['appointments'] && $row->branch===$dataBranch && in_array($row->patient,$ids,true)) $appointments[]=array_intersect_key((array)$row,array_flip(['id','patient','date','time','service','status']));
        $q=$this->db->prepare('SELECT name,phone FROM partner_account WHERE id=?'); $q->execute([$actor['partner_id']]); $partner=$q->fetch();
        $sales=[];
        $balanceCents=0;
        foreach ($state->sales ?? [] as $sale) {
            if ($sale->branch!==$dataBranch || ($sale->client ?? '')!==$actor['customer_id']) continue;
            $sales[$sale->id]=true;
            $balanceCents+=Finance::money($sale->paid ?? '0')-Finance::money($sale->amount);
        }
        foreach ($state->collections ?? [] as $payment) {
            if ($payment->branch===$dataBranch && isset($sales[$payment->sale ?? ''])) $balanceCents+=Finance::money($payment->amount);
        }
        $shared=[];
        $query=$this->db->prepare('SELECT category,record_id,summary,photo FROM clinic_portal_share WHERE membership_id=? ORDER BY created_at DESC LIMIT 50');
        $query->execute([$actor['membership_id']]);
        while ($share=$query->fetch()) {
            $category=$share['category'];
            if (!$sections[$category==='notice'?'shares':$category]) continue;
            if ($category!=='notice') {
                $record=$this->sharedRecord($state,$actor,$category,$share['record_id']);
                if (!$record) continue;
                $share['date']=$record->date ?? '';
                $share['title']=$record->title ?? $record->type ?? '';
            }
            $shared[]=$share;
        }
        $exams=[];
        if ($sections['exam']) {
            foreach ($state->exams ?? [] as $exam) {
                if ($exam->branch!==$dataBranch || !in_array($exam->patient,$ids,true)) continue;
                $exams[$exam->id]=array_intersect_key((array)$exam,array_flip(['id','title','patient','date']));
                $exams[$exam->id]['attachments']=[];
            }
            $q=$this->db->prepare('SELECT lab_id FROM clinic_lab_attachment WHERE partner_id=?');
            $q->execute([$actor['partner_id']]);
            $photos=array_fill_keys($q->fetchAll(PDO::FETCH_COLUMN),true);
            foreach ($state->labs ?? [] as $lab) {
                $exam=$lab->exam ?? '';
                $category=($lab->kind ?? '')==='Röntgen'?'xray':'lab';
                // Hasta sahibi yalnızca hekimin doğruladığı değer tablosunu ve görseli görür; yorum/sonuç metni gönderilmez.
                $rows=($lab->verified ?? '')==='Evet'?self::ownerLabRows((string)($lab->values ?? '')):[];
                if ($sections[$category] && (isset($photos[$lab->id]) || $rows) && isset($exams[$exam]) && $lab->branch===$dataBranch
                    && $lab->patient===$exams[$exam]['patient']) {
                    $exams[$exam]['attachments'][]=['id'=>$lab->id,'title'=>$lab->title ?? 'Tetkik','category'=>$category,
                        'photo'=>isset($photos[$lab->id]),'rows'=>$rows];
                }
            }
        }
        return ['homeCare'=>$sections['homeCare'],'exams'=>array_values($exams),'balanceCents'=>$sections['balance']?$balanceCents:null,'name'=>$actor['name'],'clinic'=>['partner'=>$partner['name'],'branch'=>$branch->name,'phone'=>$branch->phone ?? $partner['phone']], 'pets'=>$pets,'vaccines'=>$vaccines,'appointments'=>$appointments,'shared'=>$shared,'sections'=>$sections];
    }
}
