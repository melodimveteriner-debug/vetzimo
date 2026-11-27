<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root=dirname(__DIR__);
require $root.'/src/Database.php';
$configPath=getenv('VETNET_CPANEL_CONFIG')?:$root.'/config.php';
if (!is_file($configPath)) {
    if (class_exists('VetNet\\Cpanel\\CronGuard')) VetNet\Cpanel\CronGuard::finish('error',isset($error)&&$error instanceof Throwable?mb_substr(get_class($error).': '.$error->getMessage(),0,240):null);
    fwrite(STDERR,"VetZimo: yapılandırma bulunamadı.\n");
    exit(1);
}

try {
    $config=require $configPath;
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    require_once dirname(__DIR__).'/src/CronGuard.php'; VetNet\Cpanel\CronGuard::begin($db,'expire-access-records');
    $now=time();
    foreach ([
        ['DELETE FROM identity_session WHERE expires<=? ORDER BY expires LIMIT 500',$now],
        ['DELETE FROM identity_login_window WHERE window_start<? ORDER BY window_start LIMIT 500',$now-86400],
        // Kullanılmamış ve süresi 7 günden önce dolmuş aktivasyon bağlantıları
        ['DELETE FROM identity_activation WHERE expires<? ORDER BY expires LIMIT 500',$now-7*86400],
    ] as [$sql,$cutoff]) {
        $delete=$db->prepare($sql);
        for ($batch=0;$batch<5;$batch++) {
            $delete->execute([$cutoff]);
            if ($delete->rowCount()<500) break;
        }
    }
    // Sohbet (çok kanallı gelen kutusu): son mesajı 3 günden eski konuşmalar mesajlarıyla birlikte tamamen silinir
    // (arşiv tutulmaz; veritabanı şişmez). Partiler hâlinde, kısa işlemlerle.
    try {
        $old=$db->prepare('SELECT id FROM inbox_conversation WHERE last_message_at<? ORDER BY last_message_at LIMIT 300');
        for ($batch=0;$batch<50;$batch++) {
            $old->execute([$now-3*86400]);
            $ids=array_map('intval',$old->fetchAll(PDO::FETCH_COLUMN));
            if (!$ids) break;
            $in=implode(',',$ids);
            $db->exec("DELETE FROM inbox_message WHERE conversation_id IN ($in)");
            $db->exec("DELETE FROM inbox_conversation WHERE id IN ($in)");
            if (count($ids)<300) break;
        }
    } catch (PDOException $error) {
        if ($error->getCode()!=='42S02') throw $error;
    }
} catch (Throwable $error) {
    if (class_exists('VetNet\\Cpanel\\CronGuard')) VetNet\Cpanel\CronGuard::finish('error',isset($error)&&$error instanceof Throwable?mb_substr(get_class($error).': '.$error->getMessage(),0,240):null);
    fwrite(STDERR,'VetZimo: erişim kayıtları temizlenemedi ('.get_class($error).").\n");
    exit(1);
}
