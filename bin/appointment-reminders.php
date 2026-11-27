<?php
declare(strict_types=1);

use VetNet\Cpanel\AppointmentReminders;
use VetNet\Cpanel\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
$root = dirname(__DIR__);
foreach (['Database', 'WorkspaceRepository', 'DealerLogin', 'Totp', 'Notifications', 'AppointmentReminders', 'BulkClinicMessages', 'ClinicAccess', 'Commerce', 'ClinicRecords', 'OmniInbox', 'PhoneGateway', 'ClientPermit', 'SiteLegal', 'Pregnancy', 'AppHub', 'DailyNote'] as $class) {
    require_once $root . '/src/' . $class . '.php';
}
try {
    $config = require $root . '/config.php';
    $connections = $config['appointmentReminderConnections'] ?? [];
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    require_once dirname(__DIR__).'/src/CronGuard.php'; VetNet\Cpanel\CronGuard::begin($db,'appointment-reminders');
    // Günlük ekip notu: saati gelen kliniklerde personele anlık bildirim (sağlayıcı gerekmez).
    try { (new VetNet\Cpanel\DailyNote($db))->fanout(time()); } catch (Throwable $e) { fwrite(STDERR, 'Günlük ekip notu gönderilemedi.'.PHP_EOL); }
    $pregnant = 0;
    try { $pregnant = (int)$db->query('SELECT COUNT(*) FROM clinic_pregnancy WHERE ended IS NULL')->fetchColumn(); } catch (PDOException) {}
    if ($connections === [] && $pregnant === 0 && (new VetNet\Cpanel\PhoneGateway($db))->routesAll() === []) exit(0);
    $stats = (new AppointmentReminders($db))->run($connections, time(), new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? ''));
    (new VetNet\Cpanel\BulkClinicMessages($db,$config))->deliver();
    if ($stats['accepted'] || $stats['rejected'] || $stats['unknown']) {
        fwrite(STDOUT, json_encode($stats, JSON_THROW_ON_ERROR) . PHP_EOL);
    }
    exit($stats['rejected'] || $stats['unknown'] ? 1 : 0);
} catch (Throwable $error) {
    if (class_exists('VetNet\\Cpanel\\CronGuard')) VetNet\Cpanel\CronGuard::finish('error',isset($error)&&$error instanceof Throwable?get_class($error):null);
    fwrite(STDERR, 'VetZimo randevu hatırlatmaları çalıştırılamadı (' . get_class($error) . '). PHP cURL, bağlantı ayarları ve 019 numaralı SQL dosyasını kontrol edin.' . PHP_EOL);
    exit(1);
}
