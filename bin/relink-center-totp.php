<?php
declare(strict_types=1);

use VetNet\Cpanel\Center;
use VetNet\Cpanel\Database;
use VetNet\Cpanel\Totp;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
foreach (['Database','Totp','Center'] as $class) {
    require __DIR__.'/../src/'.$class.'.php';
}
$email=strtolower(trim($argv[1] ?? ''));
if ($argc!==2 || !filter_var($email,FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR,"Kullanım: php bin/relink-center-totp.php YONETICI_EPOSTASI\n");
    exit(1);
}
try {
    $config=require dirname(__DIR__).'/config.php';
    $db=Database::connect($config['dsn'],$config['username'],$config['password']);
    $query=$db->prepare("SELECT a.id,a.version,a.totp_seed FROM identity_account a
        JOIN identity_center c ON c.account_id=a.id
        WHERE a.kind='center' AND a.identifier=? AND a.blocked=0 AND c.is_owner=1");
    $query->execute([$email]);
    $account=$query->fetch();
    if (!$account) throw new RuntimeException('Etkin merkez sahibi hesabı bulunamadı.');
    $key=$config['encryptionKey'] ?? '';
    Totp::decrypt($account['totp_seed'],$key);
    $secret=Totp::secret();
    $encrypted=Totp::encrypt($secret,$key);
    fwrite(STDOUT,"Sunucu UTC saati: ".gmdate('Y-m-d H:i:s')."\n");
    fwrite(STDOUT,"Doğrulama uygulamasında yeni VetZimo hesabı ekleyin. Zaman tabanlı, SHA1, 6 hane, 30 saniye.\n");
    fwrite(STDOUT,"Kurulum anahtarı: ".$secret."\nYeni kaydın ürettiği kod: ");
    $step=Totp::verify($secret,trim((string)fgets(STDIN)),time());
    if ($step===null) throw new RuntimeException('Kod doğrulanamadı. Telefon ve sunucu saatlerini kontrol edin.');
    $db->beginTransaction();
    $q=$db->prepare("UPDATE identity_account SET totp_seed=?,totp_step=?,version=version+1
        WHERE id=? AND version=? AND totp_seed=? AND blocked=0");
    $q->execute([$encrypted,$step,$account['id'],$account['version'],$account['totp_seed']]);
    if ($q->rowCount()!==1) throw new RuntimeException('Hesap değişti. İşlemi yeniden başlatın.');
    $db->prepare('DELETE FROM identity_session WHERE account_id=?')->execute([$account['id']]);
    (new Center($db,$config))->audit($account['id'],'center.totp_relinked');
    $db->commit();
    fwrite(STDOUT,"Eşleştirme tamamlandı. /yonetim sayfasında mevcut şifrenizle bir sonraki kodu kullanın.\n");
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    fwrite(STDERR,($error instanceof RuntimeException && !$error instanceof PDOException
        ? $error->getMessage() : 'İşlem tamamlanamadı. PHP ve veritabanı yapılandırmasını kontrol edin.')."\n");
    exit(1);
}
