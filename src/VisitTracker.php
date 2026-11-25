<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Evde hizmet canlı rota: personel "Yola çık"a dokununca konumu yalnız bu ziyaret süresince paylaşılır.
 * Hasta sahibine "X kliniğinden Y yola çıktı, tahmini varış ~N dk" bildirimi gider; araç yaklaşınca (≈800 m ya da
 * 5 dk) ikinci bildirim gider. Hizmet tamamlanınca personel isterse kliniğin Google yorum bağlantısını gönderir.
 * Tahmini süre ücretsizdir: personelin telefonu adrese OpenStreetMap yol ağı üzerinden en hızlı rotayı hesaplar ve kalan
 * gerçek yol mesafesi/süresini gönderir (tüm Türkiye). Yol verisi alınamazsa kuş uçuşu × yol katsayısı ve ölçülen hız kullanılır.
 * Hasta sahibi personelin tam konumunu değil, yalnız kalan süre ve mesafeyi görür.
 */
final class VisitTracker
{
    private const APPROACH_M = 800;
    private const APPROACH_S = 300;
    private const ROAD = 1.35;          // kuş uçuşundan yol mesafesine ortalama katsayı
    private const CITY_KMH = 28.0;      // ölçülen hız yoksa şehir içi ortalama

    public function __construct(private readonly PDO $db, private readonly HomeVisit $visits, private readonly string $origin = '') {}

    private function q(string $sql, array $args = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($args);
        return $q;
    }

    public static function distance(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $r = 6371000.0; $p1 = deg2rad($lat1); $p2 = deg2rad($lat2); $dp = deg2rad($lat2 - $lat1); $dl = deg2rad($lon2 - $lon1);
        $a = sin($dp / 2) ** 2 + cos($p1) * cos($p2) * sin($dl / 2) ** 2;
        return 2 * $r * asin(min(1, sqrt($a)));
    }

    /** @return array{0:int,1:int} [yol mesafesi m, süre sn] */
    public static function eta(float $straight, ?float $speed, mixed $roadMeters = null, mixed $roadSeconds = null): array
    {
        // Telefonda yol ağı üzerinden ölçülen kalan mesafe ve süre (makul aralıktaysa) kullanılır.
        if (is_numeric($roadMeters) && is_numeric($roadSeconds) && $roadMeters >= 0 && $roadSeconds >= 0
            && $roadMeters >= $straight * 0.9 - 300 && $roadMeters <= $straight * 6 + 3000 && $roadSeconds <= 86400) {
            return [(int)round((float)$roadMeters), (int)round((float)$roadSeconds) + ($roadMeters > 300 ? 60 : 0)];
        }
        $road = $straight * self::ROAD;
        $kmh = $speed !== null && $speed > 2.5 ? max(15.0, min(70.0, $speed * 3.6)) : self::CITY_KMH;
        return [(int)round($road), (int)round($road / ($kmh / 3.6)) + ($road > 300 ? 60 : 0)];
    }

    private static function coord(mixed $v, float $min, float $max): float
    {
        if (!is_numeric($v) || (float)$v < $min || (float)$v > $max) throw new RuntimeException('Konum geçersiz.', 422);
        return round((float)$v, 6);
    }

    /** Ziyaret ve hedef koordinat; personelin bu ziyarete atanmış olması gerekir. */
    private function visit(array $actor, string $id): array
    {
        $row = $this->visits->find($actor, $id, false);
        $settings = $this->visits->settings($actor['partner_id']);
        if (!$this->visits->staffAllowed($actor, $settings, true)) throw new RuntimeException('Evde hizmet yetkiniz yok.', 403);
        $snap = $this->visits->decode($row['snapshot']);
        return [$row, $snap];
    }

    private function clinicName(string $partner): string
    {
        return (string)$this->q('SELECT name FROM partner_account WHERE id=?', [$partner])->fetchColumn();
    }

    /** Hasta sahibine kanal sırası: uygulama bildirimi (hesap varsa) ve kliniğin kendi hattından SMS/WhatsApp. */
    private function tell(array $row, array $snap, string $title, string $body, string $smsText, string $key, int $now): array
    {
        $sent = [];
        if ($row['customer_id'] !== '') {
            $m = $this->q("SELECT id,account_id FROM identity_membership WHERE partner_id=? AND customer_id=? AND role='customer' AND status='active'", [$row['partner_id'], $row['customer_id']])->fetchAll();
            $hub = new AppHub($this->db);
            foreach ($m as $x) if ($hub->notify($x['account_id'], $x['id'], 'customer', 'homeVisits', $title, $body, '/hasta-sahibi?bildirim=visit&talep='.$row['id'], 'visit-track:'.$key, $now)) $sent['app'] = true;
        }
        $phone = (string)($snap['phone'] ?? '');
        if ($phone !== '') {
            $gw = new PhoneGateway($this->db);
            foreach (['sms', 'whatsapp'] as $ch) {
                if (!$gw->route($row['partner_id'], $ch)) continue;
                try { $gw->enqueue($row['partner_id'], $ch, $phone, $smsText, 'reminder', 'visit-track:'.$key.':'.$ch, 1, $now, $now + 3600, 'Evde hizmet'); $sent[$ch] = true; } catch (\Throwable) {}
                break; // tek kanal yeterli (SMS öncelikli)
            }
        }
        return $sent;
    }

    private function publicLink(string $token): string
    {
        return (rtrim($this->origin, '/') ?: 'https://vetzimo.com').'/evde-hizmet/canli/'.$token;
    }

    public function start(array $actor, string $id, object $b, int $now): array
    {
        [$row, $snap] = $this->visit($actor, $id);
        if (!in_array($row['status'], ['assigned', 'departed'], true)) throw new RuntimeException('Yola çıkmak için ziyaretin personel atanmış durumda olması gerekir.', 409);
        $lat = self::coord($b->lat ?? null, 35.5, 42.5); $lon = self::coord($b->lng ?? null, 25.0, 45.5);
        $speed = is_numeric($b->speed ?? null) ? (float)$b->speed : null;
        if ($row['status'] === 'assigned') $this->visits->change(['id' => $row['id'], 'partner_id' => $row['partner_id']], $actor, ['action' => 'depart', 'revision' => $row['revision']], false);
        $to = $snap['location'] ?? [];
        $straight = isset($to['latitude'], $to['longitude']) ? self::distance($lat, $lon, (float)$to['latitude'], (float)$to['longitude']) : null;
        [$road, $eta] = $straight !== null ? self::eta($straight, $speed, $b->roadMeters ?? null, $b->roadSeconds ?? null) : [null, null];
        $token = bin2hex(random_bytes(16));
        $this->q('INSERT INTO clinic_visit_track(visit_id,partner_id,staff_account,staff_name,lat,lng,accuracy,speed,distance_m,eta_s,started_at,updated_at,public_hash,active)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE staff_account=VALUES(staff_account),staff_name=VALUES(staff_name),lat=VALUES(lat),lng=VALUES(lng),accuracy=VALUES(accuracy),
            speed=VALUES(speed),distance_m=VALUES(distance_m),eta_s=VALUES(eta_s),updated_at=VALUES(updated_at),active=1',
            [$row['id'], $row['partner_id'], $actor['account_id'], mb_substr((string)$actor['name'], 0, 80), $lat, $lon, (int)($b->accuracy ?? 0), $speed, $road, $eta, $now, $now, hash('sha256', $token)]);
        $track = $this->q('SELECT * FROM clinic_visit_track WHERE visit_id=?', [$row['id']])->fetch();
        if (!(int)$track['depart_notified']) {
            if ($track['public_hash'] !== hash('sha256', $token)) { $this->q('UPDATE clinic_visit_track SET public_hash=? WHERE visit_id=?', [hash('sha256', $token), $row['id']]); }
            $clinic = $this->clinicName($row['partner_id']);
            $staff = explode(' ', trim((string)$actor['name']))[0] ?: 'Ekibimiz';
            $mins = $eta !== null ? max(1, (int)round($eta / 60)) : null;
            $at = $eta !== null ? (new \DateTimeImmutable('@'.($now + $eta)))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('H:i') : null;
            $title = $staff.' yola çıktı';
            $body = $clinic.($mins ? ' · Tahmini varış ~'.$mins.' dk ('.$at.')' : ' · Adresinize doğru yolda');
            $sms = $clinic.': '.($snap['animal'] ?? 'Hastanız').' için '.$staff.' yola çıktı.'.($mins ? ' Tahmini varış '.$at.' (~'.$mins.' dk).' : '').' Canlı takip: '.$this->publicLink($token);
            $this->tell($row, $snap, $title, $body, $sms, $row['id'].':depart', $now);
            $this->q('UPDATE clinic_visit_track SET depart_notified=1 WHERE visit_id=?', [$row['id']]);
        }
        return $this->state($row['id'], true);
    }

    public function update(array $actor, string $id, object $b, int $now): array
    {
        [$row, $snap] = $this->visit($actor, $id);
        $track = $this->q('SELECT * FROM clinic_visit_track WHERE visit_id=? AND active=1', [$row['id']])->fetch();
        if (!$track) throw new RuntimeException('Canlı rota başlatılmadı.', 409);
        if ($now - (int)$track['updated_at'] < 3) return $this->state($row['id'], true); // en sık 3 sn'de bir
        $lat = self::coord($b->lat ?? null, 35.5, 42.5); $lon = self::coord($b->lng ?? null, 25.0, 45.5);
        $speed = is_numeric($b->speed ?? null) ? (float)$b->speed : null;
        $to = $snap['location'] ?? [];
        $straight = isset($to['latitude'], $to['longitude']) ? self::distance($lat, $lon, (float)$to['latitude'], (float)$to['longitude']) : null;
        [$road, $eta] = $straight !== null ? self::eta($straight, $speed, $b->roadMeters ?? null, $b->roadSeconds ?? null) : [null, null];
        $this->q('UPDATE clinic_visit_track SET lat=?,lng=?,accuracy=?,speed=?,distance_m=?,eta_s=?,updated_at=? WHERE visit_id=?', [$lat, $lon, (int)($b->accuracy ?? 0), $speed, $road, $eta, $now, $row['id']]);
        if (!(int)$track['approach_notified'] && $road !== null && ($road <= self::APPROACH_M || $eta <= self::APPROACH_S)) {
            $clinic = $this->clinicName($row['partner_id']);
            $staff = explode(' ', trim((string)$track['staff_name']))[0] ?: 'Ekibimiz';
            $mins = max(1, (int)round($eta / 60));
            $this->tell($row, $snap, $staff.' yaklaştı', $clinic.' · Yaklaşık '.$mins.' dk içinde adresinizde', $clinic.': '.$staff.' adresinize yaklaştı, yaklaşık '.$mins.' dk içinde orada. Lütfen hazırlanın.', $row['id'].':approach', $now);
            $this->q('UPDATE clinic_visit_track SET approach_notified=1 WHERE visit_id=?', [$row['id']]);
        }
        return $this->state($row['id'], true);
    }

    public function arrive(array $actor, string $id, int $now): array
    {
        [$row] = $this->visit($actor, $id);
        if ($row['status'] === 'departed') $this->visits->change(['id' => $row['id'], 'partner_id' => $row['partner_id']], $actor, ['action' => 'arrive', 'revision' => $row['revision']], false);
        $this->q('UPDATE clinic_visit_track SET active=0,distance_m=0,eta_s=0,updated_at=?,lat=NULL,lng=NULL WHERE visit_id=?', [$now, $row['id']]);
        return $this->state($row['id'], true);
    }

    public function stop(array $actor, string $id, int $now): array
    {
        [$row] = $this->visit($actor, $id);
        $this->q('UPDATE clinic_visit_track SET active=0,lat=NULL,lng=NULL,updated_at=? WHERE visit_id=?', [$now, $row['id']]);
        return $this->state($row['id'], true);
    }

    /** Hizmet sonrası değerlendirme isteği (personel isterse; ziyaret başına bir kez). */
    public function askReview(array $actor, string $id, int $now): array
    {
        [$row, $snap] = $this->visit($actor, $id);
        if (!in_array($row['status'], ['started', 'completed', 'closed'], true)) throw new RuntimeException('Değerlendirme isteği hizmet tamamlanınca gönderilir.', 409);
        $review = (new ReviewLink($this->db))->get($row['partner_id']);
        if ($review['url'] === '') throw new RuntimeException('Önce Ayarlar › Klinik › Google yorum bağlantısını ekleyin.', 422);
        $track = $this->q('SELECT review_sent FROM clinic_visit_track WHERE visit_id=?', [$row['id']])->fetch();
        if ($track && (int)$track['review_sent']) throw new RuntimeException('Değerlendirme isteği bu ziyaret için zaten gönderildi.', 409);
        $clinic = $this->clinicName($row['partner_id']);
        $text = strtr($review['message'], ['{klinik}' => $clinic, '{hasta}' => (string)($snap['animal'] ?? ''), '{sahip}' => (string)($snap['name'] ?? '')]);
        $sent = $this->tell($row, $snap, $clinic.' · Değerlendirmeniz bizim için değerli', $text, $text.' '.$review['url'], $row['id'].':review', $now);
        if (!$sent) throw new RuntimeException('Hasta sahibine ulaşılacak kanal yok (uygulama hesabı veya telefon hattı bağlantısı gerekli).', 422);
        $this->q('INSERT INTO clinic_visit_track(visit_id,partner_id,staff_account,staff_name,started_at,updated_at,public_hash,active,review_sent) VALUES (?,?,?,?,?,?,?,0,1)
            ON DUPLICATE KEY UPDATE review_sent=1', [$row['id'], $row['partner_id'], $actor['account_id'], mb_substr((string)$actor['name'], 0, 80), $now, $now, hash('sha256', random_bytes(16))]);
        return ['sent' => array_keys($sent)] + $this->state($row['id'], true);
    }

    public function staffVisit(array $actor, string $id): string
    {
        return $this->visit($actor, $id)[0]['id'];
    }

    public static function publicPage(?array $s): string
    {
        $e = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
        $body = $s ? '<p class="k">'.$e($s['clinic']).'</p><h1 data-title>'.$e($s['active'] ? $s['staff'].' yolda' : $s['statusLabel']).'</h1><div class="eta"><strong data-eta>'.
            ($s['active'] && $s['eta'] !== null ? '~'.max(1, (int)round($s['eta'] / 60)).' dk' : '—').'</strong><span data-distance>'.($s['active'] && $s['distance'] !== null ? number_format($s['distance'] / 1000, 1, ',', '').' km' : '').'</span></div>'.
            '<div class="road"><i></i></div><canvas class="map" data-map role="img" aria-label="Ekibin adresinize yol üzerindeki konumu" hidden></canvas><p class="m" data-updated>Sayfa kendiliğinden yenilenir.</p><p class="m osm">Harita verisi © OpenStreetMap katkıda bulunanlar</p>'
            : '<h1>Takip bağlantısının süresi doldu</h1><p class="m">Ziyaret tamamlanmış ya da bağlantı geçersiz olabilir. Sorularınız için kliniğinizi arayın.</p>';
        return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Canlı takip · VetZimo</title>'.
            '<style>:root{--a:#6a3df0;--b:#c4306e;--bg:#f6f3ff;--fg:#1b1640;--m:#5e5880;--card:#fff}@media(prefers-color-scheme:dark){:root{--bg:#120d24;--fg:#efeaff;--m:#b5addb;--card:#1d1638}}'.
            'body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,color-mix(in srgb,var(--a) 22%,transparent),transparent 50%),var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}'.
            'main{width:min(440px,calc(100% - 32px));background:var(--card);border-radius:24px;padding:28px;box-shadow:0 30px 60px rgba(40,20,110,.18);text-align:center}.k{margin:0;color:var(--m);font-weight:600}h1{margin:.3em 0;font-size:1.6rem}'.
            '.eta{display:grid;gap:2px;margin:18px 0}.eta strong{font-size:3rem;background:linear-gradient(110deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}.eta span,.m{color:var(--m)}'.
            '.road{height:10px;border-radius:999px;background:color-mix(in srgb,var(--a) 14%,transparent);overflow:hidden}.road i{display:block;height:100%;width:35%;border-radius:inherit;background:linear-gradient(90deg,var(--a),var(--b));animation:r 1.8s ease-in-out infinite}'.
            '.map{display:block;width:100%;height:260px;margin-top:14px;border-radius:16px}.osm{font-size:.75rem}@keyframes r{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}@media(prefers-reduced-motion:reduce){.road i{animation:none;width:100%}}</style></head>'.
            '<body><main>'.$body.'</main>'.($s ? '<script src="/visit-live-map.js?v=1" defer></script><script src="/visit-live-public.js?v=2" defer></script>' : '').'</body></html>';
    }

    /** Personel ekranı (tam konum) ya da hasta sahibi (yalnız süre ve mesafe). */
    public function state(string $visit, bool $staff): array
    {
        $t = $this->q('SELECT * FROM clinic_visit_track WHERE visit_id=?', [$visit])->fetch();
        if (!$t) return ['active' => false];
        $out = ['active' => (bool)$t['active'], 'staff' => explode(' ', trim((string)$t['staff_name']))[0], 'distance' => $t['distance_m'] !== null ? (int)$t['distance_m'] : null,
            'eta' => $t['eta_s'] !== null ? (int)$t['eta_s'] : null, 'updatedAt' => (int)$t['updated_at'], 'approaching' => (bool)$t['approach_notified'], 'reviewSent' => (bool)$t['review_sent']];
        if ($staff) $out += ['lat' => $t['lat'] !== null ? (float)$t['lat'] : null, 'lng' => $t['lng'] !== null ? (float)$t['lng'] : null];
        // Harita: aktif ziyarette aracın konumu (yaklaşık 10 m) ve adres noktası; yol haritası tarayıcıda OpenStreetMap verisiyle çizilir.
        if ($t['active'] && $t['lat'] !== null) {
            $dest = $this->visits->decode((string)$this->q('SELECT snapshot FROM clinic_visit_request WHERE id=?', [$visit])->fetchColumn())['location'] ?? [];
            $out['pos'] = ['lat' => round((float)$t['lat'], 4), 'lon' => round((float)$t['lng'], 4)];
            if (is_numeric($dest['latitude'] ?? null) && is_numeric($dest['longitude'] ?? null)) $out['dest'] = ['lat' => (float)$dest['latitude'], 'lon' => (float)$dest['longitude']];
        }
        return $out;
    }

    /** Klinik canlı izleme: şu an yolda olan tüm personel (yalnız evde hizmet yetkili ekip). */
    public function activeTracks(array $actor, int $now): array
    {
        if (!$this->visits->staffAllowed($actor, $this->visits->settings($actor['partner_id']), true)) throw new RuntimeException('Evde hizmet yetkiniz yok.', 403);
        $rows = $this->q("SELECT t.*,r.snapshot,r.status FROM clinic_visit_track t JOIN clinic_visit_request r ON r.id=t.visit_id WHERE t.partner_id=? AND t.active=1 AND t.updated_at>? AND t.lat IS NOT NULL ORDER BY t.updated_at DESC LIMIT 30",
            [$actor['partner_id'], $now - 7200])->fetchAll();
        $out = [];
        foreach ($rows as $t) {
            $snap = $this->visits->decode((string)$t['snapshot']); $loc = $snap['location'] ?? [];
            $out[] = ['visit' => $t['visit_id'], 'staff' => (string)$t['staff_name'], 'animal' => (string)($snap['animal'] ?? ''), 'area' => trim(($loc['district'] ?? '').' / '.($loc['neighborhood'] ?? ''), ' /'),
                'pos' => ['lat' => (float)$t['lat'], 'lon' => (float)$t['lng']], 'dest' => is_numeric($loc['latitude'] ?? null) && is_numeric($loc['longitude'] ?? null) ? ['lat' => (float)$loc['latitude'], 'lon' => (float)$loc['longitude']] : null,
                'eta' => $t['eta_s'] !== null ? (int)$t['eta_s'] : null, 'distance' => $t['distance_m'] !== null ? (int)$t['distance_m'] : null, 'updatedAt' => (int)$t['updated_at'], 'approaching' => (bool)$t['approach_notified']];
        }
        return ['tracks' => $out];
    }

    public function ownerState(array $actor, string $id): array
    {
        $row = $this->visits->find($actor, $id, true);
        return $this->state($row['id'], false) + ['status' => $row['status'], 'statusLabel' => HomeVisit::STATUS[$row['status']] ?? $row['status']];
    }

    /** Herkese açık takip sayfası (SMS'teki bağlantı): yalnız klinik adı, personelin adı, kalan süre. */
    public function publicState(string $token): ?array
    {
        if (!preg_match('/\A[a-f0-9]{32}\z/', $token)) return null;
        $t = $this->q('SELECT t.visit_id,t.partner_id,r.status FROM clinic_visit_track t JOIN clinic_visit_request r ON r.id=t.visit_id WHERE t.public_hash=? AND t.started_at>?', [hash('sha256', $token), time() - 86400])->fetch();
        if (!$t) return null;
        return $this->state($t['visit_id'], false) + ['clinic' => $this->clinicName($t['partner_id']), 'status' => $t['status'], 'statusLabel' => HomeVisit::STATUS[$t['status']] ?? ''];
    }
}
