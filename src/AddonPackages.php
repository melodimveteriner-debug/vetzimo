<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Ek paketler: aylık paket sınırının üstüne satın alınan SMS / WhatsApp kredisi ve sınırlı diğer hakların artışı.
 * - Katalog yönetici panelinden düzenlenir (center_management, kind=addon_catalog).
 * - Satın alma abonelik siparişleriyle aynı akıştır (saas_order: plan_id "addon:<paket>", period "addon"; PayTR veya havale).
 * - Her hareket kredi defterine yazılır (clinic_addon_ledger): satın alma +adet, aylık sınırı aşan her mesaj −1, başarısız mesaj iadesi +1.
 * - SMS ve WhatsApp: önce paketin aylık hakkı kullanılır, bitince ek kredi düşülür; ikisi de bitince gönderim durur.
 * - Kullanıcı, şube, hasta, hasta sahibi kaydı ve depolama: satın alınan adet paket sınırına eklenir (sınırsız pakette gerekmez).
 * - "Diğer": yöneticinin tanımladığı serbest ek hizmetler; satın alma deftere ve siparişlere işlenir.
 */
final class AddonPackages
{
    private const CATALOG_ID = '00000000000000000000000000000007';
    public const KINDS = [
        'sms' => ['SMS', 'adet SMS'], 'whatsapp' => ['WhatsApp', 'adet WhatsApp mesajı'], 'users' => ['Kullanıcı', 'ek kullanıcı'],
        'branches' => ['Şube', 'ek şube'], 'patients' => ['Hasta kaydı', 'ek hasta kaydı'], 'clients' => ['Hasta sahibi kaydı', 'ek hasta sahibi kaydı'],
        'storage' => ['Depolama', 'GB ek depolama'], 'other' => ['Diğer', ''],
    ];
    /** Paket sınırına eklenen (aylık olmayan) haklar. */
    public const RAISE = ['users', 'branches', 'patients', 'clients', 'storage'];

    public function __construct(private readonly PDO $db) {}

    public static function defaults(): array
    {
        $p = static fn(string $id, string $kind, string $name, int $qty, int $price, string $desc = '') => ['id' => $id, 'kind' => $kind, 'name' => $name, 'quantity' => $qty, 'price' => $price, 'vat' => 'included', 'active' => true, 'description' => $desc];
        return [
            $p('sms-1000', 'sms', 'SMS 1.000', 1000, 25000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('sms-2500', 'sms', 'SMS 2.500', 2500, 55000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('sms-5000', 'sms', 'SMS 5.000', 5000, 100000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('wa-1000', 'whatsapp', 'WhatsApp 1.000', 1000, 25000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('wa-2500', 'whatsapp', 'WhatsApp 2.500', 2500, 55000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('wa-5000', 'whatsapp', 'WhatsApp 5.000', 5000, 100000, 'Aylık hakkınız bittiğinde kullanılır; süresiz geçerlidir.'),
            $p('user-1', 'users', '+1 Kullanıcı', 1, 30000, 'Ekibinize bir kullanıcı daha ekleyin.'),
            $p('branch-1', 'branches', '+1 Şube', 1, 75000, 'Bir şube daha tanımlayın.'),
            $p('patients-1000', 'patients', '+1.000 Hasta kaydı', 1000, 20000),
            $p('clients-1000', 'clients', '+1.000 Hasta sahibi kaydı', 1000, 20000),
            $p('storage-10', 'storage', '+10 GB Depolama', 10, 15000, 'Röntgen, belge ve görüntüler için.'),
            $p('other-support', 'other', 'Uzaktan kurulum ve eğitim (1 saat)', 1, 50000, 'Ekibinize uzaktan kurulum ve kullanım eğitimi.'),
        ];
    }

    // ---------------- Katalog ----------------
    public function catalog(bool $onlyActive = false): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='addon_catalog'");
        $q->execute([self::CATALOG_ID]);
        $raw = $q->fetchColumn();
        $rows = $raw === false ? self::defaults() : (json_decode((string)$raw, true)['packages'] ?? []);
        $out = [];
        foreach ($rows as $r) {
            if (!is_array($r) || !isset(self::KINDS[$r['kind'] ?? ''])) continue;
            if ($onlyActive && empty($r['active'])) continue;
            $r['kindLabel'] = self::KINDS[$r['kind']][0];
            $r['amount'] = self::amount($r);
            $out[] = $r;
        }
        return $out;
    }

    /** Yönetici "Ek paketleri gizle" anahtarı: açıkken hiçbir bayiye ek paket gösterilmez/satılmaz. */
    public function hidden(): bool
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='addon_catalog'");
        $q->execute([self::CATALOG_ID]);
        $raw = $q->fetchColumn();
        return $raw !== false && (json_decode((string)$raw, true)['hidden'] ?? false) === true;
    }

    /** Ek paketler yalnız ücretli aktif aboneliği olan bayiye görünür (deneme/demo ve Ücretsiz pakette görünmez). */
    public function eligible(string $partner): bool
    {
        if ($this->hidden()) return false;
        $day = (new \DateTimeImmutable('now', new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $q = $this->db->prepare("SELECT plan_id FROM clinic_subscription WHERE partner_id=? AND starts_on<=? AND ends_on>=? AND kind<>'trial'");
        $q->execute([$partner, $day, $day]);
        $catalog = (new Commerce($this->db))->catalog();
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $plan) {
            if ($plan === 'ucretsiz') continue;
            $p = $catalog[$plan] ?? null;
            if ($p && (($p['rank'] ?? null) === 0 || ($p['monthly'] ?? null) === 0 && ($p['yearly'] ?? null) === 0)) continue;
            return true;
        }
        return false;
    }

    public static function amount(array $r): ?int
    {
        $price = $r['price'] ?? null;
        if (!is_int($price) || $price <= 0) return null;
        return ($r['vat'] ?? 'included') === 'excluded' ? (int)round($price * 1.2) : $price;
    }

    public function saveCatalog(object $input): array
    {
        $rows = $input->packages ?? null;
        if (!is_array($rows) || count($rows) > 200) throw new RuntimeException('Ek paket listesi geçersiz.', 422);
        $clean = [];
        $ids = [];
        foreach ($rows as $r) {
            if (!is_object($r)) throw new RuntimeException('Ek paket satırı geçersiz.', 422);
            $id = trim((string)($r->id ?? ''));
            if ($id === '') $id = 'p'.bin2hex(random_bytes(5));
            if (!preg_match('/\A[a-z0-9][a-z0-9-]{0,24}\z/', $id) || isset($ids[$id])) throw new RuntimeException('Paket kodu geçersiz veya tekrar ediyor: '.$id, 422);
            $ids[$id] = true;
            $kind = (string)($r->kind ?? '');
            if (!isset(self::KINDS[$kind])) throw new RuntimeException('Paket türü geçersiz.', 422);
            $name = trim((string)($r->name ?? ''));
            if ($name === '' || mb_strlen($name) > 80 || preg_match('/[\x00-\x1F<>]/', $name)) throw new RuntimeException('Paket adını yazın (en çok 80 karakter).', 422);
            $qty = $r->quantity ?? null;
            if (!is_int($qty) || $qty < 1 || $qty > 10000000) throw new RuntimeException($name.': adet 1 ile 10.000.000 arasında olmalı.', 422);
            $price = $r->price ?? null;
            if ($price !== null && (!is_int($price) || $price < 0 || $price > 100000000)) throw new RuntimeException($name.': fiyat geçersiz.', 422);
            $desc = trim((string)($r->description ?? ''));
            if (mb_strlen($desc) > 240 || preg_match('/[\x00-\x1F<>]/', $desc)) throw new RuntimeException($name.': açıklama en çok 240 karakter.', 422);
            $clean[] = ['id' => $id, 'kind' => $kind, 'name' => $name, 'quantity' => $qty, 'price' => $price ?: null,
                'vat' => ($r->vat ?? 'included') === 'excluded' ? 'excluded' : 'included', 'active' => ($r->active ?? true) === true, 'description' => $desc];
        }
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'addon_catalog',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::CATALOG_ID, json_encode(['packages' => $clean, 'hidden' => ($input->hidden ?? false) === true], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        return $this->catalog();
    }

    public function find(string $id): ?array
    {
        foreach ($this->catalog(true) as $r) if ($r['id'] === $id) return $r;
        return null;
    }

    // ---------------- Kredi defteri ----------------
    private function table(): void
    {
        $this->db->exec("CREATE TABLE IF NOT EXISTS clinic_addon_ledger (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            kind varchar(12) CHARACTER SET ascii NOT NULL,
            delta int NOT NULL,
            reason varchar(240) NOT NULL DEFAULT '',
            ref varchar(200) NOT NULL DEFAULT '',
            actor varchar(120) NOT NULL DEFAULT '',
            created_at int unsigned NOT NULL,
            PRIMARY KEY (id),
            KEY clinic_addon_ledger_partner (partner_id, kind, created_at),
            KEY clinic_addon_ledger_ref (partner_id, ref)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    /** Tablo yoksa kurup sorguyu bir kez daha dener. */
    private function run(callable $fn): mixed
    {
        try { return $fn(); }
        catch (\PDOException $e) {
            if ($e->getCode() !== '42S02') throw $e;
            $this->table();
            return $fn();
        }
    }

    public function add(string $partner, string $kind, int $delta, string $reason, string $ref, int $now, string $actor = ''): void
    {
        $this->run(fn() => $this->db->prepare('INSERT INTO clinic_addon_ledger(partner_id,kind,delta,reason,ref,actor,created_at) VALUES (?,?,?,?,?,?,?)')
            ->execute([$partner, $kind, $delta, mb_substr($reason, 0, 240), mb_substr($ref, 0, 200), mb_substr($actor, 0, 120), $now]));
    }

    /** Kalan ek kredi / satın alınan toplam artış. */
    public function balance(string $partner, string $kind): int
    {
        return (int)$this->run(function () use ($partner, $kind) {
            $q = $this->db->prepare('SELECT COALESCE(SUM(delta),0) FROM clinic_addon_ledger WHERE partner_id=? AND kind=?');
            $q->execute([$partner, $kind]);
            return $q->fetchColumn();
        });
    }

    /** @return array<string,int> tür → bakiye */
    public function balances(string $partner): array
    {
        $rows = $this->run(function () use ($partner) {
            $q = $this->db->prepare('SELECT kind,COALESCE(SUM(delta),0) FROM clinic_addon_ledger WHERE partner_id=? GROUP BY kind');
            $q->execute([$partner]);
            return $q->fetchAll(PDO::FETCH_KEY_PAIR);
        });
        $out = [];
        foreach (array_keys(self::KINDS) as $k) $out[$k] = (int)($rows[$k] ?? 0);
        return $out;
    }

    public function ledger(string $partner, int $limit = 50): array
    {
        return $this->run(function () use ($partner, $limit) {
            // Tek tek mesaj düşümleri günlük olarak birleştirilir; satın alma ve iadeler ayrı satırdır.
            $q = $this->db->prepare("SELECT kind,delta,reason,actor,created_at FROM clinic_addon_ledger WHERE partner_id=? AND ref NOT LIKE 'use:%'
                UNION ALL SELECT kind,SUM(delta),CONCAT('Aylık hak bittikten sonra gönderilen mesajlar (',COUNT(*),' adet)'),'',MAX(created_at)
                FROM clinic_addon_ledger WHERE partner_id=? AND ref LIKE 'use:%' GROUP BY kind,FROM_UNIXTIME(created_at,'%Y-%m-%d')
                ORDER BY created_at DESC LIMIT ".max(1, min(200, $limit)));
            $q->execute([$partner, $partner]);
            return array_map(static fn($r) => ['channel' => $r['kind'], 'kind' => $r['kind'], 'label' => self::KINDS[$r['kind']][0] ?? $r['kind'], 'delta' => (int)$r['delta'],
                'reason' => $r['reason'], 'actor' => $r['actor'], 'created_at' => gmdate('c', (int)$r['created_at'])], $q->fetchAll(PDO::FETCH_ASSOC));
        });
    }

    /** Aylık hak bitmiş mesaj için bir ek kredi düşer. Kredi yoksa false. Aynı mesaj ikinci kez düşülmez. */
    public function consume(string $partner, string $kind, string $ref, int $now): bool
    {
        $lock = "CONCAT('vz-addon-',MD5(".$this->db->quote($partner.':'.$kind)."))";
        $this->db->query("SELECT GET_LOCK($lock,5)");
        try {
            $exists = $this->run(function () use ($partner, $ref) {
                $q = $this->db->prepare('SELECT 1 FROM clinic_addon_ledger WHERE partner_id=? AND ref=?');
                $q->execute([$partner, 'use:'.$ref]);
                return (bool)$q->fetchColumn();
            });
            if ($exists) return true;
            if ($this->balance($partner, $kind) < 1) return false;
            $this->add($partner, $kind, -1, 'Mesaj gönderimi', 'use:'.$ref, $now);
            return true;
        } finally {
            $this->db->query("SELECT RELEASE_LOCK($lock)");
        }
    }

    /** Ek krediden düşülen mesaj gönderilemediyse kredi iade edilir (bir kez). */
    public function refund(string $partner, string $kind, string $ref, int $now): void
    {
        try {
            $q = $this->db->prepare('SELECT ref FROM clinic_addon_ledger WHERE partner_id=? AND ref IN (?,?)');
            $q->execute([$partner, 'use:'.$ref, 'refund:'.$ref]);
            $refs = $q->fetchAll(PDO::FETCH_COLUMN);
            if (in_array('use:'.$ref, $refs, true) && !in_array('refund:'.$ref, $refs, true)) $this->add($partner, $kind, 1, 'Gönderilemeyen mesajın kredisi iade edildi', 'refund:'.$ref, $now);
        } catch (\PDOException) { /* defter yoksa iade edilecek kredi de yoktur */ }
    }

    // ---------------- Satın alma teslimi ----------------
    /** Ödenen ek paket siparişini krediye çevirir (SaasPayment::activate içinden, aynı işlem içinde). */
    public function grant(array $order, int $now): void
    {
        // Sipariş anındaki tür ve adet talimatın sonunda saklanır: [ek:sms:1000] (katalog sonradan değişse de esas alınır).
        $kind = null; $qty = null;
        if (preg_match('/\[ek:([a-z]+):(\d{1,8})\]\z/', (string)($order['instruction'] ?? ''), $m)) { $kind = $m[1]; $qty = (int)$m[2]; }
        else foreach ($this->catalog() as $r) if ($r['id'] === substr((string)$order['plan_id'], 6)) { $kind = $r['kind']; $qty = $r['quantity']; }
        if (!isset(self::KINDS[$kind]) || !is_int($qty) || $qty < 1) throw new RuntimeException('Ek paket bulunamadı; siparişi destekle kontrol edin.', 409);
        $this->add((string)$order['partner_id'], $kind, $qty, 'Ek paket satın alındı: '.$order['plan_name'], 'order:'.$order['id'], $now, (string)($order['created_by'] ?? ''));
    }

    /** Paket sınırlarına satın alınan artışları ekler (sınırsız olanlar değişmez). */
    public function raise(string $partner, array $limits): array
    {
        try { $b = $this->balances($partner); } catch (\Throwable) { return $limits; }
        foreach (self::RAISE as $k) if (array_key_exists($k, $limits) && $limits[$k] !== null && $b[$k] > 0) $limits[$k] += $b[$k];
        return $limits;
    }
}
