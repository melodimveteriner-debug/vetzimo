<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
require_once __DIR__ . '/ClinicChanges.php';

use PDO;

/**
 * Sıcak/soğuk veri (arşiv) — VERİ TAŞINMAZ, SİLİNMEZ.
 *
 * Büyük klinikte tarayıcıya açılışta yalnız güncel ve hâlâ iş gören kayıtlar gönderilir; işi bitmiş eski kayıtlar
 * "soğuk" sayılır ve veritabanında olduğu yerde kalır. Hasta dosyası, raporlar ve "arşivi yükle" ile ihtiyaç anında
 * sunucudan gelir. Soğuk kayıtlar, istemci bir listeyi komple yeniden yazsa (replace) bile sunucuda korunur.
 *
 * Soğuk = eşikten büyük klinik + kesim tarihinden (bugün − 2 yıl) eski + işi bitmiş:
 *  satış borcu kapanmış · tahsilatı kapanmış satışa ait · aşı yapılmış · randevu kapanmış ·
 *  muayene/tetkik/kilo/tedavi/reçete/ameliyat/mesaj eski · yatış eski ve bitmiş.
 * Müşteri, hasta, ürün, stok, tedarikçi, alış, kasa ve diğer listeler hiçbir zaman soğuk sayılmaz.
 */
final class ColdStorage
{
    /** Bu kadar kayıttan küçük klinik bugünkü gibi tam yüklenir. */
    public const THRESHOLD = 20000;
    /** Kesim: bugünden geriye gün. */
    public const DAYS = 730;
    public const COLLECTIONS = ['sales','collections','followups','appointments','exams','labs','weights','treatments','prescriptions','surgeries','stays','messages'];
    private const OPEN_APPOINTMENT = ['Planlandı','Onaylandı','Bekliyor','Onay Bekliyor','Muayenede'];
    private const ACTIVE_STAY = ['Planlandı','Yatışta'];

    /** @var array<int,array<string,array<string,true>>> */
    private array $cache = [];

    public function __construct(private readonly PDO $db) {}

    public static function cutoff(?int $now = null): string
    {
        return (new \DateTimeImmutable('@'.($now ?? time())))->setTimezone(new \DateTimeZone('Europe/Istanbul'))
            ->modify('-'.self::DAYS.' days')->format('Y-m-d');
    }

    public function setId(string $workspace): ?int
    {
        $q = $this->db->prepare('SELECT id FROM clinic_record_set WHERE workspace_id=?');
        $q->execute([$workspace]);
        $id = $q->fetchColumn();
        return $id === false ? null : (int)$id;
    }

    /** Klinik soğuk ayrımına girecek kadar büyük mü? */
    public function active(int $set): bool
    {
        $q = $this->db->prepare('SELECT COUNT(*) FROM (SELECT 1 FROM clinic_record WHERE set_id=? LIMIT '.(self::THRESHOLD + 1).') x');
        $q->execute([$set]);
        return (int)$q->fetchColumn() > self::THRESHOLD;
    }

    /**
     * Soğuk kayıt kimlikleri (koleksiyon => [kimlik => true]). Klinik küçükse boş dizi.
     * Sonuç önbelleğe alınır; sonraki açılışlarda yalnız aradaki revizyonlarda değişen satırlar yeniden değerlendirilir
     * (satır düzeyinde değişiklik günlüğü). Günlük eksikse veya kesim tarihi değiştiyse baştan hesaplanır.
     * @return array<string,array<string,true>>
     */
    public function coldIds(int $set, ?string $cutoff = null): array
    {
        if (isset($this->cache[$set])) return $this->cache[$set];
        if (!$this->active($set)) return $this->cache[$set] = [];
        $cutoff ??= self::cutoff();
        $head = $this->db->prepare('SELECT s.workspace_id, w.revision FROM clinic_record_set s JOIN clinic_workspace w ON w.user_id=s.workspace_id WHERE s.id=?');
        $head->execute([$set]);
        [$workspace, $revision] = $head->fetch(PDO::FETCH_NUM) ?: ['', 0];
        $revision = (int)$revision;
        $stored = $this->stored($set);
        if ($stored && $stored['cutoff'] === $cutoff) {
            if ($stored['revision'] === $revision) return $this->cache[$set] = $stored['ids'];
            $changes = ClinicChanges::between($this->db, (string)$workspace, $stored['revision'], $revision);
            $cold = $changes === null ? null : $this->refresh($set, $stored['ids'], $changes, $cutoff);
            if ($cold !== null) { $this->store($set, $cutoff, $revision, $cold); return $this->cache[$set] = $cold; }
        }
        $cold = $this->compute($set, $cutoff);
        $this->store($set, $cutoff, $revision, $cold);
        return $this->cache[$set] = $cold;
    }

    /** Baştan hesap: kliniğin arşive aday listeleri bir kez taranır. */
    private function compute(int $set, string $cutoff): array
    {
        $cold = [];
        $read = function (string $collection) use ($set): \Generator {
            $q = $this->db->prepare('SELECT record_data FROM clinic_record WHERE set_id=? AND collection=?');
            $q->execute([$set, $collection]);
            while (($json = $q->fetchColumn()) !== false) yield json_decode($json);
        };
        // Satış: eski ve borcu kapanmış (paid + tahsilatlar >= tutar); tahsilatı da satışıyla birlikte
        $paid = []; $links = [];
        foreach ($read('collections') as $row) if (is_object($row)) {
            $paid[$row->sale ?? ''] = ($paid[$row->sale ?? ''] ?? 0) + self::cents($row->amount ?? '0');
            if (isset($row->id)) $links[$row->sale ?? ''][] = (string)$row->id;
        }
        foreach ($read('sales') as $row) {
            if (is_object($row) && isset($row->id) && self::saleCold($row, $paid[$row->id] ?? 0, $cutoff)) {
                $cold['sales'][$row->id] = true;
                foreach ($links[$row->id] ?? [] as $id) $cold['collections'][$id] = true;
            }
        }
        foreach (['followups','appointments','stays','exams','labs','weights','treatments','prescriptions','surgeries','messages'] as $collection) {
            foreach ($read($collection) as $row) if (is_object($row) && isset($row->id) && self::rowCold($collection, $row, $cutoff)) $cold[$collection][$row->id] = true;
        }
        return $cold;
    }

    /**
     * Artımlı güncelleme: yalnız değişen satırlar (ve tahsilatı değişen satışlar) yeniden değerlendirilir.
     * Belirsiz durumda (liste tümden değişti, silinen tahsilat) null döner ve baştan hesaplanır.
     */
    private function refresh(int $set, array $cold, array $changes, string $cutoff): ?array
    {
        $fetch = function (string $collection, array $ids, string $column = 'record_id') use ($set): array {
            $rows = [];
            foreach (array_chunk(array_values($ids), 500) as $chunk) {
                $q = $this->db->prepare("SELECT record_id, record_data FROM clinic_record WHERE set_id=? AND collection=? AND $column IN (".implode(',', array_fill(0, count($chunk), '?')).')');
                $q->execute([$set, $collection, ...array_map('strval', $chunk)]);
                while ($r = $q->fetch(PDO::FETCH_NUM)) { $row = json_decode($r[1]); if (is_object($row)) $rows[] = $row; }
            }
            return $rows;
        };
        $sales = [];
        foreach ($changes as $collection => $ids) {
            if (!in_array($collection, self::COLLECTIONS, true)) continue;
            if (isset($ids[ClinicChanges::ALL])) return null;
            $ids = array_keys($ids);
            if ($collection === 'sales') { foreach ($ids as $id) $sales[(string)$id] = true; continue; }
            if ($collection === 'collections') {
                $rows = $fetch('collections', $ids);
                if (count($rows) !== count($ids)) return null; // silinen tahsilatın satışı bilinmiyor
                foreach ($rows as $row) $sales[(string)($row->sale ?? '')] = true;
                continue;
            }
            $found = [];
            foreach ($fetch($collection, $ids) as $row) {
                $found[(string)$row->id] = true;
                if (self::rowCold($collection, $row, $cutoff)) $cold[$collection][$row->id] = true; else unset($cold[$collection][$row->id]);
            }
            foreach ($ids as $id) if (!isset($found[(string)$id])) unset($cold[$collection][$id]);
        }
        unset($sales['']);
        if ($sales) {
            $saleRows = array_column($fetch('sales', array_keys($sales)), null, 'id');
            $links = [];
            foreach ($fetch('collections', array_keys($sales), 'link_key') as $row) $links[(string)($row->sale ?? '')][] = $row;
            foreach (array_keys($sales) as $id) {
                $row = $saleRows[$id] ?? null;
                $paid = 0; foreach ($links[$id] ?? [] as $c) $paid += self::cents($c->amount ?? '0');
                $isCold = $row !== null && self::saleCold($row, $paid, $cutoff);
                if ($isCold) $cold['sales'][$id] = true; else unset($cold['sales'][$id]);
                foreach ($links[$id] ?? [] as $c) if ($isCold) $cold['collections'][$c->id] = true; else unset($cold['collections'][$c->id]);
            }
        }
        return array_filter($cold);
    }

    private static function old(mixed $date, string $cutoff): bool
    {
        return is_string($date) && $date !== '' && substr($date, 0, 10) < $cutoff;
    }

    private static function saleCold(object $row, int $collected, string $cutoff): bool
    {
        return self::old($row->date ?? null, $cutoff) && self::cents($row->paid ?? '0') + $collected >= self::cents($row->amount ?? '0');
    }

    private static function rowCold(string $collection, object $row, string $cutoff): bool
    {
        return match ($collection) {
            'followups' => (!empty($row->done) || in_array($row->status ?? '', ['Tamamlandı','Yapıldı','İptal'], true))
                && self::old(!empty($row->done) ? $row->done : ($row->date ?? null), $cutoff),
            'appointments' => self::old($row->date ?? null, $cutoff) && !in_array($row->status ?? '', self::OPEN_APPOINTMENT, true),
            'stays' => self::old($row->end ?? $row->date ?? $row->start ?? null, $cutoff) && !in_array($row->status ?? '', self::ACTIVE_STAY, true),
            default => self::old($row->date ?? $row->createdAt ?? null, $cutoff),
        };
    }

    /** @return array{cutoff:string,revision:int,ids:array}|null */
    private function stored(int $set): ?array
    {
        try {
            $q = $this->db->prepare('SELECT cutoff, revision, ids FROM clinic_cold_cache WHERE set_id=?');
            $q->execute([$set]);
            $r = $q->fetch(PDO::FETCH_NUM);
        } catch (\PDOException) { return null; }
        if (!$r) return null;
        $ids = json_decode((string)@gzuncompress((string)$r[2]), true);
        if (!is_array($ids)) return null;
        foreach ($ids as $c => $list) $ids[$c] = array_fill_keys($list, true);
        return ['cutoff'=>(string)$r[0], 'revision'=>(int)$r[1], 'ids'=>$ids];
    }

    private function store(int $set, string $cutoff, int $revision, array $cold): void
    {
        $blob = gzcompress(json_encode(array_map(static fn($ids) => array_map('strval', array_keys($ids)), $cold), JSON_THROW_ON_ERROR), 6);
        $sql = 'INSERT INTO clinic_cold_cache(set_id,cutoff,revision,ids) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE cutoff=VALUES(cutoff),revision=VALUES(revision),ids=VALUES(ids)';
        try {
            $this->db->prepare($sql)->execute([$set, $cutoff, $revision, $blob]);
        } catch (\PDOException $error) {
            if ($error->getCode() !== '42S02' || $this->db->inTransaction()) return;
            $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_cold_cache (set_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, cutoff DATE NOT NULL,
                revision INT UNSIGNED NOT NULL, ids MEDIUMBLOB NOT NULL) ENGINE=InnoDB');
            try { $this->db->prepare($sql)->execute([$set, $cutoff, $revision, $blob]); } catch (\PDOException) {}
        }
    }

    /** Akış sırasında satırın gönderilip gönderilmeyeceği (yalnız record_id ile). */
    public static function isCold(array $cold, string $collection, ?string $id): bool
    {
        return $id !== null && isset($cold[$collection][$id]);
    }

    /** Oturum özeti: istemci arşiv bilgisini ve sayısını gösterir. */
    public static function summary(array $cold, string $cutoff): ?array
    {
        if (!$cold) return null;
        $counts = array_map('count', $cold);
        return ['cutoff'=>$cutoff, 'total'=>array_sum($counts), 'counts'=>$counts];
    }

    /**
     * Arşivden kayıt getirir: bir hastanın tüm geçmişi, bir tarih aralığı veya tamamı. Yalnız soğuk satırlar döner
     * (sıcaklar zaten istemcide). Şube personeli için şube süzgeci uygulanır.
     * @return array<string,list<object>>
     */
    public function history(int $set, array $cold, array $filter, ?string $branch): array
    {
        $out = [];
        if (!$cold) return $out;
        $patient = $filter['patient'] ?? null; $client = $filter['client'] ?? null;
        $from = $filter['from'] ?? null; $to = $filter['to'] ?? null;
        foreach ($cold as $collection => $ids) {
            $sql = 'SELECT record_id, record_data FROM clinic_record WHERE set_id=? AND collection=?';
            $args = [$set, $collection];
            if ($branch !== null) { $sql .= ' AND branch_id=?'; $args[] = $branch; }
            if ($patient !== null) {
                if ($collection === 'collections') continue; // satışlara bağlı olarak aşağıda gelir
                if ($collection === 'sales') {
                    if ($client === null) continue;
                    $sql .= ' AND client_key=?'; $args[] = $client;
                } else { $sql .= ' AND patient_key=?'; $args[] = $patient; }
            }
            $sql .= ' ORDER BY ordinal';
            $q = $this->db->prepare($sql);
            $q->execute($args);
            while ($r = $q->fetch(PDO::FETCH_NUM)) {
                [$id, $json] = $r;
                if (!isset($ids[$id])) continue;
                $row = json_decode($json);
                if (!is_object($row)) continue;
                $date = substr((string)($row->done ?? $row->date ?? $row->end ?? ''), 0, 10);
                if ($from !== null && $date !== '' && $date < $from) continue;
                if ($to !== null && $date !== '' && $date > $to) continue;
                $out[$collection][] = $row;
            }
        }
        // Hasta geçmişinde satışlara bağlı tahsilatlar da gelsin
        if ($patient !== null && !empty($out['sales']) && isset($cold['collections'])) {
            $sales = array_flip(array_map(static fn($r) => $r->id, $out['sales']));
            $q = $this->db->prepare('SELECT record_id, record_data FROM clinic_record WHERE set_id=? AND collection=\'collections\''.($branch !== null ? ' AND branch_id=?' : ''));
            $q->execute($branch !== null ? [$set, $branch] : [$set]);
            while ($r = $q->fetch(PDO::FETCH_NUM)) {
                if (!isset($cold['collections'][$r[0]])) continue;
                $row = json_decode($r[1]);
                if (is_object($row) && isset($sales[$row->sale ?? ''])) $out['collections'][] = $row;
            }
        }
        return $out;
    }

    /**
     * İstemci bir listeyi komple gönderdiğinde (replace) ondan habersiz soğuk satırlar silinmesin: eksik soğuk satırlar
     * listeye geri eklenir. Böylece arşivdeki veri hiçbir kayıt yolundan kaybolamaz.
     */
    public static function preserve(object $original, object $patch, array $cold): void
    {
        foreach ($patch as $collection => $change) {
            if (!isset($cold[$collection]) || !$change instanceof \stdClass || !property_exists($change, 'replace') || !is_array($change->replace)) continue;
            $sent = [];
            foreach ($change->replace as $row) if (is_object($row) && isset($row->id)) $sent[(string)$row->id] = true;
            foreach ($original->$collection ?? [] as $row) {
                if (is_object($row) && isset($row->id, $cold[$collection][$row->id]) && !isset($sent[$row->id])) $change->replace[] = $row;
            }
        }
    }

    /** Tam durum kaydı (state) için aynı koruma: listelerde eksik soğuk satırlar geri eklenir. */
    public static function preserveState(object $original, object $state, array $cold): void
    {
        foreach ($cold as $collection => $ids) {
            if (!isset($state->$collection) || !is_array($state->$collection)) continue;
            $sent = [];
            foreach ($state->$collection as $row) if (is_object($row) && isset($row->id)) $sent[(string)$row->id] = true;
            foreach ($original->$collection ?? [] as $row) {
                if (is_object($row) && isset($row->id, $ids[$row->id]) && !isset($sent[$row->id])) $state->$collection[] = $row;
            }
        }
    }

    private static function cents(mixed $value): int
    {
        return (int)round(((float)str_replace(',', '.', (string)$value)) * 100);
    }
}
