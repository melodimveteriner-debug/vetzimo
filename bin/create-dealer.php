<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;
use VetNet\Cpanel\WorkspaceRepository;
use VetNet\Cpanel\DealerLogin;

if (PHP_SAPI !== 'cli') exit(1);
require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/DealerLogin.php';
require __DIR__ . '/../src/WorkspaceRepository.php';
require __DIR__ . '/../src/ClinicAccess.php';

if ($argc !== 6) {
    fwrite(STDERR, "Kullanım: php create-dealer.php CONFIG ŞABLON KLİNİK TELEFON EPOSTA\nŞifreyi standart girdiden verin.\n");
    exit(1);
}
[, $configFile, $template, $name, $phone, $email] = $argv;
$password = rtrim((string) fgets(STDIN), "\r\n");
$phone = DealerLogin::normalizePhone($phone);
$email = strtolower(trim($email));
$name = trim($name);
if ($phone === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 ||
    strlen($password) < 12 || strlen($password) > 512 || $name === '' || strlen($name) > 160) {
    fwrite(STDERR, "Klinik adı, telefon, e-posta ve 12–512 bayt uzunluğunda bir şifre gerekli.\n");
    exit(1);
}
try {
    $config = require $configFile;
    $state = json_decode((string) file_get_contents($template), false, 64, JSON_THROW_ON_ERROR);
    if (($state->version ?? null) !== 1 || count($state->branches ?? []) !== 1) {
        throw new RuntimeException('Başlangıç çalışma alanı şablonu geçersiz.');
    }
    $state->preferences->clinic = $name;
    $state->branches[0]->name = 'Merkez';
    $state->branches[0]->city = '';
    $partner = bin2hex(random_bytes(16));
    $account = bin2hex(random_bytes(16));
    $membership = bin2hex(random_bytes(16));
    $now = time();
    $stamp = gmdate('c', $now);
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $db->beginTransaction();
    $db->prepare("INSERT INTO partner_account(id,code,name,email,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)")
        ->execute([$partner, strtoupper(substr($partner, 0, 12)), $name, $email, $phone, $stamp, $stamp]);
    $db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES (?,'phone',?,?,?)")
        ->execute([$account, $phone, password_hash($password, PASSWORD_ARGON2ID), $now]);
    $db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES (?,?,?,'dealer',?,'{}','active')")
        ->execute([$membership, $account, $partner, $name]);
    (new WorkspaceRepository($db))->save('partner:' . $partner, 0, $state);
    $db->commit();
    fwrite(STDOUT, "Bayi ve çalışma alanı oluşturuldu.\n");
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    fwrite(STDERR, "Kurulum tamamlanamadı. Yapılandırmayı ve başlangıç dosyasını kontrol edin.\n");
    exit(1);
}
