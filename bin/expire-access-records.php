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
} catch (Throwable $error) {
    if (class_exists('VetNet\\Cpanel\\CronGuard')) VetNet\Cpanel\CronGuard::finish('error',isset($error)&&$error instanceof Throwable?mb_substr(get_class($error).': '.$error->getMessage(),0,240):null);
    fwrite(STDERR,'VetZimo: erişim kayıtları temizlenemedi ('.get_class($error).").\n");
    exit(1);
}
