<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Uygulama indirme merkezi: tüm dosyalar public/download altında durur ama doğrudan sunulmaz.
 * Her indirme bu sınıftan geçer: erişim denetlenir (ajanlar yalnız ücretli bayiler), sayılır (toplam, günlük benzersiz,
 * kaynak: web / qr / panel, indiren cihaz türü) ve dosya kaldığı yerden devam (Range) desteğiyle akıtılır.
 * Adresler sürümden bağımsızdır (/download/android); QR kodlar sürüm değişince de geçerli kalır.
 */
final class AppDownloads
{
    /** Yayımlanan anahtarlar: ad, platform, erişim. Dosya adları ve boyutlar manifest.json'dan gelir. */
    public const APPS = [
        'android' => ['Android uygulaması (APK)', 'android', 'public'],
        'android-aab' => ['Android paketi (Google Play)', 'android', 'public'],
        'ios' => ['iPhone ve iPad kurulum profili', 'ios', 'public'],
        'windows' => ['Windows kurulumu', 'windows', 'public'],
        'windows-zip' => ['Windows taşınabilir', 'windows', 'public'],
        'macos-arm64' => ['Mac (Apple Silicon)', 'macos', 'public'],
        'macos-x64' => ['Mac (Intel)', 'macos', 'public'],
        'linux' => ['Linux AppImage', 'linux', 'public'],
        'linux-deb' => ['Linux .deb', 'linux', 'public'],
        'agent' => ['Klinik ajanı', 'windows', 'paid'],
        'phone' => ['Telefon ajanı', 'android', 'paid'],
    ];
    public const PAGE = 'page';
    public const SOURCES = ['web', 'qr', 'panel'];
    private const CLIENTS = ['android', 'ios', 'windows', 'macos', 'linux', 'other'];
    private const BOTS = '~bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|curl/|wget/|python-requests|headless~i';

    public function __construct(private readonly PDO $db, private readonly string $root, private readonly string $secret) {}

    public function dir(): string { return $this->root.'/public/download'; }

    public const AGENT_FILES = ['agent.mjs','whatsapp.mjs','devices.mjs','device-parsers.mjs','recorder.js','panel.html','package.json','kur.cmd','kur.ps1','baslat.vbs','baslat.sh','OKU-BENI.txt'];

    /** Klinik ajanı zip'ini bridge-agent/ kaynağından üretir; manifest satırını döndürür. */
    public static function buildAgent(string $root, string $origin): array
    {
        $version = self::agentVersion($root);
        $dir = $root.'/public/download/agents';
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) throw new RuntimeException('Ajan klasörü oluşturulamadı.', 500);
        $name = 'VetZimo-Klinik-Ajani'.($version !== '' ? '-'.$version : '').'.zip';
        $tmp = $dir.'/.'.$name.'.'.getmypid().'.tmp';
        $zip = new \ZipArchive();
        if ($zip->open($tmp, \ZipArchive::OVERWRITE | \ZipArchive::CREATE) !== true) throw new RuntimeException('Ajan paketi oluşturulamadı.', 500);
        foreach (self::AGENT_FILES as $f) {
            $zip->addFile($root.'/bridge-agent/'.$f, 'VetZimoKopru/'.$f);
            $zip->setMtimeName('VetZimoKopru/'.$f, (int)filemtime($root.'/bridge-agent/'.$f));
        }
        $zip->addFromString('VetZimoKopru/config.json', json_encode(['server' => rtrim($origin, '/'), 'token' => '', 'ministryUrl' => 'https://vetbis.tarimorman.gov.tr'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $zip->setMtimeName('VetZimoKopru/config.json', (int)filemtime($root.'/bridge-agent/agent.mjs'));
        $zip->close();
        rename($tmp, $dir.'/'.$name);
        $path = $dir.'/'.$name;
        return ['file' => $name, 'version' => $version, 'size' => filesize($path), 'sha256' => hash_file('sha256', $path), 'date' => date('Y-m-d', (int)filemtime($path))];
    }

    public static function agentVersion(string $root): string
    {
        return preg_match('~const VERSION\s*=\s*"([^"]+)"~', (string)@file_get_contents($root.'/bridge-agent/agent.mjs'), $m) ? $m[1] : '';
    }

    /**
     * Ajan kaynağı (bridge-agent/) güncellendiyse indirme paketi ilk istekte yeni sürümle kendiliğinden üretilir;
     * sunucuda elle "php bin/build-downloads.php" çalıştırmak gerekmez. Eşzamanlı isteklerde tek süreç üretir.
     */
    public function freshAgent(string $origin): void
    {
        $version = self::agentVersion($this->root);
        $current = $this->manifest()['agent'] ?? null;
        if ($version === '' || !class_exists(\ZipArchive::class)) return;
        if (($current['version'] ?? '') === $version && is_file($this->dir().'/agents/'.basename((string)$current['file']))) return;
        $lock = @fopen($this->dir().'/agents/.build.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) return;
        try {
            clearstatcache();
            $raw = @file_get_contents($this->dir().'/manifest.json');
            $doc = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
            $old = $doc['files']['agent'] ?? null;
            if (($old['version'] ?? '') === $version && is_file($this->dir().'/agents/'.basename((string)$old['file']))) return;
            $row = self::buildAgent($this->root, $origin);
            $doc['files'] = ($doc['files'] ?? []);
            $doc['files']['agent'] = $row;
            $doc['generated'] = gmdate('c');
            $tmp = $this->dir().'/.manifest.'.getmypid().'.tmp';
            file_put_contents($tmp, json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
            rename($tmp, $this->dir().'/manifest.json');
            if ($old && basename((string)$old['file']) !== $row['file']) @unlink($this->dir().'/agents/'.basename((string)$old['file']));
        } catch (\Throwable $e) {
            error_log('VetZimo agent build: '.$e->getMessage());
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    public function manifest(): array
    {
        $raw = @file_get_contents($this->dir().'/manifest.json');
        $files = is_string($raw) ? (json_decode($raw, true)['files'] ?? []) : [];
        return is_array($files) ? $files : [];
    }

    /** Herkese açık katalog (ajanlar dahil değil): satış sayfası ve uygulama içi güncelleme için. */
    public function publicCatalog(): array
    {
        $out = [];
        foreach ($this->manifest() as $key => $f) {
            if ((self::APPS[$key][2] ?? '') !== 'public') continue;
            $out[$key] = ['platform' => self::APPS[$key][1], 'version' => (string)($f['version'] ?? ''), 'size' => (int)($f['size'] ?? 0),
                'sha256' => (string)($f['sha256'] ?? ''), 'date' => (string)($f['date'] ?? ''), 'url' => '/download/'.$key];
        }
        return $out;
    }

    /** Ücretli bayi: bugün geçerli, deneme olmayan (ödenmiş ya da yönetici ataması) bir dönem. */
    public function paid(string $partner): bool
    {
        if ($partner === '') return false;
        $day = (new \DateTimeImmutable('now', new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $q = $this->db->prepare("SELECT 1 FROM clinic_subscription WHERE partner_id=? AND starts_on<=? AND ends_on>=? AND kind IN ('paid','assigned') LIMIT 1");
        $q->execute([$partner, $day, $day]);
        return (bool)$q->fetchColumn();
    }

    /** Ajanları görebilen: ücretli bayinin yöneticisi veya şube yöneticisi. */
    public function agentAccess(?array $actor): bool
    {
        return $actor && in_array($actor['role'] ?? '', ['dealer', 'branch'], true) && $this->paid((string)($actor['partner_id'] ?? ''));
    }

    /** Klinik paneli: ajan indirmeleri (yalnız ücretli bayi). Demo/deneme hesabına bağlantı ya da ayrıntı verilmez. */
    public function agents(?array $actor): array
    {
        $paid = $actor && $this->paid((string)($actor['partner_id'] ?? ''));
        if (!$paid) return ['paid' => false, 'manager' => false, 'items' => []];
        if (!$this->agentAccess($actor)) return ['paid' => true, 'manager' => false, 'items' => []];
        $m = $this->manifest();
        $items = [];
        foreach (['agent', 'phone'] as $key) {
            if (!isset($m[$key])) continue;
            $items[] = ['key' => $key, 'name' => self::APPS[$key][0], 'version' => (string)($m[$key]['version'] ?? ''), 'size' => (int)($m[$key]['size'] ?? 0),
                'sha256' => (string)($m[$key]['sha256'] ?? ''), 'url' => '/download/'.$key.'?src=panel'];
        }
        return ['paid' => true, 'manager' => true, 'items' => $items];
    }

    public static function client(string $ua): string
    {
        return match (true) {
            (bool)preg_match('~Android~i', $ua) => 'android',
            (bool)preg_match('~iPhone|iPad|iPod~i', $ua) => 'ios',
            (bool)preg_match('~Windows~i', $ua) => 'windows',
            (bool)preg_match('~Macintosh|Mac OS X~i', $ua) => 'macos',
            (bool)preg_match('~Linux|X11|CrOS~i', $ua) => 'linux',
            default => 'other',
        };
    }

    /** Bir indirmeyi say. Botlar ve bağlantı önizlemeleri sayılmaz; aynı kişi aynı gün aynı dosyayı yeniden indirirse yalnız toplam artar. */
    public function count(string $app, string $source, string $ip, string $ua, int $now): bool
    {
        if ($app !== self::PAGE && !isset(self::APPS[$app])) return false;
        if ($ua === '' || preg_match(self::BOTS, $ua)) return false;
        $source = in_array($source, self::SOURCES, true) ? $source : 'web';
        $day = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
        $hash = hash_hmac('sha256', $day.'|'.$app.'|'.$ip.'|'.$ua, $this->secret.'|downloads', true);
        $seen = $this->db->prepare('INSERT IGNORE INTO app_download_seen(hash,day) VALUES (?,?)');
        $seen->execute([$hash, $day]);
        $unique = $seen->rowCount() === 1 ? 1 : 0;
        $this->db->prepare('INSERT INTO app_download_stat(day,app,source,client,total,uniq) VALUES (?,?,?,?,1,?)
            ON DUPLICATE KEY UPDATE total=total+1,uniq=uniq+VALUES(uniq)')->execute([$day, $app, $source, self::client($ua), $unique]);
        if (random_int(1, 200) === 1) $this->db->prepare('DELETE FROM app_download_seen WHERE day<?')->execute([date('Y-m-d', $now - 2 * 86400)]);
        return true;
    }

    /** Dosyayı sun: erişim, sayaç, Range (devam eden indirme ikinci kez sayılmaz), HEAD. */
    public function serve(string $app, array $server, ?array $actor, int $now): never
    {
        $meta = self::APPS[$app] ?? null;
        $file = $this->manifest()[$app] ?? null;
        if (!$meta || !$file) throw new RuntimeException('İndirme bulunamadı.', 404);
        if ($meta[2] === 'paid' && !$this->agentAccess($actor)) throw new RuntimeException('Bu dosya yalnız ücretli bayi hesaplarına açıktır.', 403);
        $name = basename((string)$file['file']);
        $path = $this->dir().($meta[2] === 'paid' ? '/agents/' : '/').$name;
        if (!is_file($path)) throw new RuntimeException('Dosya şu anda hazırlanıyor. Lütfen daha sonra deneyin.', 404);
        $size = filesize($path);
        $start = 0; $end = $size - 1; $partial = false;
        $range = (string)($server['HTTP_RANGE'] ?? '');
        if ($range !== '') {
            if (!preg_match('~\Abytes=(\d*)-(\d*)\z~', $range, $m) || ($m[1] === '' && $m[2] === '')) $this->unsatisfiable($size);
            if ($m[1] === '') { $start = max(0, $size - (int)$m[2]); }
            else { $start = (int)$m[1]; if ($m[2] !== '') $end = min($end, (int)$m[2]); }
            if ($start > $end || $start >= $size) $this->unsatisfiable($size);
            $partial = true;
        }
        $method = (string)($server['REQUEST_METHOD'] ?? 'GET');
        $source = is_string($_GET['src'] ?? null) ? $_GET['src'] : 'web';
        if ($method === 'GET' && $start === 0) {
            try { $this->count($app, $source, (string)($server['REMOTE_ADDR'] ?? ''), (string)($server['HTTP_USER_AGENT'] ?? ''), $now); }
            catch (\Throwable $e) { error_log('VetZimo download count: '.get_class($e)); }
        }
        $type = match (strtolower(pathinfo($name, PATHINFO_EXTENSION))) {
            'apk' => 'application/vnd.android.package-archive',
            'dmg' => 'application/x-apple-diskimage',
            'mobileconfig' => 'application/x-apple-aspen-config',
            'zip' => 'application/zip',
            'sh', 'py' => 'text/plain; charset=utf-8',
            default => 'application/octet-stream',
        };
        while (ob_get_level()) ob_end_clean();
        header_remove('Content-Security-Policy');
        header('Content-Type: '.$type);
        header('X-Content-Type-Options: nosniff');
        header('Accept-Ranges: bytes');
        header('Cache-Control: '.($meta[2] === 'paid' ? 'private, no-store' : 'public, max-age=300'));
        header('ETag: "'.substr((string)($file['sha256'] ?? md5($name.$size)), 0, 32).'"');
        header('Content-Disposition: '.(str_ends_with($name, '.mobileconfig') ? 'inline' : 'attachment').'; filename="'.$name.'"');
        if ($partial) { http_response_code(206); header("Content-Range: bytes $start-$end/$size"); }
        header('Content-Length: '.($end - $start + 1));
        if ($method === 'HEAD') exit;
        set_time_limit(0);
        $fh = fopen($path, 'rb');
        fseek($fh, $start);
        $left = $end - $start + 1;
        while ($left > 0 && !feof($fh) && !connection_aborted()) {
            $chunk = fread($fh, (int)min(1048576, $left));
            if ($chunk === false) break;
            echo $chunk; flush();
            $left -= strlen($chunk);
        }
        fclose($fh);
        exit;
    }

    private function unsatisfiable(int $size): never
    {
        http_response_code(416);
        header("Content-Range: bytes */$size");
        exit;
    }

    /** Merkez paneli: uygulama bazlı indirme sayıları (tüm zamanlar, son N gün, kaynak ve cihaz dağılımı, günlük seri). */
    public function stats(int $days = 30, ?int $now = null): array
    {
        $days = max(7, min(365, $days));
        $tz = new \DateTimeZone('Europe/Istanbul');
        $today = (new \DateTimeImmutable('@'.($now ?? time())))->setTimezone($tz);
        $from = $today->modify('-'.($days - 1).' days')->format('Y-m-d');
        $apps = [];
        foreach ([self::PAGE => ['İndirme sayfası (QR ile açılış)', 'web', 'public']] + self::APPS as $key => [$label, $platform, $access]) {
            $apps[$key] = ['key' => $key, 'label' => $label, 'platform' => $platform, 'access' => $access, 'total' => 0, 'unique' => 0,
                'period' => 0, 'periodUnique' => 0, 'qr' => 0, 'web' => 0, 'panel' => 0, 'last' => null];
        }
        foreach ($this->db->query('SELECT app,SUM(total) t,SUM(uniq) u,MAX(day) last FROM app_download_stat GROUP BY app') as $r) {
            if (!isset($apps[$r['app']])) continue;
            $apps[$r['app']]['total'] = (int)$r['t']; $apps[$r['app']]['unique'] = (int)$r['u']; $apps[$r['app']]['last'] = $r['last'];
        }
        $q = $this->db->prepare('SELECT app,source,client,day,SUM(total) t,SUM(uniq) u FROM app_download_stat WHERE day>=? GROUP BY app,source,client,day');
        $q->execute([$from]);
        $series = []; $clients = array_fill_keys(self::CLIENTS, 0);
        for ($i = 0; $i < $days; $i++) $series[$today->modify('-'.($days - 1 - $i).' days')->format('Y-m-d')] = 0;
        foreach ($q as $r) {
            if (!isset($apps[$r['app']])) continue;
            $a = &$apps[$r['app']];
            $a['period'] += (int)$r['t']; $a['periodUnique'] += (int)$r['u'];
            if (isset($a[$r['source']])) $a[$r['source']] += (int)$r['t'];
            unset($a);
            if ($r['app'] !== self::PAGE) {
                if (isset($series[$r['day']])) $series[$r['day']] += (int)$r['t'];
                $clients[$r['client']] = ($clients[$r['client']] ?? 0) + (int)$r['t'];
            }
        }
        $totals = ['total' => 0, 'unique' => 0, 'period' => 0, 'qr' => 0];
        foreach ($apps as $k => $a) if ($k !== self::PAGE) { $totals['total'] += $a['total']; $totals['unique'] += $a['unique']; $totals['period'] += $a['period']; $totals['qr'] += $a['qr']; }
        $m = $this->manifest();
        foreach ($apps as $k => &$a) { $a['version'] = (string)($m[$k]['version'] ?? ''); $a['available'] = $k === self::PAGE || isset($m[$k]); }
        unset($a);
        return ['days' => $days, 'from' => $from, 'apps' => array_values($apps), 'series' => array_map(null, array_keys($series), array_values($series)),
            'clients' => $clients, 'totals' => $totals];
    }
}
