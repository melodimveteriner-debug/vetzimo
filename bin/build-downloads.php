<?php
declare(strict_types=1);

// İndirme klasörünü hazırlar: public/download altına tüm kurulum dosyalarını toplar ve manifest.json yazar.
// Kullanım:  php bin/build-downloads.php
// - Dosyalara doğrudan erişim kapalıdır; her indirme /download/<anahtar> üzerinden sayılarak sunulur (src/AppDownloads.php).
// - Ajanlar public/download/agents altındadır ve yalnız ücretli bayi oturumuyla indirilebilir.
// - Kaynaklar apps/, bridge-agent/ ve phone-agent/ klasörlerinde de kalır.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$root = dirname(__DIR__);
$config = require getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php';
$origin = rtrim((string)$config['origin'], '/');
$out = $root.'/public/download';
$agents = $out.'/agents';
foreach ([$out, $agents] as $d) if (!is_dir($d) && !mkdir($d, 0755, true)) { fwrite(STDERR, "Klasör oluşturulamadı: $d\n"); exit(1); }

$desktop = json_decode((string)file_get_contents($root.'/apps/desktop/package.json'), true)['version'] ?? '1.0.0';
$mobile = preg_match('~versionName\s+"([^"]+)"~', (string)@file_get_contents($root.'/apps/mobile/android/app/build.gradle'), $m) ? $m[1] : '1.0.0';
$agentVersion = preg_match('~const VERSION\s*=\s*"([^"]+)"~', (string)file_get_contents($root.'/bridge-agent/agent.mjs'), $m) ? $m[1] : '';
$dist = $root.'/apps/desktop/dist';

// [anahtar, dosya adı, kaynak, sürüm]
$items = [
    ['windows', "VetZimo-Kurulum-$desktop.exe", "$dist/VetZimo-Kurulum-$desktop.exe", $desktop],
    ['windows-zip', "VetZimo-$desktop-win.zip", "$dist/VetZimo-$desktop-win.zip", $desktop],
    // İmzalı .dmg (apps/ci/apple-builds.yml ile macOS'ta üretilir) varsa o, yoksa Linux'ta üretilen .zip sunulur.
    is_file("$dist/VetZimo-$desktop-arm64.dmg") ? ['macos-arm64', "VetZimo-$desktop-mac-apple-silicon.dmg", "$dist/VetZimo-$desktop-arm64.dmg", $desktop]
        : ['macos-arm64', "VetZimo-$desktop-mac-apple-silicon.zip", "$dist/VetZimo-$desktop-arm64-mac.zip", $desktop],
    is_file("$dist/VetZimo-$desktop.dmg") ? ['macos-x64', "VetZimo-$desktop-mac-intel.dmg", "$dist/VetZimo-$desktop.dmg", $desktop]
        : ['macos-x64', "VetZimo-$desktop-mac-intel.zip", "$dist/VetZimo-$desktop-mac.zip", $desktop],
    ['linux', "VetZimo-$desktop.AppImage", "$dist/VetZimo-$desktop.AppImage", $desktop],
    ['linux-deb', "vetzimo-desktop_{$desktop}_amd64.deb", "$dist/vetzimo-desktop_{$desktop}_amd64.deb", $desktop],
    ['android', "VetZimo-$mobile.apk", $root.'/apps/mobile/android/app/build/outputs/apk/release/app-release.apk', $mobile],
    ['android-aab', "VetZimo-$mobile.aab", $root.'/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab', $mobile],
];
$files = [];
$keep = ['manifest.json', '.htaccess', 'agents'];
foreach ($items as [$key, $name, $src, $version]) {
    if (!is_file($src)) continue;
    $dst = $out.'/'.$name;
    if (!is_file($dst) || filesize($dst) !== filesize($src) || filemtime($dst) < filemtime($src)) copy($src, $dst);
    $files[$key] = ['file' => $name, 'version' => $version];
    $keep[] = $name;
}

// iPhone / iPad: ana ekrana tam ekran VetZimo uygulaması ekleyen kurulum profili (App Store yayımlanana kadar).
$icon = $root.'/apps/mobile/www/icon.png';
$uuid = static fn(string $seed): string => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(strtoupper(substr(hash('sha256', $seed), 0, 32)), 4));
$host = (string)(parse_url($origin, PHP_URL_HOST) ?: 'vetzimo.com');
$plist = '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'."\n"
    .'<plist version="1.0"><dict><key>PayloadContent</key><array><dict>'
    .'<key>FullScreen</key><true/><key>IsRemovable</key><true/><key>Precomposed</key><true/>'
    .(is_file($icon) ? '<key>Icon</key><data>'.base64_encode((string)file_get_contents($icon)).'</data>' : '')
    .'<key>Label</key><string>VetZimo</string>'
    .'<key>PayloadDescription</key><string>VetZimo uygulamasını ana ekranınıza ekler. Bildirim, kamera ve konum izinleri ilk kullanımda ayrıca sorulur.</string>'
    .'<key>PayloadDisplayName</key><string>VetZimo</string>'
    .'<key>PayloadIdentifier</key><string>com.vetzimo.webclip</string>'
    .'<key>PayloadType</key><string>com.apple.webClip.managed</string>'
    .'<key>PayloadUUID</key><string>'.$uuid($host.'|clip').'</string><key>PayloadVersion</key><integer>1</integer>'
    .'<key>URL</key><string>'.htmlspecialchars($origin.'/app', ENT_XML1).'</string>'
    .'</dict></array>'
    .'<key>PayloadDescription</key><string>VetZimo veteriner klinik uygulaması (iPhone ve iPad). Profil yalnız ana ekran simgesi ekler; cihazınızda başka hiçbir ayarı değiştirmez ve Ayarlar › Genel › VPN ve Aygıt Yönetimi bölümünden kaldırılabilir.</string>'
    .'<key>PayloadDisplayName</key><string>VetZimo uygulaması</string>'
    .'<key>PayloadIdentifier</key><string>com.vetzimo.app.profile</string>'
    .'<key>PayloadOrganization</key><string>VetZimo</string>'
    .'<key>PayloadRemovalDisallowed</key><false/>'
    .'<key>PayloadType</key><string>Configuration</string>'
    .'<key>PayloadUUID</key><string>'.$uuid($host.'|profile').'</string><key>PayloadVersion</key><integer>1</integer>'
    .'</dict></plist>'."\n";
file_put_contents($out.'/VetZimo-iOS.mobileconfig', $plist);
$files['ios'] = ['file' => 'VetZimo-iOS.mobileconfig', 'version' => $mobile];
$keep[] = 'VetZimo-iOS.mobileconfig';

// Klinik ajanı (Bakanlık köprüsü, e-belge, WhatsApp, cihaz entegrasyonu): anahtar içermez, eşleştirme kodla yapılır.
$zipName = 'VetZimo-Klinik-Ajani'.($agentVersion ? "-$agentVersion" : '').'.zip';
$tmp = $agents.'/.'.$zipName.'.tmp';
$zip = new ZipArchive();
$zip->open($tmp, ZipArchive::OVERWRITE | ZipArchive::CREATE);
foreach (['agent.mjs','whatsapp.mjs','devices.mjs','device-parsers.mjs','recorder.js','panel.html','package.json','kur.cmd','kur.ps1','baslat.vbs','baslat.sh','OKU-BENI.txt'] as $f) {
    $zip->addFile($root.'/bridge-agent/'.$f, 'VetZimoKopru/'.$f);
    $zip->setMtimeName('VetZimoKopru/'.$f, filemtime($root.'/bridge-agent/'.$f));
}
$zip->addFromString('VetZimoKopru/config.json', json_encode(['server' => $origin, 'token' => '', 'ministryUrl' => 'https://vetbis.tarimorman.gov.tr'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
$zip->setMtimeName('VetZimoKopru/config.json', filemtime($root.'/bridge-agent/agent.mjs'));
$zip->close();
rename($tmp, $agents.'/'.$zipName);
$files['agent'] = ['file' => $zipName, 'version' => $agentVersion];
$agentKeep = [$zipName];

// Telefon ajanı (Android SMS hattı, Termux): sunucu adresi yerleştirilmiş kurulum betiği.
file_put_contents($agents.'/vetzimo-telefon-kur.sh', str_replace('__VETZIMO_SERVER__', $origin, (string)file_get_contents($root.'/phone-agent/kur.sh')));
$files['phone'] = ['file' => 'vetzimo-telefon-kur.sh', 'version' => ''];
$agentKeep[] = 'vetzimo-telefon-kur.sh';

// Eski sürüm dosyalarını temizle (yalnız bu klasörde).
foreach ([[$out, $keep], [$agents, $agentKeep]] as [$dir, $allowed]) {
    foreach (scandir($dir) as $f) {
        if ($f[0] === '.' || in_array($f, $allowed, true)) continue;
        if (is_file($dir.'/'.$f)) unlink($dir.'/'.$f);
    }
}
foreach ($files as $key => &$row) {
    $p = (in_array($key, ['agent', 'phone'], true) ? $agents : $out).'/'.$row['file'];
    $row += ['size' => filesize($p), 'sha256' => hash_file('sha256', $p), 'date' => date('Y-m-d', filemtime($p))];
}
unset($row);
file_put_contents($out.'/manifest.json', json_encode(['generated' => gmdate('c'), 'files' => $files], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
foreach ($files as $k => $r) printf("%-12s %-42s %8.1f MB\n", $k, $r['file'], $r['size'] / 1048576);
