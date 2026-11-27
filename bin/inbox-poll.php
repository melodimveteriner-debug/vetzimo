<?php
declare(strict_types=1);
// Zamanlanmış görev (her 1-2 dakikada bir): IMAP ile bağlanan klinik e-posta kutularındaki yeni iletileri gelen kutusuna alır.
// Örnek cron: * * * * * php /home/KULLANICI/public_html/bin/inbox-poll.php
use VetNet\Cpanel\Database;
use VetNet\Cpanel\OmniInbox;

if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$root = dirname(__DIR__);
foreach (['Database', 'Totp', 'ClinicAccess', 'ClinicRecords', 'OmniInbox'] as $class) require_once $root.'/src/'.$class.'.php';
try {
    $config = require $root.'/config.php';
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    require_once dirname(__DIR__).'/src/CronGuard.php'; VetNet\Cpanel\CronGuard::begin($db,'inbox-poll');
    $lock = $db->query("SELECT GET_LOCK(CONCAT('vetzimo-inbox-poll-', MD5(DATABASE())), 0)")->fetchColumn();
    if ((int)$lock !== 1) exit(0);
    $stats = (new OmniInbox($db, (string)($config['encryptionKey'] ?? ''), (string)($config['origin'] ?? '')))->pollMail(time());
    if ($stats['messages'] || $stats['errors']) fwrite(STDOUT, json_encode($stats, JSON_THROW_ON_ERROR).PHP_EOL);
    exit($stats['errors'] ? 1 : 0);
} catch (Throwable $error) {
    if (class_exists('VetNet\\Cpanel\\CronGuard')) VetNet\Cpanel\CronGuard::finish('error',isset($error)&&$error instanceof Throwable?get_class($error):null);
    fwrite(STDERR, 'VetZimo gelen kutusu e-posta denetimi çalıştırılamadı ('.get_class($error).': '.$error->getMessage().').'.PHP_EOL);
    exit(1);
}
