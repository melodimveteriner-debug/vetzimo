<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;
use PDO;

final class HomeVisitPages
{
    private static bool $clinicPanel=false;
    private static string $clinicPalette='classic';
    /** Hasta sahibi Evde Hizmet sayfalarının teması (sitenin genel teması). */
    private static string $surfacePalette='';
    private const COOKIE='__Host-vetnet-visit';
    private const SETTINGS='/clinic/evde-hizmet?gorunum=ayarlar';
    private const NOTIFICATIONS='/clinic/evde-hizmet?gorunum=bildirim-ayarlari';
    public function __construct(private readonly HomeVisit $visits,private readonly PDO $db) {}
    private static function e(mixed $text): string {return WebBuilderAdmin::e((string)$text);}
    private static function cost(int $money): string {return number_format($money/100,2,',','.').' ₺';}
    private static function redirect(string $route): never
    {
        if (self::$clinicPanel && (str_starts_with($route,'/clinic/evde-hizmet')||str_starts_with($route,'/yonetim/evde-hizmet'))) {
            $route.=(str_contains($route,'?')?'&':'?').'panel=1';
        }
        header('Location: '.$route,true,303);
        exit;
    }
    private static function field(string $key,string $label,mixed $value='',string $type='text',bool $required=false): string
    {
        return '<label>'.self::e($label).'<input type="'.self::e($type).'" name="'.self::e($key).'" value="'.self::e($value).'"'.($required?' required':'').'></label>';
    }

    private static function select(string $key,string $label,array $items,mixed $selected='',bool $required=false,string $placeholder='Seçin'): string
    {
        $html='<label>'.self::e($label).'<select name="'.$key.'"'.($required?' required':'').'><option value="">'.self::e($placeholder).'</option>';
        foreach ($items as $value=>$name) $html.='<option value="'.self::e($value).'"'.((string)$value===(string)$selected?' selected':'').'>'.self::e($name).'</option>';
        return $html.'</select></label>';
    }

    private static function box(string $key,string $label,bool $checked=false,bool $required=false,string $value='yes'): string
    {
        return '<label class="check"><input type="checkbox" name="'.$key.'" value="'.self::e($value).'"'.($checked?' checked':'').($required?' required':'').'> '.self::e($label).'</label>';
    }

    private static function memo(string $key,string $label,string $value='',bool $required=false): string
    {
        return '<label class="wide">'.self::e($label).'<textarea name="'.$key.'"'.($required?' required':'').'>'.self::e($value).'</textarea></label>';
    }

    private static function form(string $content,string $label='Kaydet',string $action='',bool $serverValidation=false): string
    {
        return '<form class="visit-form" method="post"'.($action?' action="'.self::e($action).'"':'').($serverValidation?' novalidate':'').'>'.$content.'<div class="wide"><button class="button">'.$label.'</button></div></form>';
    }

    private static function hidden(string $key,mixed $value): string
    {return '<input type="hidden" name="'.$key.'" value="'.self::e($value).'">';}

    private static function version(array $row,string $action): string
    {return self::hidden('revision',$row['revision']).self::hidden('action',$action);}
    private static function button(array $row,string $action,string $label): string
    {return self::form(self::version($row,$action),$label);}

    private static function page(string $title,string $return,string $html,int $code=200,bool $sensitiveUrl=false,bool $embedded=false,string $palette=''): never
    {
        $embedded=$embedded||self::$clinicPanel;
        $notificationSkin=$palette!=='';
        if (self::$clinicPanel) $palette=self::$clinicPalette;
        elseif (!$notificationSkin && self::$surfacePalette!=='') $palette=self::$surfacePalette;
        $surface=!self::$clinicPanel && !$notificationSkin && $palette!=='';
        header("Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors ".($embedded?"'self'":"'none'")."; form-action 'self'; connect-src 'self'; worker-src 'self'");
        // A native same-origin POST needs its Origin for the front controller check.
        header('Referrer-Policy: '.($sensitiveUrl?'strict-origin':'same-origin'));
        header('Cache-Control: no-store');
        header('X-Robots-Tag: noindex, nofollow');
        header('Content-Type: text/html; charset=utf-8');
        http_response_code($code);
        $classes=trim(($notificationSkin?'notification-center ':'').(self::$clinicPanel?'clinic-visit-panel':'').($surface?'visit-surface':''));
        echo '<!doctype html><html lang="tr"'.($palette!==''?' data-theme="'.self::e($palette).'" class="'.$classes.'"':'').'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'.
            '<title>'.self::e($title).' · VetZimo</title><link rel="icon" href="/favicon.ico?v=51" type="image/x-icon"><link rel="stylesheet" href="/home-visits.css?v=61"><script src="/home-visits.js?v=53" defer></script>'.
            ($palette!==''?'<link rel="stylesheet" href="/themes.css?v=20261126-r9">':'').
            ($surface?'<link rel="stylesheet" href="/surface-themes.css?v=20261126-r5">':'').
            ($notificationSkin?'<link rel="stylesheet" href="/notification-center.css?v=53">':'').
            (self::$clinicPanel?'<link rel="stylesheet" href="/clinic-visit-panel.css?v=51">':'').'</head>'.
            ($embedded?'<body class="visit-embedded">':'<body><header><div><a href="'.self::e($return).'"><img class="visit-brand-logo" src="/vetzimo-logo.webp" alt="VetZimo" width="140" height="38"></a>'.
                ($notificationSkin?'<a href="/clinic#settings">Ayarlara dön</a>':'<span>Evde Hizmet</span>').'</div></header>').
            '<main><h1>'.self::e($title).'</h1>'.$html.'</main></body></html>';
        exit;
    }

    private static function warning(string $message): string
    {
        return '<p class="visit-error" role="alert" tabindex="-1" autofocus>'.self::e($message).'</p>';
    }

    public static function settingsError(string $message,int $status): never
    {
        self::page('Evde Hizmet Ayarları','/clinic/evde-hizmet',self::warning($message).
            '<p><a class="visit-link" href="'.self::e(self::SETTINGS).'">Ayarları yeniden aç</a></p>',$status);
    }

    private const MAIL_QUEUES=[
        'visit'=>['vetnet.home-visit.mail',10,
            "SELECT m.event_id AS job,m.audience,m.retry_at AS scheduled,m.attempts,m.failure,e.created_at AS created,
                CASE WHEN m.secret IS NOT NULL AND (r.token_hash IS NULL OR r.token_expires<?) THEN 0
                    WHEN m.failure IN ('Bağlantı kullanıldı veya süresi doldu.','Alıcı adresi tanımlı değil.') THEN 0 ELSE 1 END AS retryable
                FROM clinic_visit_mail m JOIN clinic_visit_event e ON e.id=m.event_id
                JOIN clinic_visit_request r ON r.id=e.visit_id WHERE r.partner_id=? AND m.sent_at IS NULL",
            "UPDATE clinic_visit_mail m JOIN clinic_visit_event e ON e.id=m.event_id JOIN clinic_visit_request r ON r.id=e.visit_id
                SET m.retry_at=?,m.attempts=0,m.failure='' WHERE r.partner_id=? AND m.event_id=? AND m.audience=? AND m.sent_at IS NULL
                AND (m.secret IS NULL OR (r.token_hash IS NOT NULL AND r.token_expires>=?))
                AND m.failure NOT IN ('Bağlantı kullanıldı veya süresi doldu.','Alıcı adresi tanımlı değil.')",
            "SELECT m.sent_at,m.attempts,m.failure FROM clinic_visit_mail m JOIN clinic_visit_event e ON e.id=m.event_id
                JOIN clinic_visit_request r ON r.id=e.visit_id WHERE r.partner_id=? AND m.event_id=? AND m.audience=?"],
        'clinic'=>['vetnet.home-visit.mail',10,
            "SELECT id AS job,'' AS audience,next_at AS scheduled,attempts,'' AS failure,created_at AS created,1 AS retryable
                FROM clinic_delivery_notice WHERE partner_id=? AND sent_at IS NULL AND (kind='clinic' OR recipient_email<>'')",
            "UPDATE clinic_delivery_notice SET next_at=?,attempts=0 WHERE partner_id=? AND id=? AND sent_at IS NULL
                AND (kind='clinic' OR recipient_email<>'')",
            "SELECT sent_at,attempts,'' AS failure FROM clinic_delivery_notice WHERE partner_id=? AND id=?
                AND (kind='clinic' OR recipient_email<>'')"],
        'appointment'=>['vetnet.web.mail',12,
            "SELECT m.appointment_id AS job,'' AS audience,m.next_at AS scheduled,m.attempts,m.last_error AS failure,a.created_at AS created,1 AS retryable
                FROM clinic_web_mail m JOIN clinic_web_appointment a ON a.partner_id=m.partner_id AND a.id=m.appointment_id
                WHERE m.partner_id=? AND m.sent_at IS NULL",
            "UPDATE clinic_web_mail SET next_at=?,attempts=0,last_error='' WHERE partner_id=? AND appointment_id=? AND sent_at IS NULL",
            "SELECT sent_at,attempts,last_error AS failure FROM clinic_web_mail WHERE partner_id=? AND appointment_id=?"],
        'contact'=>['vetnet.web.mail',12,
            "SELECT id AS job,'' AS audience,notify_at AS scheduled,notify_attempts AS attempts,notify_error AS failure,created_at AS created,1 AS retryable
                FROM clinic_web_inbox WHERE partner_id=? AND notified_at IS NULL AND notify_at IS NOT NULL",
            "UPDATE clinic_web_inbox SET notify_at=?,notify_attempts=0,notify_error='' WHERE partner_id=? AND id=?
                AND notified_at IS NULL AND notify_at IS NOT NULL",
            "SELECT notified_at AS sent_at,notify_attempts AS attempts,notify_error AS failure FROM clinic_web_inbox
                WHERE partner_id=? AND id=? AND notify_at IS NOT NULL"],
    ];

    private static function notificationJob(array $input): array
    {
        $source=$input['source']??'';$job=$input['job']??'';$audience=$input['audience']??'';
        if (!is_string($source)||!isset(self::MAIL_QUEUES[$source])||!is_string($job)||!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D',$job)
            ||($source!=='appointment'&&!preg_match('/\A[1-9][0-9]{0,18}\z/D',$job))
            ||($source==='visit'&&!in_array($audience,['clinic','owner'],true))) {
            throw new RuntimeException('Bildirim kaydı geçersiz.',422);
        }
        return [$source,$job,$audience];
    }

    private function notificationState(string $partner,array $identity): array
    {
        [$source,$job,$audience]=$identity;
        $params=[$partner,$job];
        if ($source==='visit') $params[]=$audience;
        $row=$this->visits->web->query(self::MAIL_QUEUES[$source][4],$params)->fetch();
        if (!$row) throw new RuntimeException('Bildirim bulunamadı.',404);
        if ($row['sent_at']!==null) return ['state'=>'sent'];
        if ((int)$row['attempts']>0) return ['state'=>'failed','message'=>$row['failure']?:'E-posta gönderilemedi. SMTP ve alıcı ayarlarını kontrol edin.'];
        return ['state'=>'queued'];
    }

    private function retryNotification(string $partner,int $now,array $identity): void
    {
        [$source,$job,$audience]=$identity;
        [$lock,,,$sql]=self::MAIL_QUEUES[$source];
        if ((int)$this->visits->web->query('SELECT GET_LOCK(?,0)',[$lock])->fetchColumn()!==1) {
            throw new RuntimeException('Gönderim kuyruğu çalışıyor. Kısa süre sonra tekrar deneyin.',409);
        }
        try {
            $params=[$now,$partner,$job];
            if ($source==='visit') array_push($params,$audience,$now);
            if (!$this->visits->web->query($sql,$params)->rowCount()) {
                throw new RuntimeException('Bildirim yeniden sıraya alınamadı. Gönderilmiş, süresi dolmuş veya başka bir kliniğe ait olabilir.',409);
            }
        } finally {
            $this->visits->web->query('SELECT RELEASE_LOCK(?)',[$lock]);
        }
    }

    private function pendingNotifications(string $partner,int $now): string
    {
        $rows=[];
        $labels=['visit'=>'Evde Hizmet','clinic'=>'Klinik bildirimi','appointment'=>'Web randevusu','contact'=>'Web mesajı'];
        foreach (self::MAIL_QUEUES as $source=>[,$limit,$sql]) {
            $params=$source==='visit'?[$now,$partner]:[$partner];
            foreach ($this->visits->web->query($sql.' ORDER BY created DESC,job DESC LIMIT 25',$params)->fetchAll() as $row) {
                $rows[]=$row+['source'=>$source,'maxAttempts'=>$limit];
            }
        }
        usort($rows,static fn($a,$b)=>[$b['created'],$b['job']]<=>[$a['created'],$a['job']]);
        $body='';
        foreach (array_slice($rows,0,25) as $row) {
            $exhausted=$row['attempts'] >= $row['maxAttempts'] || !$row['retryable'];
            $state=$exhausted?'İşlem gerekli':($row['attempts']?'Yeniden denenecek':'Bekliyor');
            $detail=$row['failure']?:($row['attempts']?'Önceki gönderim tamamlanamadı.':'Gönderim sırası bekleniyor.');
            if (!$row['retryable']&&$row['source']==='visit'&&!$row['failure']) $detail='Takip bağlantısı geçersiz. Başvurudan yeni bağlantı gönderin.';
            $created=(new \DateTimeImmutable($row['created'],new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('Europe/Istanbul'));
            $retry=$row['retryable']?self::form(self::hidden('action','retry').self::hidden('source',$row['source']).
                self::hidden('job',$row['job']).self::hidden('audience',$row['audience']),'Yeniden dene',self::NOTIFICATIONS.(self::$clinicPanel?'&panel=1':'')):'';
            $body.='<tr><td>'.self::e($created->format('d.m.Y H:i')).'</td><td>E-posta</td><td><span class="state" data-mail-state>'.
                self::e($state).'</span></td><td><strong>'.self::e($labels[$row['source']]).'</strong><br><span data-mail-detail>'.self::e($detail).'</span></td><td>'.$retry.'</td></tr>';
        }
        return '<section aria-labelledby="queue-heading"><h2 id="queue-heading">İşlem bekleyen bildirimler</h2>'.
            '<p>Kliniğiniz için gönderilmeyi bekleyen son 25 işlem. Başarıyla gönderilen e-postalar listeden kalkar.</p>'.
            '<p data-mail-feedback role="status" aria-live="polite"></p>'.
            ($body?'<div class="notification-table" role="region" aria-label="Bekleyen bildirimler" tabindex="0"><table><thead>'.
                '<tr><th scope="col">Tarih</th><th scope="col">Kanal</th><th scope="col">Durum</th><th scope="col">Açıklama</th>'.
                '<th scope="col">İşlem</th></tr></thead><tbody>'.$body.'</tbody></table></div>':'<p class="notification-empty">Bekleyen bildirim yok.</p>').'</section>';
    }

    private function notificationSettings(array $actor,bool $post): never
    {
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $path=self::NOTIFICATIONS;
        $partner=$actor['partner_id'];
        if (($_GET['format']??'')==='mail-status') {
            if ($post && ($_POST['action']??'')!=='retry') throw new RuntimeException('Bildirim işlemi geçersiz.',422);
            $identity=self::notificationJob($post?$_POST:$_GET);
            if (!$post) \reply($this->notificationState($partner,$identity));
            $now=time();
            // If the worker sent it after the page was opened, report success without requeuing.
            if ($this->notificationState($partner,$identity)['state']==='sent') \reply(['state'=>'sent']);
            (new DealerLogin($this->db,$this->visits->config['rateSecret']))->throttle('dealer-mail-retry:'.$actor['membership_id'],$now);
            try {
                $this->retryNotification($partner,$now,$identity);
            } catch (RuntimeException $e) {
                if ($e->getCode()===409 && $this->notificationState($partner,$identity)['state']==='sent') \reply(['state'=>'sent']);
                throw $e;
            }
            \reply(['state'=>'queued'],202);
        }
        $service=new Notifications($this->db,$this->visits->config['encryptionKey'],$partner);
        $message='';$status=200;$now=time();$submitted=null;
        if ($post) {
            try {
                $action=$_POST['action']??'save';
                if (in_array($action,['smtp','whatsapp','retry'],true)) {
                    (new DealerLogin($this->db,$this->visits->config['rateSecret']))->throttle('dealer-mail-'.$action.':'.$actor['membership_id'],$now);
                    if ($action==='retry') {
                        $this->retryNotification($partner,$now,self::notificationJob($_POST));
                        self::redirect($path.'&queued=1');
                    }
                    $service->send($action);
                    self::redirect($path.'&test='.$action);
                }
                if ($action!=='save') throw new RuntimeException('Bildirim işlemi geçersiz.',422);
                $submitted=(object)$_POST;
                foreach (['smtpEnabled','waEnabled','clearPassword','clearToken'] as $key) $submitted->$key=($_POST[$key]??'')==='yes';
                $service->save($submitted);
                self::redirect($path.'&saved=1');
            } catch (RuntimeException $e) {
                if ($e instanceof \PDOException) throw $e;
                $status=in_array($e->getCode(),[409,422,429,502,503],true)?$e->getCode():422;
                $message=self::warning($e->getMessage());
            }
        }
        if (!$post) {
            $notice=match(true) {
                isset($_GET['saved'])=>'Bildirim ayarları kaydedildi.',
                isset($_GET['queued'])=>'Bildirim yeniden gönderim sırasına alındı.',
                (($_GET['test']??'')==='smtp')=>'Test e-postası sağlayıcı tarafından kabul edildi.',
                (($_GET['test']??'')==='whatsapp')=>'Test WhatsApp mesajı sağlayıcı tarafından kabul edildi.',
                default=>'',
            };
            if ($notice) $message='<p class="visit-success" role="status">'.self::e($notice).'</p>';
        }
        $values=$service->settings();
        $value=static fn(string $key)=>$submitted===null?$values[$key]:
            (is_string($submitted->$key??null)?substr($submitted->$key,0,4096):($submitted->$key??false)===true);
        $secret=static fn(string $key,string $label)=>'<label>'.self::e($label).
            '<input type="password" name="'.$key.'" autocomplete="new-password" maxlength="4096"></label>';
        $smtp='<fieldset><legend>E-posta · SMTP</legend>'.self::box('smtpEnabled','Bildirimleri e-posta ile gönder',$value('smtpEnabled')).
            self::field('admin','Bildirim alıcısı',$value('admin'),'email').
            self::field('host','SMTP sunucusu',$value('host')).self::field('username','SMTP kullanıcı adı',$value('username')).
            self::field('sender','Gönderen e-posta',$value('sender'),'email').
            self::select('port','SMTP portu',['465'=>'465 · TLS','587'=>'587 · STARTTLS'],$value('port')).
            '<p>Sağlayıcınızın verdiği SMTP bilgilerini kullanın. Şifreyi boş bırakırsanız kayıtlı şifre korunur.</p>'.
            $secret('password','SMTP şifresi / uygulama şifresi').self::box('clearPassword','Kayıtlı SMTP şifresini kaldır').
            ($values['hasPassword']?'<p>SMTP şifresi kayıtlı.</p>':'').'</fieldset>';
        $whatsapp='<fieldset><legend>WhatsApp Business</legend>'.self::box('waEnabled','WhatsApp bildirim bağlantısını etkinleştir',$value('waEnabled')).
            self::field('recipient','Alıcı numarası (ülke koduyla)',$value('recipient'),'tel').
            self::field('phoneId','Gönderen Phone Number ID',$value('phoneId')).self::field('apiVersion','Graph API sürümü',$value('apiVersion')).
            self::field('template','Onaylı şablon adı',$value('template')).self::field('language','Şablon dil kodu',$value('language')).
            $secret('token','Kalıcı erişim belirteci').self::box('clearToken','Kayıtlı erişim belirtecini kaldır').
            '<p>Meta’da onaylanmış bir şablon kullanın. Belirteci boş bırakırsanız kayıtlı belirteç korunur.</p></fieldset>';
        $count=(int)$this->visits->web->query("SELECT COUNT(*) FROM clinic_visit_request WHERE partner_id=? AND status IN ('new','review')",[$partner])->fetchColumn();
        $review='<section><h2>İçerik inceleme uyarıları</h2><p>'.
            ($count?self::e($count).' Evde Hizmet başvurusu inceleme bekliyor. <a href="/clinic/evde-hizmet">Başvuruları aç</a>':'Bekleyen Evde Hizmet incelemesi yok.').'</p></section>';
        $center=new Notifications($this->db,$this->visits->config['encryptionKey']);
        $smtpHint=$values['smtpEnabled']?$values['admin']:($center->settings()['smtpEnabled']?'Merkez SMTP bağlantısı kullanılıyor.':'SMTP bağlantısını yapılandırın.');
        $summary='<div class="notification-summary"><div><span>E-posta</span><strong>'.($values['smtpEnabled']?'Yapılandırıldı':'Ayar bekliyor').
            '</strong><p>'.self::e($smtpHint).'</p></div><div><span>WhatsApp</span><strong>'.($values['waEnabled']?'Yapılandırıldı':'Ayar bekliyor').
            '</strong><p>'.self::e($values['recipient']?:'Test alıcısı tanımlayın.').'</p></div></div>';
        $palette=$this->clinicPalette($actor);

        self::page('Bildirim Merkezi','/clinic#settings',$review.$message.$summary.
            '<section><h2>Bildirim bağlantıları</h2><p>SMTP ve WhatsApp Business ayarlarınızı kaydedin, ardından test gönderimi yapın.</p>'.
            self::form(self::hidden('action','save').$smtp.$whatsapp,'Ayarları kaydet',$path).'</section>'.
            '<div class="notification-tests">'.self::form(self::hidden('action','smtp'),'Test e-postası gönder',$path).
            self::form(self::hidden('action','whatsapp'),'Test WhatsApp mesajı gönder',$path).'</div>'.
            $this->pendingNotifications($partner,$now),$status,false,false,$palette);
    }

    private function clinicPalette(array $actor): string
    {
        $appearance=new Appearance($this->db);
        $global=$appearance->read();
        $personal=$appearance->read('account:'.$actor['account_id']);
        return (!$global['locked']?$personal['palette']:'')?:($global['palette']?:'classic');
    }

    private function publicationPanel(string $partner,array $settings): string
    {
        try {
            $issue=$this->visits->publicationIssue($partner,$settings);
            if ($issue===null) {
                $site=$this->visits->web->site($partner);
                if ($site && $this->visits->web->publicSite($site['slug'])) {
                    return '<section><h2>Web başvuruları açık</h2><p>Kliniğinizin VetZimo web sitesinde Evde Hizmet menüsü yayında.</p>'.
                        '<a class="visit-link" href="'.self::e($this->visits->web->standardUrl($site).'/evde-hizmet#yeni').'">Başvuru formunu aç</a></section>';
                }
                $issue='VetZimo klinik siteniz yayında değil. Web Sitem bölümünden sitenizin yayın durumunu kontrol edin.';
            }
        } catch (\PDOException $error) {
            error_log('VetZimo Evde Hizmet yayın durumu okunamadı. SQLSTATE: '.$error->getCode());
            $issue='Yayın durumu kontrol edilemedi. Sorun sürerse VetZimo desteğine bildirin.';
        }
        return '<section><h2>Web başvuruları kapalı</h2><p>'.self::e($issue).'</p></section>';
    }

    private function handleSettings(array $actor,bool $post): never
    {
        $partner=$actor['partner_id'];
        $status=200;
        $message='';
        try {
            $settings=$this->visits->settings($partner);
        } catch (\PDOException $failure) {
            error_log('VetZimo Evde Hizmet ayarları okunamadı. SQLSTATE: '.$failure->getCode());
            self::settingsError('Evde Hizmet ayarları yüklenemedi. Tekrar deneyin. Sorun sürerse VetZimo desteğine bildirin.',503);
        }
        if ($post) {
            try {
                $this->visits->saveSettings($actor,$_POST);
                self::redirect(self::SETTINGS.'&saved=1');
            } catch (\PDOException $failure) {
                error_log('VetZimo Evde Hizmet ayarları kaydedilemedi. SQLSTATE: '.$failure->getCode());
                $message='Ayarlar kaydedilemedi. Biraz sonra tekrar deneyin. Sorun sürerse VetZimo desteğine bildirin.';
                $status=503;
            } catch (RuntimeException $failure) {
                if (!in_array($failure->getCode(),[403,404,409,422],true)) throw $failure;
                $message=$failure->getMessage();
                $status=$failure->getCode();
            }
        }
        $feedback=$message!==''?self::warning($message):
            (($_GET['saved']??'')==='1'?'<p class="visit-success" role="status">Ayarlar kaydedildi.</p>':'');
        self::page('Evde Hizmet Ayarları','/clinic/evde-hizmet',
            $feedback.$this->publicationPanel($partner,$settings).$this->settings($partner,$settings,$post?$_POST:null),$status);
    }

    public function submitRequest(string $partner,?array $actor,array $values): string
    {
        if (($values['action']??'')!=='request'||($values['website']??'')!=='') {
            throw new RuntimeException('Form doğrulanamadı.',422);
        }
        WebBooking::verifyMath('visit:'.$partner,$this->visits->config['rateSecret'],time(),$values);
        return $this->visits->request($partner,$actor,$values);
    }

    public function handle(string $path,string $method,?array $actor,int $now): never
    {
        $post=$method==='POST';
        $error='';
        $status=200;
        if (!in_array($method,['GET','POST'],true)) throw new RuntimeException('İşlem geçersiz.',405);
        if ($path==='/yonetim/evde-hizmet') {
            $this->global($post,$now);
        }
        if ($path==='/api/evde-hizmet/konum') {
            if ($post) throw new RuntimeException('İşlem geçersiz.',405);
            $kind=$_GET['kind']??'';
            if (!in_array($kind,['districts','neighborhoods'],true)) throw new RuntimeException('Konum türü geçersiz.',422);
            \reply(['items'=>HomeVisit::location($kind,(int)($_GET['parent']??0))]);
        }
        if ($path==='/api/evde-hizmet/bildirim') {
            if (!$actor||$actor['role']==='customer'||($actor['membership_id']??'')!==($_SERVER['HTTP_X_VETNET_SCOPE']??'')) \reply(['items'=>[]]);
            try {
                if (!ClinicAccess::valid($actor,$this->visits->workspace($actor['partner_id'])['state']) || !$this->visits->staffAllowed($actor,$this->visits->settings($actor['partner_id']))) \reply(['items'=>[]]);
                $items=$this->unread($actor);
                if ($post) {
                    $event=\input(4096)->event??null;
                    foreach ($items as $item) if ($item['event']===$event) {
                        $this->visits->web->query('INSERT IGNORE INTO clinic_visit_read(membership_id,event_id) VALUES (?,?)',
                            [$actor['membership_id'],$event]);
                        $items=array_values(array_filter($items,static fn($row)=>$row['event']!==$event));
                        break;
                    }
                }
            } catch (\PDOException $failure) {
                if ($failure->getCode()!=='42S02') throw $failure;
                $items=[];
            }
            \reply(['items'=>$items]);
        }

        $staff=$path==='/clinic/evde-hizmet';
        $owner=$path==='/hasta-sahibi/evde-hizmet';
        $embedded=$owner&&($_GET['panel']??'')==='1';
        $panelQuery=$embedded?'&panel=1':'';
        $guest=$path==='/evde-hizmet/takip';
        $public=$path==='/evde-hizmet';
        $settingsPage=$staff&&($_GET['gorunum']??'')==='ayarlar';
        $row=null;
        $items=[];
        $site=null;
        $settings=[];
        $partner='';
        if ($staff||$owner) {
            if (!$actor) self::redirect('/app');
            if ($settingsPage && $actor['role']!=='dealer') self::settingsError('Evde Hizmet ayarlarını değiştirmek için bayi yöneticisi hesabıyla giriş yapın.',403);
            if ($owner!==($actor['role']==='customer')) throw new RuntimeException('Hesap yetkiniz yeterli değil.',403);
            if ($owner) self::$surfacePalette=(new Appearance($this->db))->read()['palette']?:'classic';
            $state=$this->visits->workspace($actor['partner_id'])['state'];
            if (!ClinicAccess::valid($actor,$state)) {
                if ($settingsPage) self::settingsError('Çalışma alanı doğrulanamadı. Hesabınızla yeniden giriş yapın.',403);
                throw new RuntimeException('Çalışma alanı doğrulanamadı.',403);
            }
            $partner=$actor['partner_id'];
            if ($staff && !$post && ($_GET['panel']??'')!=='1' && ($_SERVER['HTTP_SEC_FETCH_DEST']??'')==='document' && ($_GET['format']??'')!=='mail-status') {
                $view=$_GET['gorunum']??'';
                $visit=$_GET['talep']??'';
                if ($view==='bildirim-ayarlari') self::redirect('/clinic#bildirim-merkezi');
                $suffix=is_string($visit)&&preg_match('/\A[a-f0-9]{32}\z/D',$visit)?$visit:
                    (in_array($view,['rota','takvim','ayarlar'],true)?$view:'');
                self::redirect('/clinic#evde-hizmet'.($suffix?'/'.$suffix:''));
            }
            if ($staff && ($_GET['panel']??'')==='1') {
                self::$clinicPanel=true;
                self::$clinicPalette=$this->clinicPalette($actor);
            }
        } elseif ($guest) {
            if ($post&&($_POST['action']??'')==='exchange') {
                $cookie=$this->visits->guestExchange(HomeVisit::text($_POST['token']??'',64));
                if (!$cookie) self::page('Evde hizmet takibi','/','<p role="alert">Bu bağlantı kullanılmış veya süresi dolmuş.</p>',422);
                \sessionCookie(self::COOKIE,$cookie,$now+14*86400);
                self::redirect('/evde-hizmet/takip');
            }
            if (!$post && is_string($_GET['token']??null)) self::page('Evde hizmet takibi','/',
                self::form(self::hidden('action','exchange').self::hidden('token',HomeVisit::text($_GET['token'],64)),'Takibi aç'),200,true);
            $row=$this->visits->guestVisit($_COOKIE[self::COOKIE]??null);
            if (!$row) self::page('Evde hizmet takibi','/','<p>Takip işlemi için kliniğinizin gönderdiği doğrulama bağlantısını kullanın.</p>',403);
            $partner=$row['partner_id'];
            $actor=null;
        } elseif ($public) {
            $slug=HomeVisit::text($_GET['klinik']??'',63,true);
            $site=$this->visits->web->publicSite($slug);
            if (!$site || !($settings=$this->visits->publicCatalog($site['partner_id']))) {
                $return=$site?$this->visits->web->standardUrl($site):'/';
                self::page('Evde Hizmet',$return,'<p>Bu klinik şu anda web üzerinden evde hizmet başvurusu almıyor.</p>'.
                    '<p><a class="visit-link" href="'.self::e($return).'">Siteye dön</a></p>',404);
            }
            if (!$post) self::redirect($this->visits->web->standardUrl($site).'/evde-hizmet'.(($_GET['alindi']??'')==='1'?'?alindi=1':''));
            $partner=$site['partner_id'];
            if ($actor && ($actor['role']!=='customer'||$actor['partner_id']!==$partner)) $actor=null;
        } else throw new RuntimeException('Sayfa bulunamadı.',404);

        if ($staff && ($_GET['gorunum']??'')==='bildirim-ayarlari') $this->notificationSettings($actor,$post);
        if ($settingsPage) $this->handleSettings($actor,$post);
        if (!$public) $settings=$this->visits->settings($partner);
        if ($staff && !$this->visits->staffAllowed($actor,$settings) && !$this->visits->canDeleteApplication($actor)) throw new RuntimeException('Evde hizmet yetkiniz yok.',403);
        if ($staff||$owner) {
            $id=HomeVisit::text($_GET['talep']??'',32);
            if ($id==='') $items=$this->visits->scoped($actor,$owner);
            $row=$id!==''?$this->visits->find($actor,$id,$owner):null;
        }
        $scope=$public?'public:'.$site['slug']:($staff?'clinic':($owner?'owner':'guest'));
        if ($post) {
            try {
                $source=$_SERVER['REMOTE_ADDR']??'';
                $action=HomeVisit::text($_POST['action']??'',32);
                $bucket=$action==='request'?'request':($row?'change:'.$row['id']:'settings');
                if ($action==='request' || !$actor) (new DealerLogin($this->db,$this->visits->config['rateSecret']))->throttle(
                    'visit:'.$scope.':'.$bucket.':'.$partner.':'.$source,$now);
                if ($action==='request' && ($public||$owner)) {
                    $id=$this->submitRequest($partner,$actor,$_POST);
                    if ($actor) self::redirect('/hasta-sahibi/evde-hizmet?talep='.$id.$panelQuery);
                    self::redirect($this->visits->web->standardUrl($site).'/evde-hizmet?alindi=1');
                }
                if (!$row) throw new RuntimeException('Başvuru bulunamadı.',404);
                if ($action==='delete'&&$staff) {
                    if (($_POST['confirm_delete']??'')!=='yes') throw new RuntimeException('Başvuruyu silmek için onay verin.',422);
                    $this->visits->deleteApplication($actor,$row['id'],(int)($_POST['revision']??0));
                    self::redirect($path.(self::$clinicPanel?'?panel=1':''));
                }
                if ($action==='read'&&$staff) {
                    $this->visits->web->query('INSERT IGNORE INTO clinic_visit_read(membership_id,event_id)
                        SELECT ?,id FROM clinic_visit_event WHERE partner_id=? AND visit_id=?',[$actor['membership_id'],$partner,$row['id']]);
                } else $this->visits->change($row,$actor,$_POST,$owner||$guest);
                self::redirect($path.($guest?'':'?talep='.$row['id'].$panelQuery));
            } catch (RuntimeException $failure) {
                if (!in_array($failure->getCode(),[403,404,409,422,429],true)) throw $failure;
                $error='<p class="visit-error" role="alert">'.self::e($failure->getMessage()).'</p>';
                $status=$failure->getCode();
            }
        }

        if ($row) self::page('Evde Hizmet Başvurusu',$guest?'/':$path,
            ($staff?'<p class="visit-crumb"><a href="?">← Başvurulara dön</a></p>':'').($owner?'<nav class="vis-actions" aria-label="Evde hizmet"><a href="/hasta-sahibi/evde-hizmet'.($embedded?'?panel=1':'').'">← Evde hizmet taleplerim</a></nav><div class="visit-owner">':'').$error.$this->detail($row,$settings,$staff,$actor,$post&&($_POST['action']??'')==='assign'?$_POST:[]).($owner?'</div>':''),$status,false,$embedded);
        if ($public) {
            $draft=WebBuilder::decode($site['snapshot']);
            $info=($_GET['alindi']??'')==='1'?'<p role="status">Talebiniz alındı. Tek kullanımlık takip bağlantısı e-posta adresinize gönderilmek üzere sıraya alındı.</p>':'';
            self::page($draft['identity']['name'].' · Evde Hizmet',$this->visits->web->standardUrl($site),$error.$info.
                (!$actor?'<p><a href="/app?donus='.self::e(rawurlencode('/web/'.$site['slug'].'/evde-hizmet')).'">VetZimo hesabınız var mı? Giriş yapın</a> veya ziyaretçi olarak devam edin.</p>':'').
                $this->requestForm($partner,$settings,$actor,$post?$_POST:[]),$status);
        }
        $show=$_GET['gorunum']??'';
        $canRequest=$owner&&$this->visits->entitled($partner)&&$settings['enabled'];
        $html=$error.$this->listing($items,$staff,$actor,$show,$canRequest,$embedded);
        if ($canRequest) $html.=$this->requestForm($partner,$settings,$actor,$post?$_POST:[]);
        if ($owner) $html='<div class="visit-owner">'.$html.'</div>';
        self::page('Evde Hizmet',$staff?'/clinic':'/hasta-sahibi',$html,$status,false,$embedded);
    }


    private function global(bool $post,int $now): never
    {
        $owner=(new Center($this->db,$this->visits->config))->requireOwner($_COOKIE,$now,$post);
        if (!$post && ($_GET['panel']??'')!=='1' && ($_SERVER['HTTP_SEC_FETCH_DEST']??'')==='document') {
            self::redirect('/yonetim?tab=evde-hizmet');
        }
        if (($_GET['panel']??'')==='1') {
            self::$clinicPanel=true;
            self::$clinicPalette=(new Appearance($this->db))->read()['palette']?:'classic';
        }
        $plans=['_default'=>'Varsayılan']+array_column((new Commerce($this->db))->catalog(),'name','id');
        $current=array_column($this->visits->web->query('SELECT plan_id,enabled FROM clinic_visit_package')->fetchAll(),'enabled','plan_id');
        if ($post) {
            $plan=HomeVisit::text($_POST['plan']??'',80,true);
            if (!isset($plans[$plan])) throw new RuntimeException('Paket bulunamadı.',422);
            $this->visits->web->query('INSERT INTO clinic_visit_package(plan_id,enabled) VALUES(?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
                [$plan,($_POST['enabled']??'')==='yes'?1:0]);
            (new Center($this->db,$this->visits->config))->audit($owner['account_id'],'home_visit.package',$plan);
            self::redirect('/yonetim/evde-hizmet?saved=1');
        }
        $html=(($_GET['saved']??'')==='1'?'<p class="visit-success" role="status">Paket yetkisi kaydedildi.</p>':'').
            '<p>Paket yetkisi açık olan klinikler Evde Hizmet Ayarları bölümünden web başvurularını açabilir.</p>';
        foreach ($plans as $id=>$label) $html.=self::form(self::hidden('plan',$id).self::box('enabled',$label,(bool)($current[$id]??$current['_default']??false)));
        self::page('Evde Hizmet Paket Yetkileri','/yonetim',$html);
    }

    public function requestForm(string $partner,array $s,?array $actor,array $values,string $action=''): string
    {
        if (!$s['privacy']) return '<p>Başvuru formu hazırlanıyor.</p>';
        [$client,$pets]=$actor?(new WebBooking($this->db,$this->visits->web))->formIdentity($partner,$actor):[null,[]];
        if ($actor&&!$client) return '<p>Başvuru için doğrulanmış hasta sahibi hesabı ve hasta kaydı gerekir.</p>';
        $question=WebBooking::mathQuestion('visit:'.$partner,$this->visits->config['rateSecret'],time());
        $v=static fn($key,$default='')=>is_string($values[$key]??null)?$values[$key]:$default;
        $provinces=array_column(HomeVisit::location('provinces'),1,0);
        $province=$v('province',array_search($client->city??'',$provinces,true)?:'');
        $districts=array_column(HomeVisit::location('districts',(int)$province),1,0);
        $district=$v('district',array_search($client->district??'',$districts,true)?:'');
        $neighborhoods=array_column(HomeVisit::location('neighborhoods',(int)$district),1,0);
        $neighborhood=$v('neighborhood',array_search($client->neighborhood??'',$neighborhoods,true)?:'');
        $branches=$this->visits->web->branches($partner);
        $branchField=count($branches)===1
            ? self::hidden('branch',$branches[0]->id).'<p class="wide visit-auto-branch"><strong>'.self::e($this->visits->web->partnerName($partner)).'</strong></p>'
            : self::select('branch','Şube',array_column($branches,'name','id'),$v('branch',$actor['branch_id']??''),true);
        $fields=self::hidden('action','request').self::hidden('security_token',$question['token']).
            '<fieldset class="wide visit-subgrid"><legend>İletişim ve hasta bilgileri</legend>'.
            $branchField.
            ($actor?'<p class="wide"><strong>'.self::e($client->name).'</strong> · '.self::e($actor['identifier']).'</p>'.self::select('patient','Kayıtlı hayvan',array_column($pets,'name','id'),$v('patient'),true):
                self::field('name','Ad soyad',$v('name'),'text',true).self::field('phone','Telefon',$v('phone'),'tel',true).
                self::field('animal','Hayvan adı',$v('animal'),'text',true).
                self::select('species','Hayvan türü',array_combine(['Kedi','Köpek','Kuş','Diğer'],['Kedi','Köpek','Kuş','Diğer']),$v('species'),true)).
            self::field('email',$actor?'Bildirim e-postası (isteğe bağlı)':'E-posta (takip bağlantısı için)',$v('email',$client->email??''),'email',!$actor).
            '</fieldset><fieldset class="wide service-picker"><legend>İstediğiniz hizmetler</legend>';
        foreach ($s['services'] as $id=>$item) if ($item['active']) {
            $fields.='<div>'.self::box('services[]',$item['label'],in_array($id,is_array($values['services']??null)?$values['services']:[],true),false,$id).
                '<small>'.self::e($item['category'].' · '.HomeVisit::MODES[$item['mode']]).($s['prices']&&$item['from']?' · '.self::cost($item['from']).' başlangıç':'').
                ($item['description']?'<br>'.self::e($item['description']):'').'</small></div>';
        }
        $fields.='</fieldset><fieldset class="wide visit-subgrid"><legend>Ziyaret adresi</legend>'.
            '<p class="wide" data-location-feedback role="status"></p>'.
            self::select('province','İl',$provinces,$province,true).self::select('district','İlçe',$districts,$district,true).
            self::select('neighborhood','Mahalle',$neighborhoods,$neighborhood,true).
            self::select('title','Adres başlığı',['Ev'=>'Ev','İş'=>'İş','Diğer'=>'Diğer'],$v('title','Ev'),true).
            self::field('street','Sokak / cadde',$v('street'),'text',true).self::field('building','Bina no',$v('building'),'text',true).
            self::field('floor','Kat (yoksa Uygulanamaz)',$v('floor','Uygulanamaz'),'text',true).
            self::field('unit','Daire (yoksa Uygulanamaz)',$v('unit','Uygulanamaz'),'text',true).
            self::field('landmark','Bilinen yer (yoksa Uygulanamaz)',$v('landmark','Uygulanamaz'),'text',true).
            self::field('alt_phone','Alternatif telefon',$v('alt_phone'),'tel').
            self::memo('address','Açık adres',$v('address',$client->address??''),true).
            '<details class="wide"><summary>Harita noktası (isteğe bağlı)</summary><div class="visit-subgrid">'.
            self::field('latitude','Enlem',$v('latitude')).self::field('longitude','Boylam',$v('longitude')).
            '<button type="button" class="button" data-locate>Konumumu kullan</button><p data-location-feedback role="status"></p></div>'.
            self::box('pin_confirm','Harita noktası yazılı adresle eşleşiyor.',$v('pin_confirm')==='yes').'</details>'.
            ($s['outside']?'<p class="wide">'.self::e($s['outside']).'</p>':'').
            '</fieldset><fieldset class="wide visit-subgrid"><legend>Tercih edilen ziyaret zamanı</legend>'.
            self::field('date','Tercih edilen gün',$v('date'),'date',true).self::field('from','Başlangıç',$v('from'),'time',true).
            self::field('to','Bitiş',$v('to'),'time',true).self::memo('notes','Açıklama ve özel ihtiyaçlar',$v('notes'),true).
            '</fieldset><fieldset class="wide visit-subgrid"><legend>Onay ve doğrulama</legend>'.
            '<details class="wide"><summary>KVKK aydınlatma metni</summary><p>'.nl2br(self::e($s['privacy'])).'</p></details>'.
            self::box('consent','Aydınlatma metnini okudum.',$v('consent')==='yes',true).self::box('address_confirm','Bu adres doğrudur.',$v('address_confirm')==='yes',true).
            self::field('security_answer','Güvenlik sorusu · '.$question['label'],'','text',true).
            '</fieldset><div class="trap" aria-hidden="true"><label>Boş bırakın<input name="website" tabindex="-1" autocomplete="off"></label></div>';
        return '<section id="yeni" class="visit-application"><h2>Evde hizmet talep et</h2>'.
            '<p>Talep, klinik onayı ve planlama sonrası kesinleşir.</p>'.self::form($fields,'Talebi gönder',$action).'</section>';
    }

    private static function regionPicker(string $name,string $value,string $empty): string
    {
        $html='<fieldset class="wide region-picker" data-region-picker><legend>Hizmet bölgeleri</legend>'.
            '<p class="region-help">İl ve ilçe seçin. Her seçim listeye eklenir. '.self::e($empty).'</p>'.
            '<input type="hidden" name="'.self::e($name).'" data-region-value value="'.self::e($value).'">'.
            '<div class="visit-subgrid" data-region-controls hidden>'.
            self::select('region_province','İl',array_column(HomeVisit::location('provinces'),1,0)).
            self::select('region_district','İlçe',[]).'<button type="button" data-add-province disabled>İlin tüm ilçelerini ekle</button></div>'.
            '<p class="region-help" data-region-feedback role="status"></p>'.
            '<ul class="region-list" aria-label="Seçilen ilçeler" data-region-list>';
        foreach (array_unique(HomeVisit::regionEntries($value)) as $code) {
            $label=HomeVisit::regionLabel($code)??'Geçersiz seçim';
            $html.='<li><span>'.self::e($label).'</span><button type="button" data-region-remove="'.self::e($code).
                '" aria-label="'.self::e($label.' kaldır').'">×</button></li>';
        }
        return $html.'</ul><noscript><p>İlçe listesini düzenlemek için JavaScript’i açın.</p></noscript></fieldset>';
    }

    private function settings(string $partner,array $s,?array $submitted): string
    {
        $serviceForm=($submitted['action']??'')==='service';
        $baseForm=$serviceForm?null:$submitted;
        $value=static fn(?array $form,string $key,mixed $saved): mixed =>
            $form===null?$saved:(is_string($form[$key]??null)?$form[$key]:'');
        $choices=static fn(?array $form,string $key,array $saved): array =>
            $form===null?$saved:(is_array($form[$key]??null)?$form[$key]:[]);
        $fields='';
        foreach (['enabled'=>'Evde Hizmet etkin','public'=>'Web sitesinde başvuru aç','home_section'=>'Ana sayfada tanıtım alanı göster','prices'=>'Başlangıç fiyatlarını yayınla'] as $key=>$label) {
            $fields.=self::box($key,$label,$value($baseForm,$key,$s[$key]?'yes':'')==='yes');
        }
        foreach (HomeVisit::METHODS as $id=>$label) $fields.=self::box('methods[]',$label,in_array($id,$choices($baseForm,'methods',$s['methods']),true),false,$id);
        $fields.=self::field('iban','IBAN',$value($baseForm,'iban',$s['iban'])).self::field('bank','Banka',$value($baseForm,'bank',$s['bank'])).self::field('holder','Hesap sahibi',$value($baseForm,'holder',$s['holder'])).
            self::field('travel','Varsayılan ulaşım bedeli (TL)',$value($baseForm,'travel',HomeVisit::decimal($s['travel']))).
            self::memo('privacy','Başvuru aydınlatma metni',$value($baseForm,'privacy',$s['privacy'])).self::memo('outside','Hizmet bölgesi açıklaması',$value($baseForm,'outside',$s['outside'])).
            self::regionPicker('regions',$value($baseForm,'regions',implode("\n",$s['regions'])),'Liste boşsa tüm ilçelerden başvuru alınır.').
            self::memo('vehicles','Araçlar / plakalar · her satıra bir araç',$value($baseForm,'vehicles',implode("\n",$s['vehicles']))).
            '<fieldset id="saha-personeli" class="wide"><legend>Yetkili saha personeli</legend>'.
            '<p>Personeli işaretleyip kaydedin. Merkezi Hesaplar bölümünde Randevular için okuma izni ziyaretleri görmelerini, yazma izni ziyaret durumunu güncellemelerini sağlar.</p>';
        $branchNames=array_column($this->visits->web->branches($partner),'name','id');
        foreach ($this->visits->roster($partner) as $member) if ($member['role']==='staff') {
            $fields.=self::box('staff[]',$member['name'].' · '.($branchNames[$member['branch_id']]??'Şube').
                (ClinicAccess::allowed($member,'appointments')?'':' · Randevu izni eksik'),in_array($member['id'],$choices($baseForm,'staff',$s['staff']),true),false,$member['id']);
        }
        $html='<section><h2>Başvuru ve ödeme ayarları</h2>'.self::form($fields.'</fieldset>','Kaydet',self::SETTINGS,true).'</section><section><h2>Hizmet ve fiyat yönetimi</h2>';
        $items=$s['services']+[''=>['label'=>'','category'=>'Veteriner hizmeti','description'=>'','minutes'=>30,'from'=>0,'to'=>0,'region'=>'',
            'species'=>'','staff'=>'','equipment'=>'','active'=>false,'mode'=>'assessment']];
        $submittedId=$submitted['service_id']??'';
        if (!is_string($submittedId)||!isset($items[$submittedId])) $submittedId='';
        foreach ($items as $id=>$item) {
            $form=$serviceForm&&(string)$id===$submittedId?$submitted:null;
            $fields=self::hidden('action','service').self::hidden('service_id',$id).
                self::field('label','Hizmet adı',$value($form,'label',$item['label']),'text',true).self::field('category','Kategori',$value($form,'category',$item['category']),'text',true).
                self::memo('description','Açıklama',$value($form,'description',$item['description'])).self::field('minutes','Süre (dakika)',$value($form,'minutes',$item['minutes']),'number',true).
                self::field('price_from','Başlangıç fiyatı (TL)',$value($form,'price_from',HomeVisit::decimal($item['from']))).
                self::field('price_to','Üst fiyat (TL)',$value($form,'price_to',HomeVisit::decimal($item['to']))).
                self::regionPicker('region',$value($form,'region',$item['region']),'Liste boşsa genel hizmet bölgeleri geçerli olur.').
                self::field('species','Hayvan türleri (virgülle)',$value($form,'species',$item['species'])).self::field('staff','Gerekli personel',$value($form,'staff',$item['staff'])).
                self::field('equipment','Gerekli ekipman',$value($form,'equipment',$item['equipment'])).self::select('mode','Uygulama koşulu',HomeVisit::MODES,$value($form,'mode',$item['mode']),true).
                self::box('active','Hizmet etkin',$value($form,'active',$item['active']?'yes':'')==='yes');
            $html.='<details'.($form!==null?' open':'').'><summary>'.self::e($item['label']?:'Yeni hizmet ekle').'</summary>'.self::form($fields,'Kaydet',self::SETTINGS,true).'</details>';
        }
        return $html.'</section>';
    }

    private static function deleteAction(array $row,string $target=''): string
    {
        return '<details class="visit-delete"><summary>Başvuruyu Sil</summary>'.
            '<p>Başvuru, teklif, ödeme takibi, ziyaret planı ve bildirimler kaldırılır. İşlenmiş tahsilatlar ve hasta dosyasındaki klinik kayıtlar korunur.</p>'.
            self::form(self::version($row,'delete').self::box('confirm_delete','Başvuruyu kalıcı olarak silmeyi onaylıyorum',false,true),'Başvuruyu Sil',$target).'</details>';
    }

    private function listing(array $items,bool $staff,?array $actor,mixed $show,bool $canRequest,bool $embedded): string
    {
        $links=$staff?'<a class="visit-link" href="?gorunum=rota"'.($show==='rota'?' aria-current="page"':'').'>Harita ve rota</a> ':'';
        if ($staff&&$actor['role']==='dealer') $links.='<a class="visit-link" href="?gorunum=ayarlar">Hizmet, bölge ve ödeme ayarları</a>';
        if ($staff) $links.=' <a class="visit-link" href="?gorunum=takvim"'.($show==='takvim'?' aria-current="page"':'').'>Günlük takvim</a>';
        if ($canRequest) $links.='<a class="visit-link" href="#yeni">Yeni talep</a>';
        $html='<nav class="vis-actions" aria-label="Evde Hizmet görünümleri">'.
            ($staff?'<a class="visit-link" href="?"'.($show===''?' aria-current="page"':'').'>Başvurular</a>':
                ($embedded?'':'<a href="/hasta-sahibi">← Hasta sahibi paneli</a>')).$links.'</nav>';
        $counts=array_count_values(array_column($items,'status'));
        $statuses=['new','quoted','payment','verification','assigned','completed','cancelled'];
        if ($staff) {
            if (!in_array($show,['rota','takvim'],true)) {
                $report=$this->visits->stats($actor);
                $html.='<section class="visit-kpis" aria-label="Başvuru özeti"><div class="metrics">'.
                    '<a href="?"><small>Bugünkü talepler</small><strong>'.(int)$report['new_today'].'</strong></a>'.
                    '<a href="?gorunum=takvim"><small>Bugünkü ziyaretler</small><strong>'.(int)$report['today_slots'].'</strong></a>'.
                    '<a href="?"><small>Toplam tahsilat</small><strong>'.self::e(self::cost((int)$report['received'])).'</strong></a>'.
                    '<a href="?durum=completed"><small>Ort. planlanan süre</small><strong>'.(int)round((float)$report['planned_duration']).' dk</strong></a></div>'.
                    '<nav class="visit-filter" aria-label="Duruma göre filtrele"><a href="?"'.(empty($_GET['durum'])?' aria-current="page"':'').'>Tümü</a>';
                foreach ($statuses as $id) $html.='<a href="?durum='.$id.'"'.(($_GET['durum']??'')===$id?' aria-current="page"':'').'>'.
                    self::e(HomeVisit::STATUS[$id]).' <b>'.($counts[$id]??0).'</b></a>';
                $html.='</nav></section>';
            }
        }
        if ($show==='rota'&&$staff) return $html.$this->routeMap($items,$this->visits->settings($actor['partner_id'])['regions']);
        $filter=$_GET['durum']??'';
        $day=is_string($_GET['date']??null)?$_GET['date']:WebBuilder::today();
        if ($show==='takvim') $html.='<form method="get" class="vis-actions">'.self::hidden('gorunum','takvim').self::field('date','Tarih',$day,'date').'<button>Göster</button></form>';
        $html.='<section class="visit-records"><h2>'.($show==='takvim'?'Günlük hizmet takvimi':($staff?'Başvurular':'Evde hizmet taleplerim')).'</h2>'.
            ($staff?'<div class="visit-record-head" aria-hidden="true"><span>Hasta ve konum</span><span>Durum</span><span>Tarih ve saat</span></div>':'').'<div class="visit-list">';
        $visible=0;
        foreach ($items as $item) {
            if (($filter && $filter!==$item['status'])||($show==='takvim' && substr($item['starts']??'',0,10)!==$day)) continue;
            $info=$this->visits->decode($item['snapshot']);
            $visible++;
            $target='?talep='.$item['id'].(($embedded||self::$clinicPanel)?'&panel=1':'');
            $html.='<article class="visit-list-entry"><a href="'.self::e($target).'"><strong>'.self::e($info['animal']).($staff&&!empty($info['location']['district'])?'<small>'.self::e($info['location']['district'].' · '.$info['location']['province']).'</small>':'').'</strong><span>'.self::e(HomeVisit::STATUS[$item['status']]).'</span><small>'.
                self::e($item['starts']??$info['date'].' · '.$info['from']).'</small></a>'.
                (($staff && $this->visits->canDeleteApplication($actor))?self::deleteAction($item,$target):'').'</article>';
        }
        return $html.($visible?'':'<p>Bu görünümde başvuru yok.</p>').'</div></section>';
    }

    private function routeMap(array $items,array $regions): string
    {
        $data=[];$missing=0;
        foreach ($items as $row) {
            $snapshot=$this->visits->decode($row['snapshot']);$loc=$snapshot['location'];
            if (!is_numeric($loc['latitude']??null)||!is_numeric($loc['longitude']??null)) {
                if (!in_array($row['status'],['completed','closed','cancelled','unavailable'],true)) $missing++;
                continue;
            }
            $data[]=['id'=>$row['id'],'name'=>$snapshot['animal'],'phone'=>$snapshot['phone'],'district'=>$loc['district'],
                'neighborhood'=>$loc['neighborhood'],'province'=>$loc['province'],'address'=>$loc['address'],'status'=>$row['status'],
                'label'=>HomeVisit::STATUS[$row['status']],'branch'=>$row['branch_id'],'services'=>implode(', ',array_column($snapshot['services'],'label')),
                'person'=>$row['clinician']??'','day'=>substr($row['starts']??$snapshot['date'],0,10),'time'=>$row['starts']?substr($row['starts'],11,5):($snapshot['from']??''),
                'end'=>substr($row['ends']??'',11,5),'lat'=>$loc['latitude'],'lon'=>$loc['longitude']];
        }
        $provinces=array_column(HomeVisit::location('provinces'),1,0);
        $covered=[];
        foreach ($regions as $region) {
            $id=(int)explode(':',$region,2)[0];
            if (isset($provinces[$id])) $covered[$provinces[$id]]=$provinces[$id];
        }
        foreach ($data as $stop) $covered[$stop['province']]=$stop['province'];
        asort($covered);
        return '<section data-itinerary data-stops="'.self::e(WebBuilder::json($data)).'"><h2>Harita ve rota planlama</h2>'.
            '<p>Türkiye’deki ziyaretleri araç yolu mesafesine göre planlayın. Konumlar bu tarayıcıda işlenir.</p>'.
            ($missing?'<p class="state">'.$missing.' açık ziyaretin harita konumu eksik. Bu ziyaretler plan listesine alınamadı.</p>':'').
            '<div class="vis-actions"><button type="button" data-locate>Konumumu kullan</button>'.
            '<label>Başlangıç enlemi<input name="latitude" inputmode="decimal"></label><label>Başlangıç boylamı<input name="longitude" inputmode="decimal"></label>'.
            self::select('province','Hizmet ili',$covered,count($covered)===1?array_key_first($covered):'',false,'Tüm hizmet illeri').
            '<label>Gün<input type="date" name="day"></label><label>İlçe / mahalle<input name="area"></label><label>Şube<input name="branch"></label>'.
            '<label>Hizmet<input name="services"></label><label>Personel kimliği<input name="person"></label>'.
            self::select('status','Durum',['open'=>'Açık ziyaretler','all'=>'Tümü']+HomeVisit::STATUS,'open').
            self::select('strategy','Sırala',['near'=>'Yol mesafesine göre','time'=>'Randevu saati','neighborhood'=>'Mahalleye göre','district'=>'İlçeye göre'],'near').
            '</div><p data-location-feedback role="status"></p><div class="vis-actions"><button type="button" data-plan>Yol planı oluştur</button></div>'.
            '<p data-route-feedback role="status"></p><div class="road-plan-layout"><figure data-road-figure hidden><canvas data-road-map role="img" aria-label="Araç rotası ve sıralı durakların haritası"></canvas>'.
            '<figcaption><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap katkıda bulunanlar</a> · <span data-road-date></span></figcaption></figure>'.
            '<ol class="road-stops" data-route-list></ol></div></section>';

    }

    private function detail(array $row,array $settings,bool $staff,?array $actor,array $plan=[]): string
    {
        $visit=$this->visits->decode($row['snapshot']);
        $addr=$visit['location'];
        [$quotes,$payment,$slot]=$this->visits->details($row['id']);
        $manager=$staff&&in_array($actor['role'],['dealer','branch'],true)&&$this->visits->staffAllowed($actor,$settings,true);
        $dealer=$manager&&$actor['role']==='dealer';
        $q=$quotes[0]??null;
        $status=$row['status'];
        $html='<section><div class="visit-detail"><div><p class="state">'.self::e(HomeVisit::STATUS[$status]).'</p><h2>'.self::e($visit['animal'].' · '.$visit['species']).'</h2>'.
            '<p>Başvuru <code>'.self::e($row['id']).'</code></p><p>'.self::e($visit['name']).' · <a href="tel:'.self::e($visit['phone']).'">'.self::e($visit['phone']).'</a></p>'.
            '<p>'.self::e(implode(' · ',array_column($visit['services'],'label'))).'</p>'.
            '<p>Talep edilen saat '.self::e($visit['date'].' · '.$visit['from'].'–'.$visit['to']).'</p>'.
            ($slot&&!$slot['released']?'<p><strong>Planlanan ziyaret</strong> '.self::e(substr($slot['starts'],0,16)).'</p>':'').'</div>'.
            '<div><h3>Adres</h3><p>'.self::e($addr['province'].' / '.$addr['district'].' / '.$addr['neighborhood']).'</p><p>'.
            nl2br(self::e($addr['address'])).'</p><p>'.self::e($addr['street'].' · No '.$addr['building'].' · Kat '.$addr['floor'].' · Daire '.$addr['unit']).'</p>'.
            '<p>Adres tarifi · '.self::e($addr['landmark']).'</p>'.
            ($addr['altPhone']?'<p><a href="tel:'.self::e($addr['altPhone']).'">Alternatif numarayı ara</a></p>':'').
            ($staff&&isset($addr['latitude'])?'<p><a href="https://www.openstreetmap.org/?'.self::e(http_build_query(['mlat'=>$addr['latitude'],'mlon'=>$addr['longitude']])).'">Haritada aç</a></p>':'').
            '</div></div><h3>Açıklama</h3><p>'.nl2br(self::e($visit['notes'])).'</p></section>';
        if ($dealer&&!in_array($status,['closed','cancelled'],true)) {
            $html.='<section><h2>Ziyaret konumu</h2>'.self::form(self::version($row,'pin').
                self::field('latitude','Enlem',$addr['latitude']??'','text',true).self::field('longitude','Boylam',$addr['longitude']??'','text',true).
                '<button type="button" data-locate>Konumumu kullan</button><p data-location-feedback role="status"></p>'.
                self::box('pin_confirm','Konumun ziyaret adresiyle eşleştiğini doğruladım',false,true),'Konumu güncelle').'</section>';
        }
        if ($manager) {
            $mail=$this->visits->web->query("SELECT m.sent_at,m.failure FROM clinic_visit_mail m JOIN clinic_visit_event e ON e.id=m.event_id
                WHERE e.visit_id=? AND m.audience='owner' ORDER BY m.event_id DESC LIMIT 1",[$row['id']])->fetch();
            $mailStatus=$mail?($mail['sent_at']?'Sağlayıcıya teslim edildi':($mail['failure']?:'Gönderim kuyruğunda')):'Henüz e-posta kaydı yok.';
            $html.='<section><h2>Müşteri e-postası</h2><p>'.self::e($visit['email']?:'E-posta yok').' · '.self::e($mailStatus).'</p>'.
                ($dealer && !$row['customer_id'] && !in_array($status,['closed','cancelled'],true)&&$visit['email']?self::button($row,'resend','Yeni takip bağlantısı gönder'):'').
                ($dealer?'<p><a href="/clinic#bildirim-merkezi">Bildirim Merkezi</a></p>':'').'</section>';
        }
        if ($q) {
            $html.='<section><h2>Fiyat teklifi</h2>';
            foreach ($quotes as $quote) {
                $info=WebBuilder::decode($quote['details']);
                $html.='<details'.($quote['version']===$q['version']?' open':'').'><summary>Teklif #'.(int)$quote['version'].' · '.self::cost((int)$quote['total']).'</summary><dl>';
                foreach ($info['lines'] as $line) $html.='<div><dt>'.self::e($line['label']).'</dt><dd>'.self::cost($line['amount']).'</dd></div>';
                foreach (['travel'=>'Ulaşım','transfer'=>'Nakil','extras'=>'Ek hizmet','subtotal'=>'Ara toplam','discount'=>'İndirim','tax'=>'Vergi'] as $key=>$label) {
                    $html.='<div><dt>'.$label.'</dt><dd>'.self::cost($info[$key]).'</dd></div>';
                }
                $html.='<div class="quote-payable"><dt>Genel toplam</dt><dd>'.self::cost((int)$quote['total']).'</dd></div></dl><p>'.nl2br(self::e($info['note'])).'</p><p>Geçerlilik · '.
                    self::e((new \DateTimeImmutable($quote['valid_until'],new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('d.m.Y H:i')).'</p></details>';
            }
            if (!$staff&&$status==='quoted') {
                $methods=array_intersect_key(HomeVisit::METHODS,array_flip($settings['methods']));
                if (strtotime($q['valid_until'].' UTC')>=time()&&$methods) $html.=self::form(self::version($row,'accept').self::hidden('quote_version',$q['version']).
                    self::select('method','Ödeme yöntemi',$methods,'',true),'Teklifi kabul et');
                $html.='<div class="vis-actions">'.self::form(self::version($row,'revise').self::memo('revision_note','Revizyon isteğiniz'),'Revizyon iste').self::button($row,'reject','Teklifi reddet').'</div>';
            }
            if ($dealer&&$status==='quoted'&&strtotime($q['valid_until'].' UTC')>=time()) {
                $methods=array_intersect_key(HomeVisit::METHODS,array_flip($settings['methods']));
                if ($methods) $html.=self::form(self::version($row,'phone_accept').self::hidden('quote_version',$q['version']).
                    self::select('method','Telefonda kararlaştırılan ödeme yöntemi',$methods,'',true).
                    self::box('phone_consent','Müşteri teklif tutarını ve ödeme yöntemini telefonda açıkça onayladı.',false,true),'Telefon onayını kaydet');
            }
            $html.='</section>';
        }
        if ($payment) {
            $paymentStatus=['pending'=>'Havale bekleniyor','reported'=>'Banka doğrulaması bekleniyor','paid'=>'Tahsil edildi','onsite'=>'Hizmet sırasında veya klinikte tahsil edilecek'];
            $html.='<section><h2>Ödeme</h2><p>'.HomeVisit::METHODS[$payment['method']].' · '.self::cost((int)$payment['total']).' · '.$paymentStatus[$payment['status']].'</p>';
            if ($payment['status']==='paid') {
                $html.='<p><strong>Tahsilat tarihi:</strong> '.self::e($payment['verified_at']).' UTC</p>'.
                    '<p><strong>İşlem referansı:</strong> '.self::e($row['id']).'</p>'.
                    ($staff&&ClinicAccess::allowed($actor,'sales')&&isset(Finance::index($this->visits->workspace($row['partner_id'])['state']->sales)['visit-'.$row['id']])?'<p><a href="/clinic#record/sales/visit-'.rawurlencode($row['id']).'">Satış ve tahsilat kaydını aç</a></p>':'');
            }
            if ($payment['destination']) {
                $transfer=$this->visits->decode($payment['destination']);
                $html.='<p>'.self::e($transfer['bank'].' · '.$transfer['holder']).'</p><p><code data-copy-value>'.self::e($transfer['iban']).'</code> '.
                    '<button type="button" data-copy>Ibanı kopyala</button></p><p>Havale açıklaması <strong>'.self::e($row['id']).'</strong></p>';
            }
            if (!$staff&&$status==='payment') $html.=self::button($row,'paid','Ödemeyi yaptım');
            if ($staff&&in_array($actor['role'],['dealer','branch'],true)&&ClinicAccess::allowed($actor,'expenses',true)&&ClinicAccess::allowed($actor,'sales',true)&&ClinicAccess::allowed($actor,'collections',true)&&
                ($payment['status']==='reported'||($dealer&&$payment['status']==='pending'&&$payment['method']==='iban')||
                    ($payment['status']==='onsite'&&in_array($status,['started','completed'],true)))) {
                $html.=self::form(self::version($row,'verify').($payment['status']==='pending'?
                    self::box('bank_confirm','Havale bu tutarda banka hesabına geçti.',false,true):'').($payment['method']==='clinic'?
                    self::select('cash_method','Tahsilat yöntemi',['Nakit'=>'Nakit','Kart'=>'Kart','Havale'=>'Havale'],'',true):''),
                    'Tahsilatı doğrula ve kasaya işle');
            }
            $html.='</section>';
        }
        if ($manager&&in_array($status,['new','review','quoted','revision'],true)) {
            $fields=self::version($row,'quote');
            $initialTotal=$settings['travel']+array_sum(array_column($visit['services'],'from'));
            $catalog=array_map(static fn($product)=>$product->name.' · '.($product->category??'Ürün'),$this->visits->catalogProducts($row));
            foreach ($visit['services'] as $id=>$service) {
                $fields.=self::field('rates['.$id.']',$service['label'].' (TL)',HomeVisit::decimal($service['from']),'text',true);
                if ($catalog) $fields.=self::select('product['.$id.']','Satış kataloğu · '.$service['label'],$catalog,'',false,'Serbest hizmet kalemi');
            }
            if ($catalog) for ($i=0;$i<3;$i++) {
                $fields.=self::select('extra_product['.$i.']','Ek ürün veya hizmet '.($i+1),$catalog,'',false,'Ekleme').
                    self::field('extra_qty['.$i.']','Adet',1,'number').self::field('extra_rate['.$i.']','KDV dahil birim fiyatı (TL)','','text');
            }
            foreach (['travel'=>'Ulaşım','transfer'=>'Nakil','extras'=>'Ek hizmet','discount'=>'İndirim','tax'=>'Vergi'] as $id=>$label) {
                $fields.=self::field($id,$label.' (TL)',HomeVisit::decimal($id==='travel'?$settings['travel']:0));
            }
            $fields.=self::field('valid_days','Geçerlilik (gün)',3,'number',true).self::memo('quote_note','Teklif açıklaması').
                '<div class="wide quote-total" data-quote-summary><div><span>Ara toplam</span><span data-quote-subtotal>'.self::cost($initialTotal).'</span></div>'.
                '<div><strong>Genel toplam</strong><output data-quote-total aria-live="polite">'.self::cost($initialTotal).'</output></div>'.
                '<p data-quote-hint></p></div>';
            $html.='<section><h2>Teklif hazırla</h2>'.self::form($fields,'Teklifi gönder').'</section>';
        }
        if ($manager&&in_array($status,['planning','assigned','postponed'],true)) {
            $members=$this->visits->schedulableStaff($row['partner_id'],$row['branch_id'],$settings);
            $people=array_column($members,'name','id');
            $value=static fn($key,$fallback)=>is_string($plan[$key]??null)?$plan[$key]:$fallback;
            $fields=self::version($row,'assign').self::select('clinician','Veteriner hekim / sorumlu',$people,$value('clinician',$slot['clinician']??''),true).
                self::select('assistant','Yardımcı personel',$people,$value('assistant',$slot['assistant']??''),false,'Yardımcı yok').
                self::select('vehicle','Araç / plaka',array_combine($settings['vehicles'],$settings['vehicles']),$value('vehicle',$slot['vehicle']??''),false,'Araçsız planla').
                self::field('slot_date','Planlanan gün',$value('slot_date',$slot?substr($slot['starts'],0,10):$visit['date']),'date',true).
                self::field('slot_time','Başlangıç',$value('slot_time',$slot?substr($slot['starts'],11,5):$visit['from']),'time',true).
                self::field('minutes','Süre (dk)',$value('minutes',min(480,array_sum(array_column($visit['services'],'minutes')))),'number',true);
            $help=$actor['role']==='dealer'?'<p><a href="'.self::e(self::SETTINGS).'#saha-personeli">Saha personeli ve araç ayarları</a></p>':'';
            $html.='<section id="ziyaret-plani"><h2>Ziyareti planla</h2>'.$help.self::form($fields,'Ziyareti planla').'</section>';
        }
        $actions='';
        if ($staff) {
            $actions.=self::button($row,'read','Bildirimleri okundu işaretle');
            if ($manager&&$status==='new') $actions.=self::button($row,'review','İncelemeye al');
            if ($manager&&in_array($status,['assigned','planning'],true)) $actions.=self::button($row,'postpone','Ertele');
            if ($this->visits->staffAllowed($actor,$settings,true)) {
                $next=['assigned'=>['depart','Yola çıkıldı'],'departed'=>['arrive','Adrese varıldı'],
                    'arrived'=>['start','Hizmeti başlat'],'started'=>['complete','Hizmeti tamamla']];
                if (isset($next[$status])) $actions.=self::button($row,...$next[$status]);
                if (isset($next[$status])) $actions.=self::button($row,'unavailable','Hizmet verilemedi');
            }
            if ($manager&&$status==='completed'&&($payment['status']??'')==='paid') $actions.=self::button($row,'close','Kapat');
            if ($row['patient_id']&&in_array($status,['started','completed','closed'],true)) {
                $actions.='<a class="visit-link" href="/clinic#patient/'.rawurlencode($row['patient_id']).'">Hasta dosyasında yapılan işlemleri kaydet</a>';
            }
        }
        if ((!$staff||$manager)&&in_array($status,['new','review','quoted','revision','address','payment','planning','assigned','postponed'],true)&&($payment['status']??'')!=='paid') {
            $actions.=self::button($row,'cancel','Talebi iptal et');
        }
        if ($staff&&$row['patient_id']&&in_array($status,['started','completed'],true)&&
            $this->visits->staffAllowed($actor,$settings,true)&&ClinicAccess::allowed($actor,'treatments')) {
            $workspace=$this->visits->workspace($row['partner_id'])['state'];
            $branch=ClinicAccess::branch($workspace,$row['branch_id']);
            $branchId=($branch->sharedWith??'')?:$row['branch_id'];
            $treatments=[];$lots=[];
            foreach ($workspace->treatments??[] as $treatment) if (($treatment->status??'')==='Tamamlandı'&&$treatment->branch===$branchId&&$treatment->patient===$row['patient_id']) {
                $treatments[$treatment->id]=($treatment->date??'').' · '.($treatment->title??$treatment->id);
            }
            if (ClinicAccess::allowed($actor,'products',true)) {
                $products=array_column($workspace->products??[],'name','id');
                foreach ($workspace->stockLots??[] as $lot) if ($lot->branch===$branchId&&(int)$lot->remaining>0&&
                    (empty($lot->expiry)||$lot->expiry>=WebBuilder::today())&&isset($products[$lot->product])) {
                    $lots[$lot->id]=$products[$lot->product].' · '.($lot->serial??'Parti').' · Mevcut '.$lot->remaining;
                }
            }
            $services=[];
            if (ClinicAccess::allowed($actor,'treatments',true)) foreach ($this->visits->catalogProducts($row) as $product) {
                if ($product->category==='Hizmet') $services[$product->id]=$product->name;
            }
            if ($treatments||$services) $html.='<section><h2>Yapılan işlemi hasta dosyasına bağla</h2>'.
                self::form(self::version($row,'record').
                    ($treatments?self::select('clinical_record','Hasta dosyasındaki işlem',$treatments):'').
                    ($services?self::select('clinical_service','Katalogdan yeni tamamlanmış hizmet',$services).
                        self::box('procedure_done','Seçilen yeni hizmet uygulandı').self::memo('procedure_note','Yeni hizmetin işlem notu'):'').
                    ($lots?self::select('lot','Kullanılan stok partisi (isteğe bağlı)',$lots).self::field('quantity','Kullanılan adet','','number'):''),
                    'İşlemi kaydet').'</section>';
        }
        $events=$this->visits->web->query('SELECT status,action,detail,created_at FROM clinic_visit_event WHERE visit_id=? ORDER BY revision DESC LIMIT 50',[$row['id']])->fetchAll();
        $history='';
        foreach ($events as $event) {
            $detail=$event['detail']?$this->visits->decode($event['detail']):[];
            $history.='<li>'.self::e(($event['action']==='record'?'Hasta işlemi bağlandı':HomeVisit::STATUS[$event['status']]).' · '.$event['created_at']).
                (!empty($detail['message'])?'<p>'.self::e($detail['message']).'</p>':'').'</li>';
        }
        if ($staff && $this->visits->canDeleteApplication($actor)) {
            $html.='<section>'.self::deleteAction($row).'</section>';
        }
        return $html.($actions?'<div class="vis-actions">'.$actions.'</div>':'').($staff?
            '<section><h2>İşlem geçmişi</h2><ol>'.$history.'</ol></section>':
            '<section><details class="visit-history"><summary>İşlem geçmişi</summary><ol>'.$history.'</ol></details></section>');
    }

    private function unread(array $actor): array
    {
        $params=[$actor['membership_id'],$actor['partner_id']];
        $filter='';
        if ($actor['role']!=='dealer') {$filter.=' AND r.branch_id=?';$params[]=$actor['branch_id'];}
        if ($actor['role']==='staff') {$filter.=' AND (s.clinician=? OR s.assistant=?)';array_push($params,$actor['membership_id'],$actor['membership_id']);}
        $events=$this->visits->web->query("SELECT r.id,e.id AS event,e.status,e.created_at FROM clinic_visit_event e JOIN clinic_visit_request r ON r.id=e.visit_id
            LEFT JOIN clinic_visit_slot s ON s.visit_id=r.id LEFT JOIN clinic_visit_read x ON x.event_id=e.id AND x.membership_id=?
            WHERE e.partner_id=? AND e.action<>'record' AND x.event_id IS NULL".$filter.' ORDER BY e.id DESC LIMIT 20',$params)->fetchAll();
        return array_map(static fn($event)=>['id'=>$event['id'],'event'=>(int)$event['event'],'label'=>HomeVisit::STATUS[$event['status']],'time'=>$event['created_at']],$events);
    }
}
