<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class Commerce
{
    public function __construct(private readonly PDO $db) {}

    public static function plans(): array
    {
        return array_column(json_decode(file_get_contents(dirname(__DIR__).'/sales-plans.json'),true,32,JSON_THROW_ON_ERROR),null,'id');
    }

    public const TERMS=[
        'users'=>['Kullanıcı',100000],'branches'=>['Şube',100000],'patients'=>['Hasta kaydı',10000000],
        'storage'=>['Depolama (GB)',100000],'sms'=>['Aylık SMS gönderim sınırı',10000000],'whatsapp'=>['Aylık WhatsApp gönderim sınırı',10000000],
        'okc'=>['ÖKC hakkı',100000],'edoc'=>['E-dönüşüm hakkı',100000],
        'support'=>['Destek kapsamı',null],'trial'=>['Deneme süresi (gün)',365],'discount'=>['Yıllık indirim (%)',100],
    ];

    public function catalog(): array
    {
        $plans=self::plans();
        foreach ($this->db->query('SELECT plan_id,settings FROM clinic_package_settings') as $row) {
            $id=$row['plan_id'];
            $plans[$id]=array_replace($plans[$id] ?? ['id'=>$id,'terms'=>(object)[]],json_decode($row['settings'],true,32,JSON_THROW_ON_ERROR));
        }
        return $plans;
    }

    public function savePackage(object $body): void
    {
        $id=$this->field($body,'id',32,true);
        if (!preg_match('/\A[a-z0-9][a-z0-9-]{0,31}\z/',$id)) throw new RuntimeException('Paket kodu geçersiz.',422);
        $create=($body->create ?? false)===true;
        if (isset($this->catalog()[$id])===$create) throw new RuntimeException($create?'Paket kodu zaten kullanılıyor.':'Paket bulunamadı.',409);
        $settings=['name'=>$this->field($body,'name',120,true),'description'=>$this->field($body,'description',800,true),
            'published'=>($body->published ?? false)===true,'features'=>array_values(array_filter(array_map('trim',preg_split('/\R/u',$this->field($body,'features',2500))))),
            'vat'=>($body->vat ?? '')==='excluded'?'excluded':'included'];
        foreach (['monthly','yearly'] as $key) {
            $price=$body->$key ?? null;
            if ($price!==null && (!is_int($price) || $price<0 || $price>999999999)) throw new RuntimeException('Paket fiyatı geçersiz.',422);
            $settings[$key]=$price;
        }
        $terms=$body->terms ?? (object)[];
        if (!$terms instanceof \stdClass) throw new RuntimeException('Paket kapsamı geçersiz.',422);
        $settings['terms']=[];
        foreach (self::TERMS as $key=>[$label,$max]) {
            $value=$terms->$key ?? null;
            if ($value===null || $value==='') continue;
            if ($max===null) {
                if (!is_string($value) || !preg_match('/\A.{1,160}\z/u',$value)) throw new RuntimeException($label.' geçersiz.',422);
            } elseif ($value!=='unlimited' || in_array($key,['trial','discount'],true)) {
                if (!is_int($value) || $value<0 || $value>$max) throw new RuntimeException($label.' geçersiz.',422);
            }
            $settings['terms'][$key]=$value;
        }
        $modules=$body->modules ?? null;
        $settings['modules']=[];
        foreach (array_keys(ClinicAccess::MODULES) as $key) {
            $grant=$modules->$key ?? 'none';
            if (!in_array($grant,['none','read','write'],true)) throw new RuntimeException('Modül yetkisi geçersiz.',422);
            $settings['modules'][$key]=$grant;
        }
        // Özellikler: işaretlenmeyen özellik bu paketteki bayilerde kapalıdır (menüde görünmez, sunucu da reddeder).
        $caps=$body->capabilities ?? null;
        $settings['capabilities']=[];
        foreach (array_keys(ClinicAccess::FEATURES) as $key) $settings['capabilities'][$key]=!is_object($caps) || ($caps->$key ?? false)===true;
        $this->db->prepare('INSERT INTO clinic_package_settings(plan_id,settings) VALUES (?,?)'.($create?'':' ON DUPLICATE KEY UPDATE settings=VALUES(settings)'))
            ->execute([$id,json_encode($settings,JSON_THROW_ON_ERROR)]);
    }

    public function packageActor(array $actor): array
    {
        $day=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $q=$this->db->prepare('SELECT p.settings FROM clinic_subscription s LEFT JOIN clinic_package_settings p ON p.plan_id=s.plan_id
            WHERE s.partner_id=? AND s.starts_on<=? AND s.ends_on>=? ORDER BY s.starts_on DESC,s.id DESC LIMIT 1');
        $q->execute([$actor['partner_id'],$day,$day]);
        $settings=json_decode((string)$q->fetchColumn(),true);
        if (isset($settings['modules'])) $actor['packageModules']=$settings['modules'];
        if (isset($settings['capabilities']) && is_array($settings['capabilities'])) $actor['packageFeatures']=array_map(static fn($v)=>$v===true,$settings['capabilities']);
        $terms=(array)($settings['terms'] ?? []);
        $actor['packageLimits']=['sms'=>is_int($terms['sms'] ?? null)?$terms['sms']:null,'whatsapp'=>is_int($terms['whatsapp'] ?? null)?$terms['whatsapp']:null];
        return $actor;
    }

    public function publishedCatalog(): array
    {
        return array_filter($this->catalog(),static fn(array $plan): bool=>($plan['published'] ?? true)!==false);
    }

    public function marketPackages(): string
    {
        $escape=static fn(string $text)=>htmlspecialchars($text,ENT_QUOTES,'UTF-8');
        $cards='';
        $plans=$this->publishedCatalog();
        foreach ($plans as $plan) {
            $cards.='<article class="card"><h2>'.$escape($plan['name']).'</h2><p>'.$escape($plan['description']).'</p>';
            if (!empty($plan['features'])) $cards.='<ul><li>'.implode('</li><li>',array_map($escape,$plan['features'])).'</li></ul>';
            foreach (['monthly'=>'Aylık','yearly'=>'Yıllık'] as $key=>$label) {
                $price=$plan[$key];
                $amount=$price===null?'Teklif isteyin':number_format($price/100,2,',','.').' ₺';
                $cards.='<div data-price="'.$key.'"'.($key==='yearly'?' hidden':'').'><strong>'.$amount.'</strong><small>'.$label.
                    ($price===null?'':($plan['vat']==='included'?' · KDV dahil':' · KDV hariç')).'</small></div>';
            }
            $cards.='<a class="button outline" data-plan-link href="/platform/deneme?plan='.rawurlencode($plan['id']).'&amp;donem=monthly">Bilgi isteyin</a></article>';
        }
        if ($cards==='') return '<p>Şu anda yayında paket yok.</p>';
        $table='<h2>Paket karşılaştırması</h2><div class="table-scroll" tabindex="0" role="region" aria-label="Paket karşılaştırması"><table><thead><tr><th scope="col">Kapsam</th>';
        foreach ($plans as $plan) $table.='<th scope="col">'.$escape($plan['name']).'</th>';
        $table.='</tr></thead><tbody>';
        foreach (self::TERMS as $key=>[$label]) {
            $table.='<tr><th scope="row">'.$escape($label).'</th>';
            foreach ($plans as $plan) {
                $terms=(array)($plan['terms'] ?? []);
                $value=$terms[$key] ?? 'Görüşmede';
                $table.='<td>'.$escape($value==='unlimited'?'Sınırsız':(string)$value).'</td>';
            }
            $table.='</tr>';
        }
        return '<div class="cards plans">'.$cards.'</div>'.$table.'</tbody></table></div>';
    }

    public function submit(object $body, string $key, ?Notifications $notifications=null): array
    {
        $id = $body->requestId ?? '';
        if (!is_string($id) || !preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/',$id)
            || ($body->read ?? '') !== 'on' || ($body->notice ?? '') !== 'basvuru-v1' || !empty($body->website)) {
            throw new RuntimeException('Başvuru onayını ve bilgilerinizi kontrol edin.',422);
        }
        $kind = $body->kind ?? '';
        $billing = $body->billing ?? '';
        $plan = $body->plan ?? '';
        if (!in_array($kind,['demo','trial','contact'],true) || !in_array($billing,['monthly','yearly'],true)
            || !is_string($plan) || ($plan !== '' && !isset($this->publishedCatalog()[$plan]))) {
            throw new RuntimeException('Başvuru türü veya paket geçersiz.',422);
        }
        $email = $this->field($body,'email',254,true);
        $phone = $this->field($body,'phone',24,$kind !== 'contact');
        if (!filter_var($email,FILTER_VALIDATE_EMAIL) || ($phone !== '' && !preg_match('/\A[0-9+() .-]{7,24}\z/',$phone))) {
            throw new RuntimeException('E-posta veya telefon geçersiz.',422);
        }
        $fields = [$kind,$this->field($body,'name',120,true),$this->field($body,'clinic',160,true),$email,$phone,
            $this->field($body,'message',2000),$this->field($body,'currentProgram',160),$plan,$billing,'basvuru-v1'];
        $fingerprint = hash_hmac('sha256',json_encode($fields,JSON_THROW_ON_ERROR),$key);
        $stmt = $this->db->prepare('INSERT INTO clinic_lead(id,kind,name,clinic,email,phone,message,current_program,plan_id,billing,notice_version,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id');
        $stmt->execute([$id,...$fields,$fingerprint]);
        $created=$stmt->rowCount()===1;
        $stmt = $this->db->prepare('SELECT fingerprint FROM clinic_lead WHERE id=?');
        $stmt->execute([$id]);
        if (!hash_equals($fingerprint,(string)$stmt->fetchColumn())) throw new RuntimeException('Başvuru numarası başka bilgilerle kullanıldı.',409);
        if ($created && in_array($kind,['demo','trial'],true) && $notifications) {
            try { $notifications->demoApplication($email,$fields[2]); }
            catch (\Throwable $error) { error_log('VetZimo notification: '.get_class($error)); }
        }
        return ['reference'=>$id];
    }

    public function leads(): array
    {
        return $this->db->query('SELECT id,kind,name,clinic,email,phone,message,current_program,plan_id,billing,stage,created_at FROM clinic_lead ORDER BY created_at DESC,id LIMIT 200')->fetchAll(PDO::FETCH_ASSOC);
    }

    public function leadDetail(string $id): array
    {
        $query=$this->db->prepare('SELECT id,kind,name,clinic,email,phone,message,current_program,plan_id,billing,stage,created_at FROM clinic_lead WHERE id=?');
        $query->execute([$id]);
        $lead=$query->fetch();
        if (!$lead) throw new RuntimeException('Başvuru bulunamadı.',404);
        $history=$this->db->prepare('SELECT id,actor,stage,note,trial_partner,created_at FROM clinic_lead_review WHERE lead_id=? ORDER BY id DESC LIMIT 200');
        $history->execute([$id]);
        return ['lead'=>$lead,'history'=>$history->fetchAll()];
    }

    public function review(object $body,array $actor,Center $center,int $now): array
    {
        $id=$this->field($body,'id',36,true);
        $note=$this->field($body,'note',1200);
        $stage=$body->stage ?? '';
        $action=$body->action ?? 'stage';
        if (!in_array($stage,['new','contacted','qualified','won','lost'],true) || !in_array($action,['stage','trial','demo'],true)) {
            throw new RuntimeException('Başvuru işlemi geçersiz.',422);
        }
        $this->db->beginTransaction();
        try {
            $lock=$this->db->prepare('SELECT id FROM clinic_lead WHERE id=? FOR UPDATE');
            $lock->execute([$id]);
            if (!$lock->fetchColumn()) throw new RuntimeException('Başvuru bulunamadı.',404);
            ['lead'=>$lead,'history'=>$history]=$this->leadDetail($id);
            if (($body->version ?? null)!==(string)($history[0]['id'] ?? '0')) throw new RuntimeException('Başvuru değişti. Ayrıntıları yeniden açın.',409);
            $partner=null;
            $activation=null;
            if ($action!=='stage') {
                if (!in_array($lead['kind'],['demo','trial'],true) || $lead['stage']==='lost'
                    || ($body->verified ?? false)!==true) throw new RuntimeException('Başvuruyu değerlendirin ve kimlik kontrolünü onaylayın.',422);
                $prior=$this->db->prepare('SELECT id FROM clinic_lead_review WHERE lead_id=? AND trial_partner IS NOT NULL LIMIT 1');
                $prior->execute([$id]);
                if ($prior->fetchColumn()) throw new RuntimeException('Bu başvuru için deneme dönemi zaten açıldı.',409);
                if ($action==='demo') {
                    $activation=$center->create($actor,(object)['name'=>$lead['clinic'],'phone'=>$lead['phone'],'email'=>$lead['email']],$now);
                    $partner=$activation['id'];
                } else {
                    $partner=$this->field($body,'partnerId',32,true);
                    $partnerLock=$this->db->prepare('SELECT id FROM partner_account WHERE id=? AND active=1 FOR UPDATE');
                    $partnerLock->execute([$partner]);
                    if (!$partnerLock->fetchColumn()) throw new RuntimeException('Etkin bayi bulunamadı.',404);
                    $phone=DealerLogin::normalizePhone($lead['phone']);
                    $query=$this->db->prepare("SELECT 1 FROM identity_membership m JOIN identity_account a ON a.id=m.account_id
                        WHERE m.partner_id=? AND m.role='dealer' AND m.status='active' AND a.kind='phone'
                        AND a.identifier=? AND a.verified_at>0 AND a.blocked=0 LIMIT 1");
                    $query->execute([$partner,$phone]);
                    if (!$phone || !$query->fetchColumn()) throw new RuntimeException('Başvuru telefonu doğrulanmış bayi yöneticisiyle eşleşmiyor.',422);
                }
                $days=filter_var($body->days ?? null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>90]]);
                if (!$days) throw new RuntimeException('Deneme süresi 1–90 gün olmalıdır.',422);
                $start=new \DateTimeImmutable('today',new \DateTimeZone('Europe/Istanbul'));
                $this->assign((object)['partnerId'=>$partner,'plan'=>$body->plan ?? '','kind'=>'trial',
                    'starts_on'=>$start->format('Y-m-d'),'ends_on'=>$start->modify('+'.($days-1).' days')->format('Y-m-d')]);
                $stage='won';
            }
            if ($stage!==$lead['stage'] || $note!=='' || $partner!==null) {
                $this->db->prepare('UPDATE clinic_lead SET stage=? WHERE id=?')->execute([$stage,$id]);
                $this->db->prepare('INSERT INTO clinic_lead_review(lead_id,actor,stage,note,trial_partner) VALUES (?,?,?,?,?)')
                    ->execute([$id,$actor['identifier'],$stage,$note,$partner]);
            }
            $this->db->commit();
            return ['activation'=>$activation['link'] ?? null,'email'=>$activation ? $lead['email'] : null];
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function assign(object $body): void
    {
        $partner = $this->field($body,'partnerId',80,true);
        $plan = $this->catalog()[$this->field($body,'plan',32,true)] ?? null;
        $start = $this->field($body,'starts_on',10,true);
        $end = $this->field($body,'ends_on',10,true);
        $kind = $body->kind ?? '';
        if (!$plan || !in_array($kind,['trial','assigned'],true) || !$this->validDay($start) || !$this->validDay($end) || $start > $end) {
            throw new RuntimeException('Paket ve tarih aralığını kontrol edin.',422);
        }
        $stmt = $this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');
        $stmt->execute([$partner]);
        if (!$stmt->fetchColumn()) throw new RuntimeException('Bayi bulunamadı.',404);
        $stmt = $this->db->prepare('SELECT id FROM clinic_subscription WHERE partner_id=? AND starts_on<=? AND ends_on>=? LIMIT 1');
        $stmt->execute([$partner,$end,$start]);
        if ($stmt->fetchColumn()) throw new RuntimeException('Bu tarihler mevcut bir dönemle çakışıyor.',409);
        $this->db->prepare('INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES(?,?,?,?,?,?)')
            ->execute([$partner,$plan['id'],$plan['name'],$kind,$start,$end]);
    }

    public function subscription(string $partner): array
    {
        $day = (new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $stmt = $this->db->prepare('SELECT id,plan_name,kind,starts_on,ends_on FROM clinic_subscription WHERE partner_id=? ORDER BY starts_on DESC,id DESC');
        $stmt->execute([$partner]);
        $terms = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $current = null;
        $scheduled = false;
        foreach ($terms as &$term) {
            $term['status'] = $term['starts_on'] > $day ? 'scheduled' : ($term['ends_on'] < $day ? 'expired' : 'active');
            if ($term['status'] === 'active') $current = $term;
            if ($term['status'] === 'scheduled') $scheduled = true;
        }
        unset($term);
        return ['day'=>$day,'terms'=>$terms,'current'=>$current,'status'=>$current ? 'active' : ($scheduled ? 'scheduled' : ($terms ? 'expired' : 'unmanaged'))];
    }

    private function field(object $body,string $name,int $limit,bool $required=false): string
    {
        $value = $body->$name ?? '';
        if (!is_string($value) || !preg_match('/\A.{0,'.$limit.'}\z/us',trim($value)) || ($required && trim($value) === '')) {
            throw new RuntimeException('Form alanlarını kontrol edin.',422);
        }
        return trim($value);
    }

    private function validDay(string $value): bool
    {
        return preg_match('/\A(20[0-9]{2})-([0-9]{2})-([0-9]{2})\z/',$value,$parts) === 1 &&
            checkdate((int)$parts[2],(int)$parts[3],(int)$parts[1]);
    }
}
