<?php
declare(strict_types=1);

use VetNet\Cpanel\AppointmentReminders;
use VetNet\Cpanel\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
$root = dirname(__DIR__);
foreach (['Database', 'WorkspaceRepository', 'DealerLogin', 'Totp', 'Notifications', 'AppointmentReminders', 'BulkClinicMessages', 'ClinicAccess', 'Commerce'] as $class) {
    require $root . '/src/' . $class . '.php';
}
try {
    $config = require $root . '/config.php';
    $connections = $config['appointmentReminderConnections'] ?? [];
    if ($connections === []) exit(0);
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $stats = (new AppointmentReminders($db))->run($connections, time(), new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? ''));
    (new VetNet\Cpanel\BulkClinicMessages($db,$config))->deliver();
    if ($stats['accepted'] || $stats['rejected'] || $stats['unknown']) {
        fwrite(STDOUT, json_encode($stats, JSON_THROW_ON_ERROR) . PHP_EOL);
    }
    exit($stats['rejected'] || $stats['unknown'] ? 1 : 0);
} catch (Throwable $error) {
    fwrite(STDERR, 'VetZimo randevu hatırlatmaları çalıştırılamadı (' . get_class($error) . '). PHP cURL, bağlantı ayarları ve 019 numaralı SQL dosyasını kontrol edin.' . PHP_EOL);
    exit(1);
}
