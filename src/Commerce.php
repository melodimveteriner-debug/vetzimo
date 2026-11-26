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

    /** Bu sayı ve üzeri "Sınırsız" demektir (paket sınırlarında rakam yerine sınırsız yazmak için). */
    public const UNLIMITED=999999;

    /** Paket sınırı: null = sınırsız. */
    public static function limit(mixed $value): ?int
    {
        return is_int($value) && $value < self::UNLIMITED ? $value : null;
    }

    public const TERMS=[
        'users'=>['Kullanıcı',100000],'branches'=>['Şube',100000],'patients'=>['Hasta kaydı',10000000],'clients'=>['Hasta sahibi kaydı',10000000],
        'storage'=>['Depolama (GB)',100000],'sms'=>['Aylık SMS gönderim sınırı',10000000],'whatsapp'=>['Aylık WhatsApp gönderim sınırı',10000000],
        'okc'=>['ÖKC hakkı',100000],'edoc'=>['E-dönüşüm hakkı',100000],
        'support'=>['Destek kapsamı',null],'trial'=>['Deneme süresi (gün)',365],'discount'=>['Yıllık indirim (%)',100],
    ];

    /** Eski paketler ve yerini alan güncel paket (eski paketteki abonelikler bir kez buraya taşınır). */
    public const LEGACY_PLANS=['baslangic'=>'pro','profesyonel'=>'plus','kurumsal'=>'ozel'];
    private static bool $legacyChecked=false;

    /** Bir kez çalışır: eski paketlerdeki süren abonelikleri karşılık gelen güncel pakete taşır ve eski paketleri listelerden kaldırır. */
    private function retireLegacyPlans(): void
    {
        if (self::$legacyChecked) return;
        self::$legacyChecked=true;
        try {
            // Önceki sürümün işareti 08 numarasına (merkez iletişim kaydı) yazılmıştı: varsa kaldırılır / merkez iletişime geri döner.
            $old=$this->db->query("SELECT payload FROM center_management WHERE id='00000000000000000000000000000008' AND kind='legacy_plans'")->fetchColumn();
            if ($old!==false) {
                if (isset(json_decode((string)$old,true)['phone'])) $this->db->exec("UPDATE center_management SET kind='center_contact' WHERE id='00000000000000000000000000000008'");
                else $this->db->exec("DELETE FROM center_management WHERE id='00000000000000000000000000000008' AND kind='legacy_plans'");
            }
            $q=$this->db->prepare("SELECT 1 FROM center_management WHERE id=? AND kind='legacy_plans'");
            $q->execute(['0000000000000000000000000000a002']);
            if ($q->fetchColumn()) return;
            $names=array_column(self::plans(),'name','id');
            foreach ($this->db->query('SELECT plan_id,settings FROM clinic_package_settings')->fetchAll(PDO::FETCH_KEY_PAIR) as $id=>$json) {
                $names[$id]=json_decode((string)$json,true)['name'] ?? ($names[$id] ?? $id);
            }
            $today=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
            foreach (self::LEGACY_PLANS as $old=>$new) {
                $this->db->prepare('UPDATE clinic_subscription SET plan_id=?,plan_name=? WHERE plan_id=? AND ends_on>=?')->execute([$new,$names[$new] ?? $new,$old,$today]);
                $this->db->prepare("UPDATE clinic_package_settings SET settings=JSON_SET(settings,'$.deleted',true,'$.published',false) WHERE plan_id=?")->execute([$old]);
            }
            $this->db->prepare("INSERT IGNORE INTO center_management(id,kind,payload) VALUES (?,'legacy_plans','{\"done\":true}')")->execute(['0000000000000000000000000000a002']);
        } catch (\PDOException) { /* tablolar henüz yoksa sonraki istekte denenir */ self::$legacyChecked=false; }
    }

    public function catalog(): array
    {
        $this->retireLegacyPlans();
        $plans=self::plans();
        foreach ($this->db->query('SELECT plan_id,settings FROM clinic_package_settings') as $row) {
            $id=$row['plan_id'];
            $settings=json_decode($row['settings'],true,32,JSON_THROW_ON_ERROR);
            // Merkezden silinen paket hiçbir listede ve satış sitesinde görünmez.
            if (($settings['deleted'] ?? false)===true) { unset($plans[$id]); continue; }
            $plans[$id]=array_replace($plans[$id] ?? ['id'=>$id,'terms'=>(object)[]],$settings);
        }
        return $plans;
    }

    /** Paketi siler. Süren/ileri tarihli aboneliği veya bekleyen ödemesi olan paket silinemez; geçmiş kayıtlar korunur. */
    public function deletePackage(object $body): string
    {
        $id=$this->field($body,'id',32,true);
        $catalog=$this->catalog();
        if (!isset($catalog[$id])) throw new RuntimeException('Paket bulunamadı.',404);
        $today=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $q=$this->db->prepare('SELECT COUNT(DISTINCT partner_id) FROM clinic_subscription WHERE plan_id=? AND ends_on>=?');
        $q->execute([$id,$today]);
        if (($n=(int)$q->fetchColumn())>0) throw new RuntimeException($n.' bayinin bu pakette süren aboneliği var. Önce bayileri başka pakete geçirin; abonelikler bitince paket silinebilir.',409);
        try {
            $q=$this->db->prepare("SELECT COUNT(*) FROM saas_order WHERE plan_id=? AND status NOT IN ('paid','failed','rejected','cancelled','expired')");
            $q->execute([$id]);
            if ((int)$q->fetchColumn()>0) throw new RuntimeException('Bu paket için bekleyen ödeme var. Önce Ödeme Onayları ekranında sonuçlandırın.',409);
        } catch (\PDOException $e) { if ($e->getCode()!=='42S02') throw $e; }
        $published=array_filter($catalog,static fn(array $p): bool=>($p['published'] ?? true)!==false && $p['id']!==$id);
        if (($catalog[$id]['published'] ?? true)!==false && !$published) throw new RuntimeException('Satış sitesinde en az bir yayında paket kalmalıdır.',409);
        $this->db->prepare('INSERT INTO clinic_package_settings(plan_id,settings) VALUES (?,?) ON DUPLICATE KEY UPDATE settings=VALUES(settings)')
            ->execute([$id,json_encode(['deleted'=>true,'published'=>false,'name'=>(string)($catalog[$id]['name'] ?? $id)],JSON_THROW_ON_ERROR)]);
        return (string)($catalog[$id]['name'] ?? $id);
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
        $rank=$body->rank ?? ($this->catalog()[$id]['rank'] ?? null);
        if ($rank!==null) {
            if (!is_int($rank) || $rank<0 || $rank>99) throw new RuntimeException('Paket seviyesi 0–99 olmalıdır.',422);
            $settings['rank']=$rank;
        }
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
            } elseif (!in_array($key,['trial','discount'],true) && ($value==='unlimited' || (is_int($value) && $value>=self::UNLIMITED))) {
                // 999999 ve üzeri her sınır alanında (kullanıcı, şube, depolama, ÖKC dahil) "sınırsız" demektir.
                $value='unlimited';
            } elseif (!is_int($value) || $value<0 || $value>$max) {
                throw new RuntimeException($label.' geçersiz.',422);
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
        // Silinmiş bir paket kodu yeniden kullanılırsa eski (silindi) kaydının yerine yazılır.
        $reuse=$create && $this->db->query('SELECT 1 FROM clinic_package_settings WHERE plan_id='.$this->db->quote($id))->fetchColumn();
        $this->db->prepare('INSERT INTO clinic_package_settings(plan_id,settings) VALUES (?,?)'.($create && !$reuse?'':' ON DUPLICATE KEY UPDATE settings=VALUES(settings)'))
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
        $actor['packageLimits']=['sms'=>self::limit($terms['sms'] ?? null),'whatsapp'=>self::limit($terms['whatsapp'] ?? null),
            'patients'=>self::limit($terms['patients'] ?? null),'clients'=>self::limit($terms['clients'] ?? null),
            'users'=>self::limit($terms['users'] ?? null),'branches'=>self::limit($terms['branches'] ?? null),'storage'=>self::limit($terms['storage'] ?? null)];
        // Satın alınan ek paketler (kullanıcı, şube, hasta, hasta sahibi kaydı, depolama) paket sınırına eklenir.
        if (class_exists(AddonPackages::class) && !empty($actor['partner_id'])) $actor['packageLimits']=(new AddonPackages($this->db))->raise((string)$actor['partner_id'],$actor['packageLimits']);
        return $actor;
    }

    public function publishedCatalog(): array
    {
        return array_filter($this->catalog(),static fn(array $plan): bool=>($plan['published'] ?? true)!==false);
    }

    /** Satış sitesi karşılaştırmasında modül satırları (paketin modül iznine göre ✓ / ✗). */
    private const MODULE_ROWS=[
        'clients'=>'Hasta sahibi kartları, belgeler ve ziyaretçiler','patients'=>'Hasta kartı, muayene, tetkik, reçete ve tedavi',
        'appointments'=>'Randevu takvimi','followups'=>'Aşı takvimi ve takip','sales'=>'Satış ve tahsilat','products'=>'Ürün, stok ve alış',
        'expenses'=>'Kasa ve muhasebe','reports'=>'Raporlar','messages'=>'SMS ve WhatsApp şablonları','support'=>'VetZimo destek talepleri','esmm'=>'e-SMM portal erişimi',
    ];

    /** Paket karşılaştırması: kartlar + tüm özelliklerin satır satır ✓ / ✗ tablosu + sınırlar (999999 ve üzeri = Sınırsız). */
    public function marketPackages(): string
    {
        $e=static fn(string $text)=>htmlspecialchars($text,ENT_QUOTES,'UTF-8');
        $plans=array_values($this->publishedCatalog());
        usort($plans,static fn($a,$b)=>[(int)($a['rank'] ?? 50),(int)($a['yearly'] ?? 0)]<=>[(int)($b['rank'] ?? 50),(int)($b['yearly'] ?? 0)]);
        if (!$plans) return '<p>Şu anda yayında paket yok.</p>';
        $tick='<span class="pk-yes" aria-label="Var"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="M7 12.5l3.2 3.2L17 9"/></svg></span>';
        $cross='<span class="pk-no" aria-label="Yok"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg></span>';
        $limit=static function(mixed $v) use($e,$cross): string {
            if ($v==='unlimited' || (is_int($v) && $v>=self::UNLIMITED)) return '<span class="pk-limit unlimited">Sınırsız</span>';
            if ($v===0) return $cross;
            if (is_int($v)) return '<span class="pk-limit"><small>Sınırlı</small> '.number_format($v,0,',','.').'</span>';
            return '<span class="pk-limit muted">'.($v===null||$v===''?'—':$e((string)$v)).'</span>';
        };
        $cards='';
        foreach ($plans as $n=>$plan) {
            $featured=($plan['id'] ?? '')==='plus' ? ' featured' : '';
            $cards.='<article class="pk-card'.$featured.'" style="--i:'.$n.'">'.($featured?'<span class="pk-badge">En çok tercih edilen</span>':'').'<h2>'.$e($plan['name']).'</h2><p>'.$e($plan['description']).'</p>';
            foreach (['monthly'=>'Aylık','yearly'=>'Yıllık'] as $key=>$label) {
                $price=$plan[$key];
                $free=(int)($plan['rank'] ?? -1)===0 && $price===null && ($plan['id'] ?? '')==='ucretsiz';
                // Kurumsal (en üst seviye) teklifle satılır; diğer ücretli paketlerde fiyat girilmemişse "Fiyat eklenecek" yazar.
                $quote=($plan['id'] ?? '')==='ozel';
                $amount=$free?'Ücretsiz':($price===null?($quote?'Teklif isteyin':'Fiyat eklenecek'):number_format($price/100,2,',','.').' ₺');
                $vat=$plan['vat']==='included'?'KDV dahil':'+ KDV';
                $note=$free?'Süresiz':($price===null?($quote?$label:$label.' · '.$vat):$label.' · '.$vat);
                $cards.='<div class="pk-price" data-price="'.$key.'"'.($key==='yearly'?' hidden':'').'><strong>'.$amount.'</strong><small>'.$note.'</small></div>';
            }
            if (!empty($plan['features'])) $cards.='<ul class="pk-points"><li>'.implode('</li><li>',array_map($e,$plan['features'])).'</li></ul>';
            $pid=(string)($plan['id'] ?? '');
            $buyable=$pid!=='ucretsiz' && $pid!=='ozel';
            if ($buyable) {
                // Pro, Plus ve fiyatı girilmiş diğer paketler: doğrudan ödeme ekranı (kart / havale)
                $cards.='<a class="button '.($featured?'primary':'outline').'" data-plan-link href="/platform/satin-al?plan='.rawurlencode($pid).'&amp;donem=monthly">Satın Alın</a></article>';
            } else {
                $cards.='<a class="button '.($featured?'primary':'outline').'" data-plan-link href="/platform/deneme?plan='.rawurlencode($pid).'&amp;donem=monthly">'.($pid==='ucretsiz'?'Ücretsiz başlayın':($pid==='ozel'?'Teklif isteyin':'Bilgi alın')).'</a></article>';
            }
        }
        $head='<thead><tr><th scope="col">Özellik</th>';
        foreach ($plans as $plan) $head.='<th scope="col">'.$e($plan['name']).'</th>';
        $head.='</tr></thead>';
        $row=0;
        $section=static function(string $title) use(&$row,$plans): string { $row++; return '<tr class="pk-section" style="--r:'.$row.'"><th colspan="'.(count($plans)+1).'" scope="colgroup">'.htmlspecialchars($title,ENT_QUOTES,'UTF-8').'</th></tr>'; };
        $body=$section('Kullanım sınırları');
        foreach (['patients'=>'Hasta kaydı','clients'=>'Hasta sahibi kaydı','sms'=>'Aylık SMS (kendi hattınızdan)','whatsapp'=>'Aylık WhatsApp','users'=>'Kullanıcı','branches'=>'Şube','support'=>'Destek'] as $k=>$label) {
            $row++; $body.='<tr style="--r:'.$row.'"><th scope="row">'.$e($label).'</th>';
            foreach ($plans as $plan) $body.='<td>'.$limit(((array)($plan['terms'] ?? []))[$k] ?? null).'</td>';
            $body.='</tr>';
        }
        $body.=$section('Temel modüller');
        foreach (self::MODULE_ROWS as $k=>$label) {
            $row++; $body.='<tr style="--r:'.$row.'"><th scope="row">'.$e($label).'</th>';
            foreach ($plans as $plan) { $g=$plan['modules'][$k] ?? (isset($plan['modules'])?'none':'write'); $body.='<td>'.($g==='none'?$cross:$tick).'</td>'; }
            $body.='</tr>';
        }
        $body.=$section('Özellikler');
        foreach (ClinicAccess::FEATURES as $k=>$label) {
            $row++; $body.='<tr style="--r:'.$row.'"><th scope="row">'.$e($label).'</th>';
            foreach ($plans as $plan) $body.='<td>'.((($plan['capabilities'][$k] ?? true)!==false)?$tick:$cross).'</td>';
            $body.='</tr>';
        }
        $legend='<p class="pk-legend">'.$tick.' Pakette var '.$cross.' Pakette yok · Sınırlar aylık gönderim ve toplam kayıt sayısıdır.</p>';
        return '<link rel="stylesheet" href="/market-plans.css?v=2"><div class="pk-cards">'.$cards.'</div>'
            .'<section class="pk-compare"><h2 class="sub-title">Paketleri karşılaştırın</h2>'.$legend
            .'<div class="table-scroll pk-table" tabindex="0" role="region" aria-label="Paket karşılaştırması"><table>'.$head.'<tbody>'.$body.'</tbody></table></div></section>';
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
            return ['activation'=>$activation['link'] ?? null,'email'=>$activation ? $lead['email'] : null,'name'=>$activation['name'] ?? null,'phone'=>$activation['phone'] ?? null];
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
