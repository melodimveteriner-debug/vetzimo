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
    fwrite(STDERR,"VetZimo: yapılandırma bulunamadı.\n");
    exit(1);
}

try {
    $config=require $configPath;
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    $now=time();
    foreach ([
        ['DELETE FROM identity_session WHERE expires<=? ORDER BY expires LIMIT 500',$now],
        ['DELETE FROM identity_login_window WHERE window_start<? ORDER BY window_start LIMIT 500',$now-86400],
    ] as [$sql,$cutoff]) {
        $delete=$db->prepare($sql);
        for ($batch=0;$batch<5;$batch++) {
            $delete->execute([$cutoff]);
            if ($delete->rowCount()<500) break;
        }
    }
} catch (Throwable $error) {
    fwrite(STDERR,'VetZimo: erişim kayıtları temizlenemedi ('.get_class($error).").\n");
    exit(1);
}
