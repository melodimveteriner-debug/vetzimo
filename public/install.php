<?php
declare(strict_types=1);
use VetNet\Cpanel\Database;
use VetNet\Cpanel\Installer;
foreach (['Totp','ClinicAccess','WorkspaceRepository','Database','DealerLogin','Migrations','Installer'] as $class) require dirname(__DIR__).'/src/'.$class.'.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Content-Type: text/html; charset=utf-8');
$setupSecret=\VetNet\Cpanel\Totp::secret();
$message = '';
$ready = false;
$done = false;
try {
    if (!in_array($_SERVER['HTTPS'] ?? '', ['on','1'], true)) throw new RuntimeException('Kurulum için HTTPS bağlantısı gerekli.',400);
    $path = getenv('VETNET_CPANEL_CONFIG') ?: dirname(__DIR__).'/config.php';
    if (!is_file($path)) throw new RuntimeException('Önce config.example.php dosyasını düzenleyerek config.php olarak kaydedin.',503);
    $config = require $path;
    $token = $config['installationToken'] ?? '';
    if (!is_string($token) || strlen($token) < 32) throw new RuntimeException('Kurulum anahtarı tanımlı değil; kurulum kapalı.',403);
    $key = $config['encryptionKey'] ?? '';
    if (!is_string($key) || strlen(base64_decode($key,true) ?: '') !== 32) {
        throw new RuntimeException('config.php içinde Base64 biçiminde 32 baytlık encryptionKey tanımlayın.',503);
    }
    if (!extension_loaded('sodium')) throw new RuntimeException('Yönetici doğrulaması için PHP Sodium eklentisi gerekli.',503);
    if (!extension_loaded('pdo_mysql') || !in_array('argon2id',password_algos(),true)) throw new RuntimeException('PDO MySQL ve Argon2id destekli PHP gerekli.',503);
    $db = Database::connect($config['dsn'],$config['username'],$config['password']);
    if ($db->query('SHOW TABLES')->fetch()) throw new RuntimeException('Bu veritabanı boş değil. Kurulum kapalı; mevcut kayıtlar korunuyor.',409);
    $ready = true;
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!hash_equals($config['origin'],$_SERVER['HTTP_ORIGIN'] ?? '')) throw new RuntimeException('İstek kaynağı doğrulanamadı.',403);
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) throw new RuntimeException('İstek çok büyük.',413);
        $submitted = $_POST['token'] ?? '';
        if (!is_string($submitted) || !hash_equals($token,$submitted)) throw new RuntimeException('Kurulum anahtarı doğrulanamadı.',403);
        foreach (['name','phone','email','password','confirmation'] as $field) {
            if (!is_string($_POST[$field] ?? null)) throw new RuntimeException('Tüm alanları doldurunuz.',422);
        }
        if ($_POST['password'] !== $_POST['confirmation']) throw new RuntimeException('Şifreler aynı olmalıdır.',422);
        $center=null;
        if(isset($_POST['centerEmail'])) {
            foreach(['centerEmail','centerPassword','centerSecret','centerOtp'] as $field) if(!is_string($_POST[$field] ?? null)) throw new RuntimeException('Yönetici kurulumu alanları eksik.',422);
            $center=['email'=>$_POST['centerEmail'],'password'=>$_POST['centerPassword'],'secret'=>$_POST['centerSecret'],'otp'=>$_POST['centerOtp'],'key'=>$config['encryptionKey'] ?? ''];
        }
        (new Installer($db,dirname(__DIR__)))->install($_POST['name'],$_POST['phone'],$_POST['email'],$_POST['password'],$center);
        $ready = false;
        $done = true;
        $message = 'Klinik hesabı oluşturuldu. Kurulum kilitlendi. Yönetici girişi /yonetim adresindedir; doğrulama uygulamasında bir sonraki kodu bekleyin. config.php içindeki installationToken değerini boşaltın ve install.php dosyasını kaldırın.';
    }
} catch (Throwable $error) {
    $code = $error->getCode();
    if ($error instanceof RuntimeException && !$error instanceof PDOException && is_int($code) && $code >= 400 && $code <= 599) {
        http_response_code($code);
        $message = $error->getMessage();
    } else {
        http_response_code(500);
        $message = 'Kurulum tamamlanamadı. Veritabanı erişimini ve PHP hata günlüğünü kontrol edin. Mevcut tablolar otomatik silinmedi.';
        error_log('VetZimo installer: '.get_class($error));
    }
}
?>
<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VetZimo · PHP Kurulumu</title>
<style>body{margin:0;background:#eef3f8;color:#172b40;font:16px system-ui,sans-serif}main{max-width:620px;margin:4vh auto;padding:28px;background:white;border-radius:20px;box-shadow:0 10px 40px #16324f12}h1{font-size:26px}p{line-height:1.6}label{display:block;margin-top:14px;font-weight:600}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bac9d8;border-radius:8px;margin-top:6px;font:inherit}button,a{display:inline-block;margin-top:20px;background:#1965c2;color:white;padding:12px 24px;border:0;border-radius:8px;font:inherit;text-decoration:none}.notice{background:#eef4ff;padding:16px;border-left:4px solid #1965c2}.status{padding:16px;background:#fff5d9;overflow-wrap:anywhere}@media(max-width:680px){main{margin:12px;padding:20px}}</style>
<main><h1>VetZimo <small>PHP / MySQL kurulumu</small></h1><p class="notice">Bu PHP aktarımı merkez ve klinik hesaplarını, temel hasta kayıtlarını ve satış–stok–tahsilat akışını içerir. Tüm platformun dönüşümü tamamlanmamıştır. Yalnızca yeni ve boş bir test veritabanına kurunuz.</p>
<?php if ($message !== ''): ?><p class="status" role="alert"><?=htmlspecialchars($message,ENT_QUOTES,'UTF-8')?></p><?php endif; ?>
<?php if ($done): ?><a href="/giris">Klinik girişine geç</a><?php endif; ?>
<?php if ($ready): ?><form method="post" action="/install.php">
<label>Kurulum anahtarı<input name="token" type="password" required autocomplete="off" maxlength="256"></label>
<label>Klinik adı<input name="name" required maxlength="160" autocomplete="organization"></label>
<label>Cep telefonu<input name="phone" type="tel" required maxlength="32" autocomplete="tel" placeholder="05xx xxx xx xx"></label>
<label>E-posta<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
<label>Şifre (en az 12 karakter)<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
<label>Şifre tekrar<input name="confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
<h2>Merkez yöneticisi</h2>
<label>Yönetici e-postası<input name="centerEmail" type="email" required autocomplete="username"></label>
<label>Ayrı yönetici şifresi<input name="centerPassword" type="password" required minlength="12" autocomplete="new-password"></label>
<p>Doğrulama uygulamanızda yeni hesap ekleyin. Zaman tabanlı, 6 haneli kod ve 30 saniye seçin. Aşağıdaki anahtarı uygulamaya girin; kimseyle paylaşmayın.</p>
<p><code><?=htmlspecialchars($setupSecret,ENT_QUOTES,'UTF-8')?></code></p>
<input type="hidden" name="centerSecret" value="<?=htmlspecialchars($setupSecret,ENT_QUOTES,'UTF-8')?>">
<label>Uygulamanın ürettiği kod<input name="centerOtp" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>
<button type="submit">Klinik ve yönetici hesaplarını oluştur</button></form><?php endif; ?></main></html>
