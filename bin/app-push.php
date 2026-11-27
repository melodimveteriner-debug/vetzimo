<?php
declare(strict_types=1);
// Uygulama bildirimleri: olay kuyruğu → bildirim merkezi → Android/iOS/web cihazları (cron: * * * * * php bin/app-push.php).
if (PHP_SAPI !== 'cli') exit(1);
$root = dirname(__DIR__);
foreach (['Database', 'Totp', 'ClinicAccess', 'WorkspaceRepository', 'ClinicRecords', 'Commerce', 'ClinicAlerts', 'AppPush', 'AppHub'] as $class) require_once $root.'/src/'.$class.'.php';
$config = require $root.'/config.php';
$db = VetNet\Cpanel\Database::connect($config['dsn'], $config['username'], $config['password']);
require_once dirname(__DIR__).'/src/CronGuard.php'; VetNet\Cpanel\CronGuard::begin($db,'app-push');
$lock = fopen(sys_get_temp_dir().'/vetzimo-app-push.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) exit(0); // önceki çalışma sürüyorsa çık
$now = time();
$hub = new VetNet\Cpanel\AppHub($db, $config);
$added = $hub->fanout($now);
if (intdiv($now, 60) % 2 === 0) $added += $hub->alerts($now);
$stat = (new VetNet\Cpanel\AppPush($db, $config))->work($now);
if (in_array('-v', $argv, true)) echo "Yeni bildirim: $added · ".json_encode($stat)."\n";
