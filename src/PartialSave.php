<?php
declare(strict_types=1);

namespace VetNet\Cpanel;
require_once __DIR__ . '/ClinicChanges.php';

use PDO;

/**
 * Büyük klinikler için seçici kaydetme.
 *
 * Kaydetme isteği yalnız birkaç kaydı değiştirir. Tüm kliniği belleğe almak yerine
 * değişen satırları ve doğrulama kurallarının baktığı bağlantılı satırları okur.
 * Doğrulama kodu (ClinicApi, Finance, VaccineInventory, WebBooking ...) aynen çalışır,
 * çünkü yüklenen alt küme bu kuralların okuduğu her satırı içerir:
 *
 *  - değişen satırlar ve LINKS ile bağlandıkları satırlar (zincir halinde),
 *  - muayeneye bağlı kontrol randevuları, satışa bağlı tahsilatlar, alışa bağlı ödemeler,
 *  - stok kurallarının toplam aldığı ürünler, partiler, aşı tanımları (tamamı),
 *  - randevu değişirken tüm evde hizmet ve web randevuları.
 *
 * Kuralların bütün kliniğe baktığı nadir durumlarda (ziyaretçi dönüşümü, web randevusunu
 * düzenleme, hasta sahibini değiştirme, eski biçimli satırlar, liste yeniden yazma)
 * null döner ve çağıran bilinen tam yükleme yoluna geçer.
 */
final class PartialSave
{
    /** ClinicApi::LINKS ile aynı; kontrol randevusu bağlantısı ek olarak izlenir. */
    private const LINKS = [
        'patients' => ['owner'=>'clients'],
        'messages'=>['client'=>'clients','patient'=>'patients','template'=>'templates'],
        'appointments' => ['patient'=>'patients','client'=>'clients','controlExamId'=>'exams'],
        'exams' => ['patient'=>'patients'],
        'followups' => ['patient'=>'patients','vaccine'=>'vaccineCatalog'],
        'sales'=>['client'=>'clients','patient'=>'patients'],'purchases'=>['supplier'=>'suppliers','product'=>'products'],
        'collections'=>['sale'=>'sales'],'payments'=>['purchase'=>'purchases'],
        'stockLots'=>['product'=>'products'],'stockMoves'=>['product'=>'products','lot'=>'stockLots'],
        'weights'=>['patient'=>'patients'], 'labs'=>['patient'=>'patients','exam'=>'exams'],
        'treatments'=>['patient'=>'patients'], 'prescriptions'=>['patient'=>'patients'], 'stays'=>['patient'=>'patients'], 'surgeries'=>['patient'=>'patients'],
        'tasks'=>['patient'=>'patients','client'=>'clients'],
    ];
    /** Bir satır yüklenince ona bağlı satırlar da yüklenir (link_key sanal sütunu). */
    private const REVERSE = ['exams'=>'appointments', 'sales'=>'collections', 'purchases'=>'payments'];
    /** Bu listelerden biri değişirse stok ve kasa kuralları için tamamı gereken listeler. */
    private const STOCK_TRIGGERS = ['sales','purchases','collections','payments','expenses','stockMoves','stockLots','products','followups'];
    private const STOCK_FULL = ['products','stockLots'];
    private const ID = '/\A[A-Za-z0-9_-]{1,80}\z/D';
    /** Bundan büyük alt kümede tam yükleme zaten daha uygundur. */
    private const MAX_ROWS = 60000;
    /** Testlerde tam yol ile karşılaştırmak için kapatılabilir. */
    public static bool $enabled = true;

    public function __construct(private readonly PDO $db) {}

    /**
     * @return array{revision:int,state:object,partial:array}|null
     */
    public function load(string $workspace, int $revision, mixed $patch): ?array
    {
        if (!$patch instanceof \stdClass) return null;
        $plan = self::plan($patch);
        if ($plan === null) return null;

        $head = $this->db->prepare(
            'SELECT w.revision, w.payload, s.id AS set_id, (SELECT COUNT(*) FROM clinic_directory d WHERE d.workspace_id=w.user_id) AS directory
             FROM clinic_workspace w JOIN clinic_record_set s ON s.workspace_id=w.user_id WHERE w.user_id=?'
        );
        $head->execute([$workspace]);
        $row = $head->fetch();
        if (!$row || (int)$row['revision'] !== $revision || (int)$row['directory'] > 0) return null;
        $set = (int)$row['set_id'];
        $state = json_decode($row['payload'], false, 512, JSON_THROW_ON_ERROR);
        if (!$state instanceof \stdClass) return null;

        $loaded = [];   // collection => id => [ordinal, row]
        $full = [];
        foreach ($plan['full'] as $collection) {
            if ($this->legacyKeys($set, $collection)) return null;
            $loaded[$collection] = $this->fetch($set, $collection, 'all', []);
            $full[$collection] = true;
        }
        foreach ($plan['prefix'] as [$collection, $prefix]) {
            $loaded[$collection] = ($loaded[$collection] ?? []) + $this->fetch($set, $collection, 'prefix', [$prefix]);
        }

        // Kapanış: istenen kimlikler -> bağlı satırlar -> ters bağlı satırlar, değişiklik kalmayana kadar.
        $want = $plan['ids'];
        foreach ($plan['rows'] as $collection => $rows) foreach ($rows as $patchRow) self::collectLinks($collection, $patchRow, $want);
        $attempted = $scanned = $legacyChecked = [];
        foreach ($full as $collection => $_) $legacyChecked[$collection] = true;
        $guard = function (string $collection) use (&$legacyChecked, $set): bool {
            if (isset($legacyChecked[$collection])) return true;
            $legacyChecked[$collection] = true;
            return !$this->legacyKeys($set, $collection);
        };
        for ($round = 0; ; $round++) {
            if ($round > 20) return null;
            $progress = false;
            foreach ($want as $collection => $ids) {
                if (isset($full[$collection])) continue;
                $missing = [];
                foreach ($ids as $id => $_) {
                    if (isset($loaded[$collection][$id]) || isset($attempted[$collection][$id])) continue;
                    $attempted[$collection][$id] = true;
                    $missing[] = (string)$id;
                }
                if (!$missing) continue;
                if (!$guard($collection)) return null;
                $found = $this->fetch($set, $collection, 'ids', $missing);
                if ($found) { $loaded[$collection] = ($loaded[$collection] ?? []) + $found; $progress = true; }
            }
            $want = [];
            $reverse = [];
            foreach ($loaded as $collection => $rows) {
                $child = self::REVERSE[$collection] ?? null;
                foreach ($rows as $id => [, $record]) {
                    if (isset($scanned[$collection][$id])) continue;
                    $scanned[$collection][$id] = true;
                    self::collectLinks($collection, $record, $want);
                    if ($child !== null && !isset($full[$child])) $reverse[$child][] = (string)$id;
                }
            }
            foreach ($reverse as $child => $keys) {
                if (!$guard($child)) return null;
                $new = array_diff_key($this->fetch($set, $child, 'links', $keys), $loaded[$child] ?? []);
                if ($new) { $loaded[$child] = ($loaded[$child] ?? []) + $new; $progress = true; }
            }
            foreach ($want as $collection => $ids) foreach ($ids as $id => $_) {
                if (!isset($full[$collection]) && !isset($loaded[$collection][$id]) && !isset($attempted[$collection][$id])) { $progress = true; break 2; }
            }
            if (!$progress) break;
        }

        $total = 0;
        foreach ($loaded as $rows) $total += count($rows);
        if ($total > self::MAX_ROWS) return null;

        // Hasta sahibinin değişmesi o hastaya bağlı tüm satış ve randevuları etkiler: tam yol.
        foreach ($plan['rows']['patients'] ?? [] as $patchRow) {
            $stored = $loaded['patients'][$patchRow->id ?? ''][1] ?? null;
            if ($stored && ($stored->owner ?? '') !== ($patchRow->owner ?? '')) return null;
        }

        foreach (ClinicRecords::COLLECTIONS as $collection) {
            $rows = $loaded[$collection] ?? [];
            uasort($rows, static fn($a, $b) => $a[0] <=> $b[0]);
            $state->$collection = array_values(array_map(static fn($pair) => $pair[1], $rows));
            if (in_array($collection, ClinicProtocol::COLLECTIONS, true)) {
                foreach ($state->$collection as $record) {
                    if (trim($record->protocol ?? '') === '') ClinicProtocol::seal($collection, $record, null);
                }
            }
        }
        return ['revision'=>$revision, 'state'=>$state, 'partial'=>[
            'set'=>$set, 'full'=>array_keys($full), 'prepend'=>$plan['prepend'], 'append'=>$plan['append'],
        ]];
    }

    /** Hangi satırların gerektiğini isteğin kendisinden çıkarır. */
    private static function plan(\stdClass $patch): ?array
    {
        $records = array_flip(ClinicRecords::COLLECTIONS);
        $ids = $rows = $prepend = $append = [];
        $full = [];
        $prefix = [];
        foreach ($patch as $collection => $change) {
            if (!is_string($collection) || !$change instanceof \stdClass) return null;
            if (!isset($records[$collection])) continue;           // şube ve ayarlar: üst veride tam olarak var
            if ($collection === 'activity' && property_exists($change, 'replace')) { $full[] = 'activity'; continue; }
            if ($collection === 'visitors' || property_exists($change, 'replace')) return null;
            foreach (['update','prepend','append'] as $operation) {
                $list = $change->$operation ?? [];
                if (!is_array($list)) return null;
                foreach ($list as $row) {
                    if (!$row instanceof \stdClass || !is_string($row->id ?? null) || !preg_match(self::ID, $row->id)) return null;
                    if ($collection === 'appointments' && str_starts_with($row->id, 'web-')) return null;
                    $ids[$collection][$row->id] = true;
                    $rows[$collection][] = $row;
                    if ($operation === 'prepend') $prepend[$collection][$row->id] = true;
                    if ($operation === 'append') $append[$collection][$row->id] = true;
                }
            }
        }
        if (!$rows && !$full) return null;
        if (array_intersect(array_keys($rows), self::STOCK_TRIGGERS)) {
            array_push($full, ...self::STOCK_FULL);
            if (isset($rows['followups'])) $full[] = 'vaccineCatalog';
        }
        if (isset($rows['appointments'])) {
            $prefix[] = ['appointments', '@visit-'];
            $prefix[] = ['appointments', '@web-'];
        }
        return ['ids'=>$ids, 'rows'=>$rows, 'prepend'=>$prepend, 'append'=>$append, 'full'=>array_values(array_unique($full)), 'prefix'=>$prefix];
    }

    private static function collectLinks(string $collection, object $row, array &$want): void
    {
        foreach (self::LINKS[$collection] ?? [] as $field => $target) {
            $id = $row->$field ?? null;
            if (is_string($id) && $id !== '' && preg_match(self::ID, $id)) $want[$target][$id] = true;
        }
    }

    private function legacyKeys(int $set, string $collection): bool
    {
        $query = $this->db->prepare("SELECT 1 FROM clinic_record WHERE set_id=? AND collection=? AND row_key LIKE '#%' LIMIT 1");
        $query->execute([$set, $collection]);
        return (bool)$query->fetchColumn();
    }

    /** @return array<string,array{0:int,1:object}> */
    private function fetch(int $set, string $collection, string $mode, array $values): array
    {
        $out = [];
        $chunks = $mode === 'all' ? [[]] : array_chunk($values, 500);
        foreach ($chunks as $chunk) {
            [$where, $params] = match ($mode) {
                'all' => ['', []],
                'prefix' => [' AND row_key LIKE ?', [$chunk[0].'%']],
                'ids' => [' AND row_key IN ('.implode(',', array_fill(0, count($chunk), '?')).')', array_map(static fn($id) => '@'.$id, $chunk)],
                'links' => [' AND link_key IN ('.implode(',', array_fill(0, count($chunk), '?')).')', $chunk],
            };
            $query = $this->db->prepare("SELECT ordinal, record_data FROM clinic_record WHERE set_id=? AND collection=?$where");
            $query->execute([$set, $collection, ...$params]);
            while ($row = $query->fetch(PDO::FETCH_NUM)) {
                $record = json_decode($row[1], false, 512, JSON_THROW_ON_ERROR);
                $id = $record->id ?? null;
                if (!is_string($id)) continue;
                $out[$id] = [(int)$row[0], $record];
            }
        }
        return $out;
    }

    /**
     * Seçici yükleme ile hazırlanan durumu yazar. Yalnız değişen ve yeni satırlar yazılır;
     * tamamı yüklenen listelerde (etkinlik günlüğü gibi) çıkarılan satırlar silinir.
     */
    public function store(string $workspace, array $partial, object $original, object $state): void
    {
        $set = (int)$partial['set'];
        $full = array_flip($partial['full']);
        $upsert = $this->db->prepare(
            'INSERT INTO clinic_record(set_id,collection,row_key,ordinal,record_id,branch_id,owner_id,record_data,content_hash)
             VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ordinal=VALUES(ordinal), record_id=VALUES(record_id),
             branch_id=VALUES(branch_id), owner_id=VALUES(owner_id), record_data=VALUES(record_data), content_hash=VALUES(content_hash)'
        );
        $counts = ['clients'=>0, 'patients'=>0];
        foreach (ClinicRecords::COLLECTIONS as $collection) {
            $before = [];
            foreach ($original->$collection ?? [] as $row) $before[$row->id] = $row;
            $rows = $state->$collection ?? [];
            if (!is_array($rows) || !array_is_list($rows)) throw new \RuntimeException('Kayıt listesi geçersiz.', 422);
            if (!$rows && !$before) continue;

            if (isset($full[$collection])) {
                // Tam liste: sıra ve silmeler dahil birebir; mevcut sıra numaraları korunur.
                $read = $this->db->prepare('SELECT row_key, ordinal, content_hash FROM clinic_record WHERE set_id=? AND collection=? ORDER BY ordinal');
                $read->execute([$set, $collection]);
                $stored = [];
                while ($r = $read->fetch(PDO::FETCH_NUM)) $stored[$r[0]] = [(int)$r[1], $r[2]];
                $keys = ClinicRecords::recordKeys($rows);
                if (count(array_unique($keys)) !== count($keys) || array_filter($keys, static fn($key) => $key[0] !== '@')) {
                    throw new \RuntimeException('Kayıt kimliği geçersiz.', 422);
                }
                $offset = ClinicRecords::firstOrdinal($keys, $stored);
                foreach ($rows as $index => $row) {
                    $key = $keys[$index];
                    $ordinal = $offset + $index;
                    $json = ClinicRecords::encode($row);
                    $hash = hash('sha256', $json, true);
                    $old = $stored[$key] ?? null;
                    unset($stored[$key]);
                    if ($old && $old[0] === $ordinal && hash_equals($old[1], $hash)) continue;
                    if (!$old || !hash_equals($old[1], $hash)) ClinicChanges::row($collection, $key);
                    $this->write($upsert, $set, $collection, $key, $ordinal, $row, $json, $hash);
                }
                $delete = $this->db->prepare('DELETE FROM clinic_record WHERE set_id=? AND collection=? AND row_key=?');
                foreach (array_keys($stored) as $key) { $delete->execute([$set, $collection, $key]); ClinicChanges::row($collection, $key); }
                continue;
            }

            $ids = [];
            foreach ($rows as $row) $ids[$row->id] = true;
            if (array_diff_key($before, $ids)) throw new \RuntimeException('Bu sürüm kayıt silmeyi desteklemiyor.', 501);
            $new = array_values(array_filter($rows, static fn($row) => !isset($before[$row->id])));
            if (isset($counts[$collection])) $counts[$collection] = count($new);
            $range = null;
            if ($new) {
                $bounds = $this->db->prepare('SELECT MIN(ordinal), MAX(ordinal) FROM clinic_record WHERE set_id=? AND collection=?');
                $bounds->execute([$set, $collection]);
                $range = $bounds->fetch(PDO::FETCH_NUM);
            }
            // Yeni satır, yüklenen ilk mevcut satırdan önce geliyorsa listenin başına, değilse sonuna eklenir.
            $firstExisting = null;
            foreach ($rows as $index => $row) if (isset($before[$row->id])) { $firstExisting = $index; break; }
            $head = $tail = [];
            foreach ($rows as $index => $row) {
                if (isset($before[$row->id])) continue;
                $front = $firstExisting !== null ? $index < $firstExisting
                    : isset($partial['prepend'][$collection][$row->id]) || !self::appended($partial, $collection, $row->id);
                if ($front) $head[] = $row; else $tail[] = $row;
            }
            $min = $range && $range[0] !== null ? (int)$range[0] : 0;
            $max = $range && $range[1] !== null ? (int)$range[1] : -1;
            foreach ($head as $index => $row) {
                $json = ClinicRecords::encode($row);
                $this->write($upsert, $set, $collection, self::rowKey($row), $min - count($head) + $index, $row, $json, hash('sha256', $json, true));
            }
            foreach ($tail as $index => $row) {
                $json = ClinicRecords::encode($row);
                $this->write($upsert, $set, $collection, self::rowKey($row), $max + 1 + $index, $row, $json, hash('sha256', $json, true));
            }
            $current = $this->db->prepare('SELECT ordinal, content_hash FROM clinic_record WHERE set_id=? AND collection=? AND row_key=?');
            foreach ($rows as $row) {
                if (!isset($before[$row->id]) || $row == $before[$row->id]) continue;
                $key = self::rowKey($row);
                $current->execute([$set, $collection, $key]);
                $old = $current->fetch(PDO::FETCH_NUM);
                if (!$old) throw new \RuntimeException('Kayıt alanı güncellendi.', 409);
                $json = ClinicRecords::encode($row);
                $hash = hash('sha256', $json, true);
                if (hash_equals($old[1], $hash)) continue;
                $this->write($upsert, $set, $collection, $key, (int)$old[0], $row, $json, $hash);
            }
        }
        if ($counts['clients'] || $counts['patients']) {
            $this->db->prepare('UPDATE clinic_record_set SET client_count=client_count+?, patient_count=patient_count+? WHERE id=?')
                ->execute([$counts['clients'], $counts['patients'], $set]);
        }
    }

    private static function appended(array $partial, string $collection, string $id): bool
    {
        return isset($partial['append'][$collection][$id]);
    }

    private static function rowKey(object $row): string
    {
        $id = $row->id ?? null;
        if (!is_string($id) || !preg_match(self::ID, $id)) throw new \RuntimeException('Kayıt kimliği geçersiz.', 422);
        return '@'.$id;
    }

    private function write(\PDOStatement $upsert, int $set, string $collection, string $key, int $ordinal, object $row, string $json, string $hash): void
    {
        $branch = $row->branch ?? null;
        $owner = $collection === 'patients' ? ($row->owner ?? null) : null;
        $valid = static fn($value) => is_string($value) && preg_match(self::ID, $value) === 1 ? $value : null;
        ClinicChanges::row($collection, $key);
        $upsert->execute([$set, $collection, $key, $ordinal, $valid($row->id ?? null), $valid($branch), $valid($owner), $json, $hash]);
    }
}
