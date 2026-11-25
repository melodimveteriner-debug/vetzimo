<?php
declare(strict_types=1);

// Bayi abonelik hatırlatmaları (3 ay, 1 ay, son 48 saat): e-posta, SMS ve WhatsApp. Cron: günde bir kez (ör. 10:17).
//   php bin/subscription-reminders.php          -> gönderir
//   php bin/subscription-reminders.php --dry    -> yalnız kime ne gideceğini listeler
use VetNet\Cpanel\Database;
use VetNet\Cpanel\SubscriptionReminders;

if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$root = dirname(__DIR__);
foreach (glob($root.'/src/*.php') as $file) require_once $file;
try {
    $config = require getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php';
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $sent = (new SubscriptionReminders($db, (string)($config['encryptionKey'] ?? ''), (string)$config['origin']))->run(time(), in_array('--dry', $argv, true));
    foreach ($sent as $s) fwrite(STDOUT, $s['stage'].' · '.$s['name'].' · '.($s['channels'] ? implode(',', $s['channels']) : 'gönderim yok').PHP_EOL);
    exit(0);
} catch (Throwable $error) {
    fwrite(STDERR, 'VetZimo abonelik hatırlatmaları çalıştırılamadı ('.get_class($error).').'.PHP_EOL);
    exit(1);
}
