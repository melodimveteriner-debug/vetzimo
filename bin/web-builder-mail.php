<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;
use VetNet\Cpanel\Notifications;
use VetNet\Cpanel\WebBuilder;
use VetNet\Cpanel\WorkspaceRepository;

if (PHP_SAPI!=='cli') { http_response_code(404); exit(1); }
$root=dirname(__DIR__);
foreach (['Database','Totp','Notifications','WorkspaceRepository','WebBuilder'] as $class) require $root.'/src/'.$class.'.php';
try {
    $config=require (getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php');
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    if ((int)$db->query("SELECT GET_LOCK('vetnet.web.mail',0)")->fetchColumn()!==1) exit(0);
    $web=new WebBuilder($db,$config);
    $smtp=new Notifications($db,$config['encryptionKey']??'');
    $now=time();
    $recipientFor=static function(string $partner) use ($web,$smtp): string {
        $admin=$smtp->dealer($partner)->settings()['admin'];
        if ($admin) return $admin;
            $recipient=$web->query("SELECT c.email FROM identity_membership m JOIN clinic_contact c ON c.membership_id=m.id
                JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
                WHERE m.partner_id=? AND m.role='dealer' AND m.status='active' AND c.email<>'' ORDER BY m.id LIMIT 1",[$partner])->fetchColumn();
            if (!$recipient) throw new RuntimeException('Doğrulanmış bayi bildirim adresi yok.',422);
        return $recipient;
    };
    foreach ($web->query('SELECT m.*,a.visitor,a.visit_branch FROM clinic_web_mail m JOIN clinic_web_appointment a
        ON a.partner_id=m.partner_id AND a.id=m.appointment_id WHERE m.sent_at IS NULL AND m.next_at<=? AND m.attempts<12 ORDER BY m.next_at LIMIT 25',[$now])->fetchAll() as $job) {
        $result='';$sent=null;
        try {
            $recipient=$recipientFor($job['partner_id']);
            $state=(new WorkspaceRepository($db))->load('partner:'.$job['partner_id'])['state'];
            $appointment=array_column($state->appointments??[],null,'id')[$job['appointment_id']]??null;
            if (!$appointment) throw new RuntimeException('Randevu bulunamadı.',422);
            $visitor=WebBuilder::decode($job['visitor']);
            $branch=array_column($state->branches??[],'name','id')[$job['visit_branch']]??'Şube';
            $link=rtrim($config['origin'],'/').'/klinik#record/appointments/'.rawurlencode($appointment->id);
            $dealer=$smtp->dealer($job['partner_id']);
            $mailer=$dealer->settings()['smtpEnabled']?$dealer:$smtp;
            $mailer->send('smtp',$recipient,'VetZimo — Yeni Web Sitesi Randevu Talebi',
                "Yeni bir web randevusu talebi alındı.\nHasta: ".$visitor['animal']."\nHasta sahibi: ".$visitor['name'].
                "\nTarih: ".$appointment->date."\nSaat: ".$appointment->time."\nŞube: ".$branch."\nDurum: ".$appointment->status."\n\nVetZimo ile görüntüleyin: ".$link);
            $sent=time();
        } catch (Throwable $e) {
            $result=$e instanceof RuntimeException && $e->getCode()===422?'Posta ayarı veya alıcı doğrulanamadı.':'Gönderim başarısız. SMTP bağlantısını kontrol edin.';
        }
        $web->query('UPDATE clinic_web_mail SET attempts=attempts+1,next_at=?,sent_at=?,last_error=? WHERE partner_id=? AND appointment_id=?',
            [$now+min(86400,120*2**min(10,(int)$job['attempts'])),$sent,$result,$job['partner_id'],$job['appointment_id']]);
    }
    foreach ($web->query('SELECT id,partner_id,notify_attempts FROM clinic_web_inbox WHERE notified_at IS NULL
        AND notify_at<=? AND notify_attempts<12 ORDER BY notify_at LIMIT 25',[$now])->fetchAll() as $job) {
        $failure='';$sent=null;
        try {
            $dealer=$smtp->dealer($job['partner_id']);
            $mailer=$dealer->settings()['smtpEnabled']?$dealer:$smtp;
            $mailer->send('smtp',$recipientFor($job['partner_id']),'VetZimo — Yeni Web Sitesi Mesajı',
                "Web sitenizin iletişim formundan bir mesaj alındı.\n".$config['origin'].'/web-sitem?tab=genel');
            $sent=time();
        } catch (Throwable $e) {
            $failure=$e instanceof RuntimeException && $e->getCode()===422?'Posta ayarı veya alıcı doğrulanamadı.':'Gönderim başarısız. SMTP bağlantısını kontrol edin.';
        }
        $web->query('UPDATE clinic_web_inbox SET notify_attempts=notify_attempts+1,notify_at=?,notified_at=?,notify_error=? WHERE partner_id=? AND id=?',
            [$now+min(86400,120*2**min(10,(int)$job['notify_attempts'])),$sent,$failure,$job['partner_id'],$job['id']]);
    }
} catch (Throwable $error) {
    fwrite(STDERR,'Web randevusu e-posta kuyruğu çalıştırılamadı ('.get_class($error).').'.PHP_EOL);
    exit(1);
}
