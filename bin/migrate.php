<?php
declare(strict_types=1);

// Kullanım (cPanel Terminal):  php bin/migrate.php          -> bekleyen değişiklikleri uygular
//                               php bin/migrate.php --check  -> sadece listeler
use VetNet\Cpanel\Database;
use VetNet\Cpanel\Migrations;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
require __DIR__.'/../src/Database.php';
require __DIR__.'/../src/Migrations.php';

try {
    $config = require getenv('VETNET_CPANEL_CONFIG') ?: dirname(__DIR__).'/config.php';
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $migrations = new Migrations($db, dirname(__DIR__));
    $pending = $migrations->pending();
    if (($argv[1] ?? '') === '--check') {
        fwrite(STDOUT, $pending ? "Bekleyen değişiklikler:\n  ".implode("\n  ", $pending)."\n" : "Veritabanı güncel.\n");
        exit($pending ? 2 : 0);
    }
    $applied = $migrations->apply();
    fwrite(STDOUT, $applied ? "Uygulandı:\n  ".implode("\n  ", $applied)."\n" : "Veritabanı zaten güncel.\n");
} catch (Throwable $error) {
    fwrite(STDERR, 'Veritabanı güncellemesi tamamlanamadı: '.$error->getMessage()."\n");
    exit(1);
}
