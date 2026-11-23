<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;
use VetNet\Cpanel\NativePush;

if (PHP_SAPI!=='cli') { http_response_code(404); exit(1); }
$root=dirname(__DIR__);
foreach (['Database','Totp','ClinicAccess','DealerLogin','WorkspaceRepository','Commerce','DealerWorkspace','WebBuilder','HomeVisit','NativeApp','NativePush'] as $class) require $root.'/src/'.$class.'.php';
try {
    $config=require (getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php');
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    if ((int)$db->query("SELECT GET_LOCK('vetzimo.native.push',0)")->fetchColumn()!==1) exit;
    (new NativePush($config['nativePushProject']??'',$config['nativePushCredentialFile']??''))->work($db,$config,time());
} catch (Throwable $e) {
    fwrite(STDERR,'VetZimo push işlemi durdu: '.get_class($e)."\n"); exit(1);
}
