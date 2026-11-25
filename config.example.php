<?php
declare(strict_types=1);

// VetZimo yapılandırma ÖRNEĞİ.
// 1) Bu dosyanın bir kopyasını AYNI KLASÖRDE "config.php" adıyla oluşturun (public klasörünün içine KOYMAYIN).
// 2) "BURAYA_..." yazan yerleri doldurun. Anahtarları kurulum rehberindeki "Anahtar üret" düğmesiyle üretebilirsiniz.
// 3) Kurulum bittikten sonra installationToken değerini '' (boş) yapın ve public/install.php dosyasını silin.
// Bu dosyayı, şifreleri ve anahtarları kimseyle (sohbet, e-posta, WhatsApp) paylaşmayın.
return [
    // Sitenin tam adresi; sonunda "/" OLMADAN. Örnek: https://vetzimo.com
    'origin' => 'https://vetzimo.com',

    // cPanel › MySQL Veritabanları'nda oluşturduğunuz veritabanı (cPanel kullanıcı adınız başa eklenir, ör. hesap_vetzimo)
    'dsn' => 'mysql:host=localhost;dbname=BURAYA_VERITABANI_ADI;charset=utf8mb4',
    'username' => 'BURAYA_VERITABANI_KULLANICISI',
    'password' => 'BURAYA_VERITABANI_SIFRESI',

    // En az 32 karakterlik rastgele metin (giriş denemesi sınırlama anahtarı)
    'rateSecret' => 'BURAYA_RATE_SECRET',

    // Base64 biçiminde 32 baytlık rastgele anahtar. Kurulumdan sonra ASLA değiştirmeyin;
    // değişirse yönetici 2FA ve kayıtlı sağlayıcı şifreleri çözülemez. Ayrıca güvenli bir yere yedekleyin.
    'encryptionKey' => 'BURAYA_ENCRYPTION_KEY',

    // Kurulum anahtarı (en az 32 karakter). Yalnız kurulum sırasında gerekir; kurulumdan sonra '' yapın.
    'installationToken' => 'BURAYA_KURULUM_ANAHTARI',

    // Web sitesi oluşturucu (klinik siteleri). Alt alan adı kullanmayacaksanız boş bırakın.
    'webBuilderZone' => '',
    'webBuilderWildcardHttps' => false,
    'webBuilderHttpsHosts' => [],
    'webBuilderMediaBytes' => 120000000,
    'webBuilderDraftBytes' => 6000000,

    // Uygulama bildirimleri (Firebase / Windows). Yayın rehberi docs/MAGAZA-YAYIN.md. Şimdilik boş kalabilir.
    'nativePushProject' => '',
    'nativePushCredentialFile' => '',
    'nativeWindowsPush' => ['tenant' => '', 'client' => '', 'secret' => ''],

    // Android uygulamasının vetzimo.com bağlantılarını doğrudan açması için imza parmak izi (gizli değildir).
    'androidWebAppFingerprints' => ['C2:B9:D3:53:B9:22:BE:69:AC:B9:18:6D:7F:E0:34:BF:11:3C:E9:DA:C1:CC:C4:CB:5F:79:0B:82:C7:B9:E2:01'],

    // İsteğe bağlı: hava durumu servisi anahtarı (boşsa ücretsiz servis kullanılır).
    'weatherApiKey' => '',

    // Bu satırı değiştirmeyin.
    'assets' => __DIR__ . '/public',
];
