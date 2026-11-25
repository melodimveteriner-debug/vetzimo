<?php
declare(strict_types=1);
// Yönetici gelişmiş panel verisini önceden hesaplar (cron: */10 * * * * php bin/center-analytics.php).
if (PHP_SAPI !== 'cli') exit(1);
$root = dirname(__DIR__);
foreach (['Database', 'CenterAnalytics'] as $class) require_once $root.'/src/'.$class.'.php';
$config = require $root.'/config.php';
$db = VetNet\Cpanel\Database::connect($config['dsn'], $config['username'], $config['password']);
$started = microtime(true);
(new VetNet\Cpanel\CenterAnalytics($db))->get(true, time());
echo 'Panel verisi hesaplandı: '.round(microtime(true) - $started, 2)." sn\n";
