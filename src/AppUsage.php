<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Hasta sahiplerinin uygulama kullanımı: hangi kanaldan (Android, iOS, Mac, Windows uygulaması veya telefon/bilgisayar
 * tarayıcısıyla "hasta sahibi portalı") kaç kez giriş yaptığı, son girişi ve son kullanımı. Giriş ve oturum yenileme
 * anında tek satır güncellenir (dakikada en fazla bir kez); rapor bayi yöneticisine açıktır. Uygulamayı kullananlara
 * satış indirimi (bayi açar, yüzde girer) buradan okunur.
 */
final class AppUsage
{
    public const APP = ['android' => 'Android', 'ios' => 'iOS', 'macos' => 'Mac', 'windows' => 'Windows', 'linux' => 'Linux'];
    public const PORTAL = 'web';

    public function __construct(private readonly PDO $db) {}

    public static function ensure(PDO $db): void
    {
        $db->exec('CREATE TABLE IF NOT EXISTS identity_access_stat (membership_id VARCHAR(80) NOT NULL, channel VARCHAR(12) NOT NULL,
            logins INT UNSIGNED NOT NULL DEFAULT 0, first_at INT UNSIGNED NOT NULL, last_login INT UNSIGNED NOT NULL DEFAULT 0,
            last_seen INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (membership_id, channel)) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin');
        $db->exec('CREATE TABLE IF NOT EXISTS clinic_app_discount (partner_id VARCHAR(80) NOT NULL PRIMARY KEY, enabled TINYINT NOT NULL DEFAULT 0,
            percent DECIMAL(5,2) NOT NULL DEFAULT 0, updated_at INT UNSIGNED NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin');
    }

    /** Tarayıcı kimliğinden kanal: mobil uygulama "VetZimoApp/… (Android|iOS)", masaüstü uygulaması Electron. */
    public static function channel(string $ua): string
    {
        if (str_contains($ua, 'VetZimoApp')) return str_contains($ua, 'iOS') ? 'ios' : 'android';
        if (str_contains($ua, 'Electron')) return str_contains($ua, 'Mac OS') ? 'macos' : (str_contains($ua, 'Windows') ? 'windows' : 'linux');
        return self::PORTAL;
    }

    /** Giriş ($login) veya oturum kullanımı kaydı. Hiçbir koşulda girişi veya isteği bozmaz. */
    public static function record(PDO $db, string $membership, string $ua, int $now, bool $login): void
    {
        if ($membership === '' || PHP_SAPI === 'cli' && !$login && $ua === '') return;
        $sql = 'INSERT INTO identity_access_stat(membership_id,channel,logins,first_at,last_login,last_seen) VALUES (?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE logins=logins+VALUES(logins), last_login=GREATEST(last_login,VALUES(last_login)), last_seen=GREATEST(last_seen,VALUES(last_seen))';
        $args = [$membership, self::channel($ua), $login ? 1 : 0, $now, $login ? $now : 0, $now];
        try {
            $db->prepare($sql)->execute($args);
        } catch (PDOException $e) {
            if ($e->getCode() !== '42S02') return;
            try { self::ensure($db); $db->prepare($sql)->execute($args); } catch (\Throwable) {}
        } catch (\Throwable) {}
    }

    /** @return array{enabled:bool,percent:float} */
    public function discount(string $partner): array
    {
        try {
            $q = $this->db->prepare('SELECT enabled, percent FROM clinic_app_discount WHERE partner_id=?');
            $q->execute([$partner]);
            $r = $q->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) { $r = false; }
        return ['enabled' => (bool)($r['enabled'] ?? false), 'percent' => (float)($r['percent'] ?? 0)];
    }

    public function saveDiscount(array $actor, object $body, int $now): array
    {
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.', 403);
        $percent = is_numeric($body->percent ?? null) ? round((float)$body->percent, 2) : -1;
        if ($percent < 0 || $percent > 100) throw new RuntimeException('İndirim yüzdesi 0 ile 100 arasında olmalı.', 422);
        $enabled = ($body->enabled ?? false) === true;
        if ($enabled && $percent <= 0) throw new RuntimeException('İndirimi açmak için 0\'dan büyük bir yüzde girin.', 422);
        self::ensure($this->db);
        $this->db->prepare('INSERT INTO clinic_app_discount(partner_id,enabled,percent,updated_at) VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), percent=VALUES(percent), updated_at=VALUES(updated_at)')
            ->execute([$actor['partner_id'], $enabled ? 1 : 0, $percent, $now]);
        return $this->discount((string)$actor['partner_id']);
    }

    /** Uygulamayı (iOS/Android/Mac/Windows) kullanan hasta sahiplerinin müşteri kimlikleri. */
    public function appClients(string $partner): array
    {
        $out = [];
        foreach ($this->rows($partner) as $r) if ($r['app']) $out[$r['client']] = true;
        return array_keys($out);
    }

    /** Bayi yöneticisi raporu: kullanan/kullanmayan, kanal kırılımı, son giriş, toplam giriş, portal ayrı. */
    public function report(array $actor, int $now): array
    {
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.', 403);
        $rows = $this->rows((string)$actor['partner_id']);
        $day30 = $now - 30 * 86400;
        $sum = ['accounts' => count($rows), 'app' => 0, 'portalOnly' => 0, 'never' => 0, 'active30' => 0, 'pending' => 0, 'channels' => array_fill_keys(array_keys(self::APP), 0),
            'portal' => ['users' => 0, 'logins' => 0, 'active30' => 0]];
        foreach ($rows as $r) {
            if ($r['status'] === 'pending') $sum['pending']++;
            if ($r['app']) $sum['app']++;
            elseif ($r['portal']) $sum['portalOnly']++;
            if (!$r['app'] && !$r['portal']) $sum['never']++;
            if ($r['lastSeen'] >= $day30) $sum['active30']++;
            foreach ($r['channels'] as $c => $info) if (isset($sum['channels'][$c])) $sum['channels'][$c]++;
            if ($r['portal']) {
                $sum['portal']['users']++;
                $sum['portal']['logins'] += $r['channels'][self::PORTAL]['logins'] ?? 0;
                if (($r['channels'][self::PORTAL]['lastSeen'] ?? 0) >= $day30) $sum['portal']['active30']++;
            }
        }
        usort($rows, static fn($a, $b) => [$b['app'], $b['lastSeen']] <=> [$a['app'], $a['lastSeen']]);
        return ['summary' => $sum, 'members' => $rows, 'discount' => $this->discount((string)$actor['partner_id']), 'labels' => self::APP + [self::PORTAL => 'Hasta sahibi portalı']];
    }

    /** @return list<array<string,mixed>> */
    private function rows(string $partner): array
    {
        $q = $this->db->prepare("SELECT m.id, m.name, m.status, m.customer_id, m.branch_id, a.identifier AS phone FROM identity_membership m
            JOIN identity_account a ON a.id=m.account_id WHERE m.partner_id=? AND m.role='customer' AND m.status<>'revoked'");
        $q->execute([$partner]);
        $members = [];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $m) $members[$m['id']] = $m + ['channels' => []];
        if (!$members) return [];
        try {
            $s = $this->db->prepare("SELECT s.membership_id, s.channel, s.logins, s.last_login, s.last_seen FROM identity_access_stat s
                JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id=? AND m.role='customer'");
            $s->execute([$partner]);
            foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (!isset($members[$r['membership_id']])) continue;
                $members[$r['membership_id']]['channels'][$r['channel']] = ['logins' => (int)$r['logins'], 'lastLogin' => (int)$r['last_login'], 'lastSeen' => (int)$r['last_seen']];
            }
        } catch (PDOException) {}
        // Önceden kurulmuş uygulamalar (istatistik başlamadan önce) cihaz kaydından tanınır.
        try {
            $d = $this->db->prepare("SELECT d.membership_id, d.platform, d.provider, MAX(d.seen_at) AS seen FROM app_device d
                JOIN identity_membership m ON m.id=d.membership_id WHERE m.partner_id=? AND m.role='customer' AND d.revoked_at IS NULL GROUP BY d.membership_id, d.platform, d.provider");
            $d->execute([$partner]);
            foreach ($d->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (!isset($members[$r['membership_id']])) continue;
                $c = isset(self::APP[$r['platform']]) && $r['provider'] !== 'webpush' ? $r['platform'] : self::PORTAL;
                $cur = $members[$r['membership_id']]['channels'][$c] ?? ['logins' => 0, 'lastLogin' => 0, 'lastSeen' => 0];
                $cur['lastSeen'] = max($cur['lastSeen'], (int)$r['seen']);
                $members[$r['membership_id']]['channels'][$c] = $cur;
            }
        } catch (PDOException) {}
        $out = [];
        foreach ($members as $m) {
            $ch = $m['channels'];
            $app = (bool)array_intersect_key($ch, self::APP);
            $out[] = ['id' => $m['id'], 'name' => $m['name'], 'phone' => $m['phone'], 'status' => $m['status'], 'client' => $m['customer_id'], 'branch' => $m['branch_id'],
                'channels' => $ch, 'app' => $app, 'portal' => isset($ch[self::PORTAL]),
                'logins' => array_sum(array_column($ch, 'logins')), 'lastLogin' => max([0, ...array_column($ch, 'lastLogin')]), 'lastSeen' => max([0, ...array_column($ch, 'lastSeen')])];
        }
        return $out;
    }
}
