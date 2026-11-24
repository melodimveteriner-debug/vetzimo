<?php
declare(strict_types=1);
use VetNet\Cpanel\Database;
use VetNet\Cpanel\HomeVisit;
use VetNet\Cpanel\DeliveryNotice;
use VetNet\Cpanel\Notifications;
if (PHP_SAPI!=='cli') {http_response_code(404);exit(1);}
$root=dirname(__DIR__);
foreach (['Database','Totp','Notifications','WorkspaceRepository','WebBuilder','HomeVisit','DeliveryNotice'] as $class) require $root.'/src/'.$class.'.php';
try {
    $config=require (getenv('VETNET_CPANEL_CONFIG')?:$root.'/config.php');
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    if ((int)$db->query("SELECT GET_LOCK('vetnet.home-visit.mail',0)")->fetchColumn()!==1) exit(0);
    $visits=new HomeVisit($db,$config);
    $smtp=new Notifications($db,$config['encryptionKey']);
    $now=time();
    $jobs=$visits->web->query("SELECT m.*,e.status,e.action,r.id,r.partner_id,r.customer_id,r.snapshot,r.token_expires,r.token_hash
        FROM clinic_visit_mail m JOIN clinic_visit_event e ON e.id=m.event_id JOIN clinic_visit_request r ON r.id=e.visit_id
        WHERE m.sent_at IS NULL AND m.retry_at<=? AND m.attempts<10 ORDER BY m.event_id LIMIT 35",[$now])->fetchAll();
    foreach ($jobs as $job) {
        $sent=null;$failure='';
        try {
            $visit=$visits->decode($job['snapshot']);
            $state=$job['action']==='verify'?'Ödeme tahsil edildi':HomeVisit::STATUS[$job['status']];
            $origin=rtrim($config['origin'],'/');
            $dealerSmtp=new Notifications($db,$config['encryptionKey'],$job['partner_id']);
            $dealerSettings=$dealerSmtp->settings();
            $mailer=$dealerSettings['smtpEnabled']?$dealerSmtp:$smtp;
            if ($job['audience']==='clinic') {
                $email=$visits->web->query("SELECT c.email FROM identity_membership m JOIN clinic_contact c ON c.membership_id=m.id
                    JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
                    WHERE m.partner_id=? AND m.role='dealer' AND m.status='active' AND c.email<>'' ORDER BY m.id LIMIT 1",
                    [$job['partner_id']])->fetchColumn();
                if ($dealerSettings['admin']!=='') $email=$dealerSettings['admin'];
                if (!$email) throw new RuntimeException('Bayi e-posta adresi doğrulanmamış.',422);
                $loc=$visit['location'];
                $message=implode("\n",['Başvuru '.$job['id'],'Durum '.$state,$visit['name'].' · '.$visit['phone'],
                    $visit['animal'].' · '.$visit['species'],implode(', ',array_column($visit['services'],'label')),
                    $visit['date'].' '.$visit['from'].'–'.$visit['to'],$loc['province'].' / '.$loc['district'].' / '.$loc['neighborhood'],
                    $origin.'/clinic#evde-hizmet/'.$job['id']]);
            } else {
                $email=$visit['email'];
                if (!$email) {
                    $visits->web->query("UPDATE clinic_visit_mail SET attempts=10,failure='Alıcı adresi tanımlı değil.' WHERE event_id=? AND audience='owner'",[$job['event_id']]);
                    continue;
                }
                $target=$job['customer_id']?$origin.'/hasta-sahibi?bildirim=visit&talep='.$job['id']:$origin.'/evde-hizmet/takip';
                if ($job['secret']) {
                    $token=$visits->decode($job['secret'])['token'];
                    if (!$job['token_hash']||!hash_equals($job['token_hash'],hash('sha256',$token))||(int)$job['token_expires']<$now) {
                        $visits->web->query("UPDATE clinic_visit_mail SET attempts=10,secret=NULL,failure='Bağlantı kullanıldı veya süresi doldu.' WHERE event_id=? AND audience='owner'",[$job['event_id']]);
                        continue;
                    }
                    $target.='?token='.rawurlencode($token);
                }
                $message="Evde Hizmet talebiniz güncellendi.\nDurum ".$state."\nBaşvuru ".$job['id']."\n".$target;
            }
            $mailer->send('smtp',$email,'VetZimo — Evde Hizmet',$message);
            $sent=time();
        } catch (Throwable $error) {
            $failure='E-posta gönderilemedi. SMTP ve alıcı ayarlarını kontrol edin.';
        }
        $visits->web->query('UPDATE clinic_visit_mail SET attempts=attempts+1,retry_at=?,sent_at=?,failure=?,secret=IF(? IS NULL,secret,NULL)
            WHERE event_id=? AND audience=?',[$now+min(43200,180*2**min(8,(int)$job['attempts'])),$sent,$failure,$sent,$job['event_id'],$job['audience']]);
    }
    $delivery=new DeliveryNotice($db);
    try {
        $delivery->queueClinicReminders($now);
        $delivery->send($smtp,$config['origin'],$now);
    } catch (\PDOException $error) {
        if ($error->getCode()!=='42S02') throw $error;
    }
} catch (Throwable $error) {
    fwrite(STDERR,'Evde Hizmet e-posta kuyruğu çalıştırılamadı ('.get_class($error).').'.PHP_EOL);
    exit(1);
}
