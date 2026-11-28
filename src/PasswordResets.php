<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Şifremi unuttum istekleri ve durumları. Hasta sahibi (veya ekip üyesi) telefon numarasıyla istek yapar; bağlantı
 * kliniğin telefon hattından SMS ile gider. SMS gidemezse (hat bağlı değil, gönderilemedi, uzun süre sırada) klinik
 * paneline uyarı düşer ve ekip tek dokunuşla SMS'i yeniden gönderir veya bağlantıyı WhatsApp'tan paylaşır.
 * Durum: SMS sırada → SMS gönderildi / bağlantı paylaşıldı (şifre bekleniyor) → Şifre yenilendi.
 * Görünürlük: personel ve şube yöneticisi yalnız hasta sahibi isteklerini (kendi şubesi) görür; ekip hesaplarının
 * isteklerini yalnız bayi görür (personel başka bir personelin şifresini sıfırlayamaz).
 */
final class PasswordResets
{
    public const WINDOW = 86400;     // istek 24 saat açık kalır
    public const STUCK = 600;        // 10 dakikadır sırada bekleyen SMS "iletilemedi" sayılır
    public const LINK_TTL = 1800;    // bağlantı 30 dakika geçerli

    public function __construct(private readonly PDO $db) {}

    /** Tablolar (CREATE TABLE açık işlemi kapattığından yalnız işlem dışında, süreç başına bir kez çağrılır). */
    public static function ensure(PDO $db): void
    {
        static $done = [];
        if (isset($done[spl_object_id($db)])) return;
        $done[spl_object_id($db)] = true;
        IdentityApi::ensureReset($db);
        $db->exec('CREATE TABLE IF NOT EXISTS identity_reset_request (id CHAR(32) NOT NULL PRIMARY KEY, partner_id VARCHAR(80) NOT NULL,
            account_id VARCHAR(80) NOT NULL, membership_id VARCHAR(80) NOT NULL, role VARCHAR(12) NOT NULL, branch_id VARCHAR(80) NOT NULL DEFAULT \'\',
            client_id VARCHAR(80) NOT NULL DEFAULT \'\', name VARCHAR(120) NOT NULL DEFAULT \'\', phone VARCHAR(20) NOT NULL, created INT UNSIGNED NOT NULL,
            outbox_id BIGINT UNSIGNED NULL, action_at INT UNSIGNED NULL, manual_at INT UNSIGNED NULL, manual_by VARCHAR(120) NOT NULL DEFAULT \'\',
            done_at INT UNSIGNED NULL, KEY partner_time (partner_id,created), KEY account (account_id,created)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    /** Yeni tek kullanımlık bağlantı (öncekiler geçersiz olur). */
    public function token(string $account, int $now): string
    {
        $token = bin2hex(random_bytes(32));
        $this->db->prepare('UPDATE identity_password_reset SET used=1 WHERE account_id=?')->execute([$account]);
        $this->db->prepare('INSERT INTO identity_password_reset(token_hash,account_id,created,expires) VALUES (?,?,?,?)')
            ->execute([hash('sha256', $token), $account, $now, $now + self::LINK_TTL]);
        return $token;
    }

    public static function message(string $clinic, string $link): string
    {
        return trim($clinic.': VetZimo şifrenizi yenilemek için (30 dk geçerli): '.$link);
    }

    /**
     * "Şifremi unuttum": hesabın üyeliği olan her klinikte bir istek kaydı açılır; SMS, telefon hattı bağlı ilk klinikten gider.
     * @param list<array{partner_id:string,name:string,mid:string,role:string,branch_id:string,customer_id:?string,mname:string}> $rows
     */
    public function request(string $account, string $phone, array $rows, string $origin, int $now): void
    {
        $token = $this->token($account, $now);
        $link = rtrim($origin, '/').'/app#yenile/'.$token;
        $seen = [];
        $ids = [];
        foreach ($rows as $r) {
            if (isset($seen[$r['partner_id']])) continue;
            $seen[$r['partner_id']] = true;
            $id = bin2hex(random_bytes(16));
            $this->db->prepare('INSERT INTO identity_reset_request(id,partner_id,account_id,membership_id,role,branch_id,client_id,name,phone,created,action_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $r['partner_id'], $account, $r['mid'], $r['role'], (string)$r['branch_id'], (string)($r['customer_id'] ?? ''), mb_substr((string)$r['mname'], 0, 120), $phone, $now, $now]);
            $ids[$r['partner_id']] = [$id, $r['name']];
        }
        $gw = class_exists(PhoneGateway::class) ? new PhoneGateway($this->db) : null;
        foreach ($ids as $partner => [$id, $clinic]) {
            try {
                if (!$gw || !$gw->route($partner, 'sms')) continue;
                $out = $gw->enqueue($partner, 'sms', $phone, self::message($clinic, $link), 'manual', 'reset:'.$id.':'.$now, 0, $now, $now + self::LINK_TTL, 'Şifre yenileme');
                $this->db->prepare('UPDATE identity_reset_request SET outbox_id=? WHERE id=?')->execute([$out, $id]);
                break;
            } catch (\Throwable) {}
        }
    }

    /** Şifre yenilenince açık istekler "Şifre yenilendi" olur. */
    public function complete(string $account, int $now): void
    {
        try {
            $this->db->prepare('UPDATE identity_reset_request SET done_at=? WHERE account_id=? AND done_at IS NULL AND created>?')->execute([$now, $account, $now - self::WINDOW]);
        } catch (PDOException $e) { if ($e->getCode() !== '42S02') throw $e; }
    }

    private static function canSee(array $actor): bool
    {
        return in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) && ClinicAccess::allowed($actor, 'clients');
    }

    /** Görünürlük koşulu: bayi hepsini; şube/personel yalnız kendi şubesindeki hasta sahiplerini. */
    private static function scope(array $actor, array &$args): string
    {
        $args[] = (string)$actor['partner_id'];
        if (($actor['role'] ?? '') === 'dealer') return 'r.partner_id=?';
        $args[] = (string)($actor['branch_id'] ?? '');
        return "r.partner_id=? AND r.role='customer' AND r.branch_id=?";
    }

    private static function status(array $r, int $now): string
    {
        if ($r['done_at'] !== null) return 'done';
        if ((int)$r['created'] < $now - self::WINDOW) return 'expired';
        $manual = $r['manual_at'] !== null ? (int)$r['manual_at'] : 0;
        if ($manual && $manual >= (int)$r['action_at']) return 'shared';
        if ($r['outbox_id'] === null) return 'nogateway';
        return match ((string)$r['ostatus']) {
            'sent' => 'sent',
            'queued', 'claimed' => (int)$r['action_at'] < $now - self::STUCK ? 'stuck' : 'queued',
            default => 'failed',
        };
    }

    public const LABELS = ['done' => 'Şifre yenilendi', 'sent' => 'SMS gönderildi · şifre yenilemesi bekleniyor', 'shared' => 'Bağlantı paylaşıldı · şifre yenilemesi bekleniyor',
        'queued' => 'SMS sırada', 'stuck' => 'SMS iletilemedi (sırada bekliyor)', 'failed' => 'SMS iletilemedi', 'nogateway' => 'SMS gönderilemedi (telefon hattı bağlı değil veya SMS hakkı yok)', 'expired' => 'Süresi doldu'];

    /** @return list<array<string,mixed>> */
    public function list(array $actor, array $query, int $now): array
    {
        if (!self::canSee($actor)) throw new RuntimeException('Hasta sahibi görüntüleme yetkisi gerekir.', 403);
        $args = [];
        $where = self::scope($actor, $args).' AND r.created>?';
        $args[] = $now - 7 * 86400;
        if (is_string($query['client'] ?? null) && $query['client'] !== '') { $where .= ' AND r.client_id=?'; $args[] = $query['client']; }
        try {
            $q = $this->db->prepare('SELECT r.*,o.status AS ostatus FROM identity_reset_request r LEFT JOIN phone_outbox o ON o.id=r.outbox_id WHERE '.$where.' ORDER BY r.created DESC LIMIT 100');
            $q->execute($args);
            $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) { if ($e->getCode() === '42S02') return []; throw $e; }
        $write = ClinicAccess::allowed($actor, 'clients', true);
        return array_map(function (array $r) use ($now, $write) {
            $s = self::status($r, $now);
            return ['id' => $r['id'], 'name' => $r['name'], 'phone' => $r['phone'], 'role' => $r['role'], 'client' => $r['client_id'], 'createdAt' => (int)$r['created'],
                'doneAt' => $r['done_at'] === null ? null : (int)$r['done_at'], 'status' => $s, 'label' => self::LABELS[$s], 'by' => $r['manual_by'],
                'canSend' => $write && !in_array($s, ['done', 'expired'], true)];
        }, $rows);
    }

    /**
     * Ekip tek dokunuşla gönderir: 'sms' kliniğin hattından öncelikli gider; 'whatsapp' bağlantıyı WhatsApp'ta açar
     * (personelin telefonundan, hasta sahibinin kayıtlı numarasına). Her gönderimde yeni bağlantı üretilir.
     */
    public function send(array $actor, string $id, string $channel, string $origin, int $now): array
    {
        if (!self::canSee($actor) || !ClinicAccess::allowed($actor, 'clients', true)) throw new RuntimeException('Hasta sahibi yazma yetkisi gerekir.', 403);
        if (!in_array($channel, ['sms', 'whatsapp'], true)) throw new RuntimeException('Gönderim kanalı geçersiz.', 422);
        $args = [$id];
        self::ensure($this->db);
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare('SELECT r.*,p.name AS clinic FROM identity_reset_request r JOIN partner_account p ON p.id=r.partner_id WHERE r.id=? AND '.self::scope($actor, $args).' FOR UPDATE');
            $q->execute($args);
            $r = $q->fetch(PDO::FETCH_ASSOC);
            if (!$r) throw new RuntimeException('İstek bulunamadı.', 404);
            if ($r['done_at'] !== null) throw new RuntimeException('Hasta sahibi şifresini zaten yeniledi.', 409);
            if ((int)$r['created'] < $now - self::WINDOW) throw new RuntimeException('İsteğin süresi doldu; hasta sahibi yeniden "Şifremi unuttum" demeli.', 410);
            if ((int)$r['action_at'] > $now - 20 && $r['action_at'] != $r['created']) throw new RuntimeException('Az önce gönderildi; birkaç saniye bekleyin.', 429);
            $clinic = trim((string)(($this->prefsClinic($r['partner_id'])) ?: $r['clinic']));
            $link = rtrim($origin, '/').'/app#yenile/'.$this->token($r['account_id'], $now);
            $body = self::message($clinic, $link);
            $result = ['ok' => true, 'channel' => $channel];
            if ($channel === 'sms') {
                $gw = new PhoneGateway($this->db);
                if (!$gw->route($r['partner_id'], 'sms')) throw new RuntimeException('Telefon hattı bağlı değil. Bağlantıyı WhatsApp ile gönderin.', 409);
                $out = $gw->enqueue($r['partner_id'], 'sms', $r['phone'], $body, 'manual', 'reset:'.$id.':'.$now, 0, $now, $now + self::LINK_TTL, (string)($actor['name'] ?? 'Şifre yenileme'));
                $this->db->prepare('UPDATE identity_reset_request SET outbox_id=?,action_at=?,manual_at=NULL,manual_by=? WHERE id=?')->execute([$out, $now, mb_substr((string)($actor['name'] ?? ''), 0, 120), $id]);
            } else {
                $this->db->prepare('UPDATE identity_reset_request SET action_at=?,manual_at=?,manual_by=? WHERE id=?')->execute([$now, $now, mb_substr((string)($actor['name'] ?? ''), 0, 120), $id]);
                $result['link'] = PhoneGateway::waLink($r['phone'], $body);
            }
            $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$r['partner_id'], (string)($actor['account_id'] ?? ''), 'password.reset.'.$channel]);
            $this->db->commit();
            return $result;
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    private function prefsClinic(string $partner): string
    {
        try {
            $q = $this->db->prepare('SELECT payload FROM clinic_workspace WHERE user_id=?');
            $q->execute(['partner:'.$partner]);
            $raw = (string)$q->fetchColumn();
            if ($raw === '' || strlen($raw) > 4_000_000) return '';
            $state = json_decode($raw);
            return is_object($state) ? trim((string)($state->preferences->clinic ?? '')) : '';
        } catch (\Throwable) { return ''; }
    }

    /** Klinik uyarıları: SMS'i gidemeyen, henüz şifresini yenilememiş istekler. */
    public function alerts(array $actor, int $now): array
    {
        if (!self::canSee($actor)) return [];
        $out = [];
        foreach ($this->list($actor, [], $now) as $r) {
            if (!in_array($r['status'], ['failed', 'nogateway', 'stuck'], true)) continue;
            $out[] = ['key' => 'reset:'.$r['id'], 'kind' => 'reset', 'tone' => 'warn', 'title' => 'Şifre yenileme isteği bekliyor',
                'body' => ($r['name'] ?: $r['phone']).' · '.$r['label'].'. Tek dokunuşla SMS veya WhatsApp ile gönderin.',
                'href' => $r['role'] === 'customer' && $r['client'] !== '' ? '#owner/'.rawurlencode($r['client']) : '#merkezi-hesaplar', 'time' => $r['createdAt'], 'auto' => true];
        }
        return $out;
    }
}
