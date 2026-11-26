<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Klinik Rehberi: uygulama içi eğitim içerikleri (yazı, ekran görüntüsü, kısa video).
 * Yalnız ücretli ve bugün geçerli aboneliği olan bayilerin ekibine açılır; demo/deneme, Ücretsiz paket,
 * satış sitesi ve oturumsuz istekler içerik ya da medya alamaz. İçerik web kökünün dışında (guide/) durur.
 */
final class ClinicGuide
{
    private const ROLES = ['dealer', 'branch', 'staff'];
    private const MEDIA = '/^[a-z0-9][a-z0-9-]{0,60}\.(webp|mp4|jpg|png)$/';

    public function __construct(private PDO $db, private string $dir) {}

    /** Ücretli aktif bayi: bugün geçerli, deneme olmayan (ödenmiş ya da atanmış) ve ücretsiz olmayan pakette bir dönem. */
    public function eligible(string $partner): bool
    {
        if ($partner === '') return false;
        try {
            $day = (new \DateTimeImmutable('now', new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
            $q = $this->db->prepare("SELECT plan_id FROM clinic_subscription WHERE partner_id=? AND starts_on<=? AND ends_on>=? AND kind IN ('paid','assigned')");
            $q->execute([$partner, $day, $day]);
            $plans = $q->fetchAll(PDO::FETCH_COLUMN);
        } catch (\Throwable) { return false; }
        if (!$plans) return false;
        $catalog = (new Commerce($this->db))->catalog();
        foreach ($plans as $plan) {
            if ($plan === 'ucretsiz') continue;
            $p = $catalog[$plan] ?? null;
            if (!$p) return true;
            if (($p['monthly'] ?? null) === 0 && ($p['yearly'] ?? null) === 0) continue;
            return true;
        }
        return false;
    }

    public function allowed(?array $actor): bool
    {
        return $actor && in_array($actor['role'] ?? '', self::ROLES, true) && empty($actor['preview']) && $this->eligible((string)($actor['partner_id'] ?? ''));
    }

    /** @return array{topics: list<array<string,mixed>>, updated: string} */
    public function topics(?array $actor): array
    {
        if (!$this->allowed($actor)) throw new RuntimeException('Klinik Rehberi yalnız ücretli paket kullanan kliniklere açıktır.', 403);
        $file = $this->dir.'/guides.json';
        $data = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
        if (!is_array($data) || !is_array($data['topics'] ?? null)) throw new RuntimeException('Rehber içeriği bulunamadı.', 404);
        return ['topics' => $data['topics'], 'updated' => (string)($data['updated'] ?? '')];
    }

    /** Medyayı yalnız yetkili oturuma, özel önbellekle ve bayt aralığı (video) desteğiyle gönderir. */
    public function media(?array $actor, string $name): never
    {
        if (!$this->allowed($actor)) throw new RuntimeException('Bu içerik yalnız ücretli paketlerde görüntülenir.', 403);
        if (!preg_match(self::MEDIA, $name)) throw new RuntimeException('Dosya bulunamadı.', 404);
        $path = $this->dir.'/media/'.$name;
        if (!is_file($path)) throw new RuntimeException('Dosya bulunamadı.', 404);
        $type = ['webp' => 'image/webp', 'mp4' => 'video/mp4', 'jpg' => 'image/jpeg', 'png' => 'image/png'][pathinfo($name, PATHINFO_EXTENSION)];
        $size = (int)filesize($path);
        $etag = '"'.substr(hash('sha256', $name.$size.filemtime($path)), 0, 24).'"';
        header('Content-Type: '.$type);
        header('Cache-Control: private, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('Accept-Ranges: bytes');
        header('ETag: '.$etag);
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
        $start = 0; $end = $size - 1;
        $range = (string)($_SERVER['HTTP_RANGE'] ?? '');
        if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $range, $m)) {
            if ($m[1] === '' && $m[2] !== '') { $start = max(0, $size - (int)$m[2]); }
            else { $start = (int)$m[1]; if ($m[2] !== '') $end = min($end, (int)$m[2]); }
            if ($start > $end || $start >= $size) { http_response_code(416); header('Content-Range: bytes */'.$size); exit; }
            http_response_code(206);
            header('Content-Range: bytes '.$start.'-'.$end.'/'.$size);
        }
        header('Content-Length: '.($end - $start + 1));
        $h = fopen($path, 'rb');
        fseek($h, $start);
        $left = $end - $start + 1;
        while ($left > 0 && !feof($h)) { $chunk = fread($h, min(65536, $left)); if ($chunk === false) break; echo $chunk; $left -= strlen($chunk); }
        fclose($h);
        exit;
    }
}
