<?php
declare(strict_types=1);

use VetNet\Cpanel\ClinicDirectory;
use VetNet\Cpanel\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$operation = $argv[1] ?? '';
$partner = $argv[2] ?? '';
if ($argc !== 3 || !in_array($operation, ['seed', 'verify', 'enable', 'disable'], true) ||
    !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $partner)) {
    fwrite(STDERR, "Kullanım: php bin/clinic-directory.php seed|verify|enable|disable BAYI_KIMLIGI\n");
    exit(2);
}

$root = dirname(__DIR__);
require $root . '/src/Database.php';
require $root . '/src/WorkspaceRepository.php';

try {
    $config = require (getenv('VETNET_CPANEL_CONFIG') ?: $root . '/config.php');
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $directory = new ClinicDirectory($db);
    $workspace = 'partner:' . $partner;
    $db->beginTransaction();
    $result = match ($operation) {
        'seed' => $directory->seed($workspace),
        'verify' => $directory->verify($workspace),
        'enable' => $directory->verify($workspace, true),
        'disable' => $directory->disable($workspace),
    };
    $db->commit();
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    $message = $error instanceof PDOException ? 'Veritabanı işlemi tamamlanamadı. SQLSTATE ' . $error->getCode() :
        ($error instanceof DomainException || get_class($error) === RuntimeException ? $error->getMessage() : 'Dizin işlemi tamamlanamadı.');
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}
