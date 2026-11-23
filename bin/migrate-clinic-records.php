<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;
use VetNet\Cpanel\WorkspaceRepository;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
$partner = $argv[1] ?? '';
if ($argc !== 2 || !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $partner)) {
    fwrite(STDERR, "Kullanım: php bin/migrate-clinic-records.php BAYI_KIMLIGI\n");
    exit(2);
}
$root = dirname(__DIR__);
require $root.'/src/Database.php';
require $root.'/src/WorkspaceRepository.php';
try {
    $config = require (getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php');
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $result = (new WorkspaceRepository($db))->migrate('partner:'.$partner);
    echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, 'Klinik kayıt geçişi tamamlanamadı ('.get_class($error).').'.PHP_EOL);
    exit(1);
}
