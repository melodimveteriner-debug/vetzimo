<?php
declare(strict_types=1);

// İndirme klasörünü hazırlar: public/indir altına tüm kurulum dosyalarını toplar ve manifest.json yazar.
// Kullanım:  php bin/build-downloads.php
// Kaynaklar apps/ ve ajan klasörlerinde de kalır; burada yalnız kopyaları bulunur.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$root = dirname(__DIR__);
$config = require getenv('VETNET_CPANEL_CONFIG') ?: $root.'/config.php';
$origin = rtrim((string)$config['origin'], '/');
$out = $root.'/public/indir';
if (!is_dir($out) && !mkdir($out, 0755, true)) { fwrite(STDERR, "Klasör oluşturulamadı: $out\n"); exit(1); }

$desktop = json_decode((string)file_get_contents($root.'/apps/desktop/package.json'), true)['version'] ?? '1.0.0';
$mobileGradle = (string)@file_get_contents($root.'/apps/mobile/android/app/build.gradle');
$mobile = preg_match('~versionName\s+"([^"]+)"~', $mobileGradle, $m) ? $m[1] : '1.0.0';
$agent = preg_match('~const VERSION\s*=\s*"([^"]+)"~', (string)file_get_contents($root.'/bridge-agent/agent.mjs'), $m) ? $m[1] : '';

// [anahtar, platform, dosya adı, kaynak, sürüm]
$items = [
    ['windows', 'windows', "VetZimo-Kurulum-$desktop.exe", $root."/apps/desktop/dist/VetZimo-Kurulum-$desktop.exe", $desktop],
    ['windows-zip', 'windows', "VetZimo-$desktop-win.zip", $root."/apps/desktop/dist/VetZimo-$desktop-win.zip", $desktop],
    ['macos', 'macos', "VetZimo-$desktop.dmg", $root."/apps/desktop/dist/VetZimo-$desktop.dmg", $desktop],
    ['linux', 'linux', "VetZimo-$desktop.AppImage", $root."/apps/desktop/dist/VetZimo-$desktop.AppImage", $desktop],
    ['linux-deb', 'linux', "vetzimo-desktop_{$desktop}_amd64.deb", $root."/apps/desktop/dist/vetzimo-desktop_{$desktop}_amd64.deb", $desktop],
    ['android', 'android', "VetZimo-$mobile.apk", $root.'/apps/mobile/android/app/build/outputs/apk/release/app-release.apk', $mobile],
    ['android-aab', 'android', "VetZimo-$mobile.aab", $root.'/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab', $mobile],
];
$files = [];
$keep = ['manifest.json', '.htaccess'];
foreach ($items as [$key, $platform, $name, $src, $version]) {
    if (!is_file($src)) continue;
    $dst = $out.'/'.$name;
    if (!is_file($dst) || filesize($dst) !== filesize($src) || filemtime($dst) < filemtime($src)) copy($src, $dst);
    $files[$key] = ['platform' => $platform, 'file' => $name, 'version' => $version];
    $keep[] = $name;
}

// Klinik ajanı (Bakanlık köprüsü, e-belge, WhatsApp, cihaz entegrasyonu): anahtar içermez, eşleştirme kodla yapılır.
$zipName = 'VetZimo-Klinik-Ajani'.($agent ? "-$agent" : '').'.zip';
$tmp = $out.'/.'.$zipName.'.tmp';
$zip = new ZipArchive();
$zip->open($tmp, ZipArchive::OVERWRITE | ZipArchive::CREATE);
foreach (['agent.mjs','whatsapp.mjs','devices.mjs','device-parsers.mjs','recorder.js','panel.html','package.json','kur.cmd','kur.ps1','baslat.vbs','baslat.sh','OKU-BENI.txt'] as $f) {
    $zip->addFile($root.'/bridge-agent/'.$f, 'VetZimoKopru/'.$f);
    $zip->setMtimeName('VetZimoKopru/'.$f, filemtime($root.'/bridge-agent/'.$f));
}
$zip->addFromString('VetZimoKopru/config.json', json_encode(['server' => $origin, 'token' => '', 'ministryUrl' => 'https://vetbis.tarimorman.gov.tr'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
$zip->setMtimeName('VetZimoKopru/config.json', filemtime($root.'/bridge-agent/agent.mjs'));
$zip->close();
rename($tmp, $out.'/'.$zipName);
$files['agent'] = ['platform' => 'windows', 'file' => $zipName, 'version' => $agent];
$keep[] = $zipName;

// Telefon ajanı (Android SMS hattı, Termux): sunucu adresi yerleştirilmiş kurulum betiği.
foreach (['kur.sh' => 'vetzimo-telefon-kur.sh', 'vetzimo-telefon.py' => 'vetzimo-telefon.py'] as $src => $name) {
    file_put_contents($out.'/'.$name, str_replace('__VETZIMO_SERVER__', $origin, (string)file_get_contents($root.'/phone-agent/'.$src)));
    $keep[] = $name;
}
$files['phone'] = ['platform' => 'android', 'file' => 'vetzimo-telefon-kur.sh', 'version' => ''];

// Eski sürüm dosyalarını temizle (yalnız bu klasörde).
foreach (scandir($out) as $f) {
    if ($f[0] === '.' || in_array($f, $keep, true)) continue;
    if (is_file($out.'/'.$f)) unlink($out.'/'.$f);
}
foreach ($files as &$row) {
    $p = $out.'/'.$row['file'];
    $row += ['size' => filesize($p), 'sha256' => hash_file('sha256', $p), 'date' => date('Y-m-d', filemtime($p)), 'url' => '/indir/'.rawurlencode($row['file'])];
}
unset($row);
file_put_contents($out.'/manifest.json', json_encode(['generated' => gmdate('c'), 'files' => $files], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
foreach ($files as $k => $r) printf("%-12s %-34s %8.1f MB\n", $k, $r['file'], $r['size'] / 1048576);
