<?php
declare(strict_types=1);

namespace VetNet\Cpanel;
require_once __DIR__ . '/ColdStorage.php';

use PDO;

/**
 * Klinik verisini tarayıcıya akıtarak gönderir.
 *
 * Kayıtlar veritabanında zaten JSON olarak saklanır; her satırı PHP nesnesine çevirip yeniden
 * kodlamak yerine satırlar sırayla doğrudan yazılır. Bellek kullanımı klinik büyüklüğünden
 * bağımsızdır. Çıktı DealerWorkspace::visibleFor + reply() ile birebir aynı veriyi taşır:
 * aynı yetki süzgeci (ClinicAccess::visible), aynı şube kapsamı ve protokol numarası tamamlama.
 * Tüm sorgular tek bir tutarlı veritabanı anlık görüntüsünden okunur.
 */
final class WorkspaceStream
{
    /** @var array<string,array<string,true>> */
    private array $cold = [];
    public function __construct(private readonly PDO $db) {}

    /** Seçici akıtma uygun değilse (eski biçim) false döner; çağıran bilinen yolu kullanır. */
    public function send(array $actor, callable $session): bool
    {
        $workspace = 'partner:'.$actor['partner_id'];
        // Arşiv kimlikleri salt okunur anlık görüntüden önce hesaplanır (önbelleğe yazabilmek için).
        $this->cold = [];
        if (class_exists(ColdStorage::class)) {
            $storage = new ColdStorage($this->db);
            $setId = $storage->setId($workspace);
            if ($setId !== null) $this->cold = $storage->coldIds($setId);
        }
        $this->db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
            $head = $this->db->prepare(
                'SELECT w.revision, w.payload, s.id AS set_id FROM clinic_workspace w
                 JOIN clinic_record_set s ON s.workspace_id=w.user_id WHERE w.user_id=?'
            );
            $head->execute([$workspace]);
            $row = $head->fetch();
            $head->closeCursor();
            if (!$row) { $this->db->exec('COMMIT'); return false; }
            $metadata = json_decode($row['payload'], false, 512, JSON_THROW_ON_ERROR);
            if (!$metadata instanceof \stdClass) { $this->db->exec('COMMIT'); return false; }
            foreach (ClinicRecords::COLLECTIONS as $collection) {
                if (!isset($metadata->$collection) || !is_array($metadata->$collection)) $metadata->$collection = [];
            }

            // Yetki ve şube süzgeci üst veri üzerinde aynen uygulanır; satırlar aşağıda aynı kurala göre akar.
            $branch = null;
            if (in_array($actor['role'], ['staff','branch'], true)) {
                $branches = (new DealerWorkspace($this->db))->visibleBranches($actor);
                $branch = ($branches[0]->sharedWith ?? '') ?: $branches[0]->id;
            }
            $visible = ClinicAccess::visible($metadata, $actor);
            $sessionData = $session($visible);
            // Büyük klinik: işi bitmiş eski kayıtlar tarayıcıya gönderilmez (veritabanında kalır, istenince gelir).
            $archive = class_exists(ColdStorage::class) ? ColdStorage::summary($this->cold, ColdStorage::cutoff()) : null;
            if ($archive) $sessionData['archive'] = $archive;
            $sessionData['cacheSig'] = self::signature($actor);

            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            echo '{"revision":', (int)$row['revision'], ',"state":{';
            $first = true;
            foreach ($visible as $key => $value) {
                echo $first ? '' : ',', json_encode((string)$key, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), ':';
                $first = false;
                // ClinicAccess::visible ile aynı kural: hekim için yalnız izinsiz modül listeleri boşalır,
                // şube personeli için izinsiz her liste boşalır.
                $allowed = $branch === null
                    ? ClinicAccess::module((string)$key) === null || ClinicAccess::allowed($actor, (string)$key)
                    : ClinicAccess::allowed($actor, (string)$key);
                $streamed = in_array($key, ClinicRecords::COLLECTIONS, true) && is_array($value) && $allowed;
                if (!$streamed) { echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); continue; }
                $this->rows((int)$row['set_id'], $key, $branch);
            }
            echo '},"session":', json_encode($sessionData, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), '}';
            $this->db->exec('COMMIT');
            return true;
        } catch (\Throwable $error) {
            try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            throw $error;
        }
    }

    /**
     * Önbellek imzası: yetki, rol, şube veya üyelik değişirse tarayıcıdaki kopya kullanılmaz (tam yükleme yapılır).
     */
    public static function signature(array $actor): string
    {
        return substr(hash('sha256', json_encode([$actor['membership_id'] ?? '', $actor['role'] ?? '', $actor['branch_id'] ?? '',
            $actor['account_version'] ?? $actor['version'] ?? '', ClinicAccess::modules($actor), 'v1'], JSON_UNESCAPED_UNICODE)), 0, 24);
    }

    /**
     * Yavaş bağlantı için: tarayıcı elindeki kopyanın revizyonunu bildirir, yalnız o revizyondan bu yana değişen satırlar
     * (ve küçük üst veri: şubeler, ayarlar) gönderilir. Günlükte boşluk, toplu değişiklik veya yetki farkı varsa false döner
     * ve çağıran tam yüklemeye geçer. Yetki/şube/arşiv süzgeci tam yüklemeyle birebir aynıdır.
     */
    public function delta(array $actor, callable $session, int $since, string $sig): bool
    {
        if ($since <= 0 || !hash_equals(self::signature($actor), $sig)) return false;
        $workspace = 'partner:'.$actor['partner_id'];
        $this->cold = [];
        $storage = class_exists(ColdStorage::class) ? new ColdStorage($this->db) : null;
        $setId = $storage?->setId($workspace);
        if ($setId === null) return false;
        $this->cold = $storage->coldIds($setId);
        $this->db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
            $head = $this->db->prepare('SELECT w.revision, w.payload FROM clinic_workspace w WHERE w.user_id=?');
            $head->execute([$workspace]);
            $row = $head->fetch();
            $head->closeCursor();
            $revision = (int)($row['revision'] ?? 0);
            if (!$row || $since > $revision) { $this->db->exec('COMMIT'); return false; }
            $changes = $since === $revision ? [] : ClinicChanges::between($this->db, $workspace, $since, $revision, ClinicChanges::READ_WINDOW);
            if ($changes === null) { $this->db->exec('COMMIT'); return false; }
            foreach ($changes as $collection => $ids) {
                if (isset($ids[ClinicChanges::ALL]) && in_array($collection, ClinicRecords::COLLECTIONS, true)) { $this->db->exec('COMMIT'); return false; }
            }
            $metadata = json_decode($row['payload'], false, 512, JSON_THROW_ON_ERROR);
            if (!$metadata instanceof \stdClass) { $this->db->exec('COMMIT'); return false; }
            foreach (ClinicRecords::COLLECTIONS as $collection) if (!isset($metadata->$collection) || !is_array($metadata->$collection)) $metadata->$collection = [];
            $branch = null;
            if (in_array($actor['role'], ['staff','branch'], true)) {
                $branches = (new DealerWorkspace($this->db))->visibleBranches($actor);
                $branch = ($branches[0]->sharedWith ?? '') ?: $branches[0]->id;
            }
            $visible = ClinicAccess::visible($metadata, $actor);
            $sessionData = $session($visible);
            $archive = ColdStorage::summary($this->cold, ColdStorage::cutoff());
            if ($archive) $sessionData['archive'] = $archive;
            $sessionData['cacheSig'] = self::signature($actor);

            $meta = new \stdClass(); $rows = []; $removed = []; $head = [];
            foreach ($visible as $key => $value) {
                $allowed = $branch === null
                    ? ClinicAccess::module((string)$key) === null || ClinicAccess::allowed($actor, (string)$key)
                    : ClinicAccess::allowed($actor, (string)$key);
                $streamed = in_array($key, ClinicRecords::COLLECTIONS, true) && is_array($value) && $allowed;
                if (!$streamed) { $meta->$key = $value; continue; }
                if (!isset($changes[$key])) continue;
                $ids = array_map('strval', array_keys($changes[$key]));
                $found = [];
                $seal = in_array($key, ClinicProtocol::COLLECTIONS, true);
                $cold = $this->cold[$key] ?? [];
                foreach (array_chunk($ids, 500) as $chunk) {
                    $q = $this->db->prepare('SELECT record_id, ordinal, record_data FROM clinic_record WHERE set_id=? AND collection=? AND record_id IN ('
                        .implode(',', array_fill(0, count($chunk), '?')).')'.($branch !== null ? ' AND branch_id=?' : '').' ORDER BY ordinal');
                    $q->execute(array_merge([$setId, $key], $chunk, $branch !== null ? [$branch] : []));
                    while ([$id, $ordinal, $json] = $q->fetch(PDO::FETCH_NUM) ?: [null, null, null]) {
                        if ($id === null) break;
                        if (isset($cold[$id])) continue;
                        $record = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
                        if ($seal && trim($record->protocol ?? '') === '') ClinicProtocol::seal((string)$key, $record, null);
                        $rows[$key][] = ['o' => (int)$ordinal, 'r' => $record];
                        $found[$id] = true;
                    }
                }
                // Silinenler: yalnız veritabanında artık hiç bulunmayan kayıtlar bildirilir. Başka şubede duran (veya arşive
                // geçen) bir kaydın kimliği bu kullanıcıya gönderilmez; yetkisi dışındaki hiçbir satırın varlığı sızmaz.
                $missing = array_values(array_filter($ids, static fn($id) => !isset($found[$id])));
                if ($missing) {
                    $exists = [];
                    foreach (array_chunk($missing, 500) as $chunk) {
                        $q = $this->db->prepare('SELECT record_id FROM clinic_record WHERE set_id=? AND collection=? AND record_id IN ('.implode(',', array_fill(0, count($chunk), '?')).')');
                        $q->execute(array_merge([$setId, $key], $chunk));
                        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $id) $exists[$id] = true;
                    }
                    $gone = array_values(array_filter($missing, static fn($id) => !isset($exists[$id])));
                    if ($gone) $removed[$key] = $gone;
                }
                if (!empty($rows[$key])) {
                    // Yeni satır listenin başına mı sonuna mı: bu aralıkta değişmemiş satırların en küçük sırasıyla karşılaştırılır.
                    $q = $this->db->prepare('SELECT MIN(ordinal) FROM clinic_record WHERE set_id=? AND collection=?'.($branch !== null ? ' AND branch_id=?' : '').' AND record_id NOT IN ('.implode(',', array_fill(0, count($ids), '?')).')');
                    $q->execute(array_merge([$setId, $key], $branch !== null ? [$branch] : [], $ids));
                    $min = $q->fetchColumn();
                    $head[$key] = $min === null || $min === false ? PHP_INT_MAX : (int)$min;
                }
            }
            $out = [];
            foreach ($rows as $key => $list) foreach ($list as $item) $out[$key][] = ['head' => $item['o'] < $head[$key], 'row' => $item['r']];
            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            echo json_encode(['revision' => $revision, 'delta' => true, 'since' => $since, 'state' => $meta, 'rows' => (object)$out,
                'removed' => (object)$removed, 'session' => $sessionData], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            $this->db->exec('COMMIT');
            return true;
        } catch (\Throwable $error) {
            try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            throw $error;
        }
    }

    private function rows(int $set, string $collection, ?string $branch): void
    {
        $cold = $this->cold[$collection] ?? [];
        $sql = 'SELECT record_data, record_id FROM clinic_record WHERE set_id=? AND collection=?'.($branch !== null ? ' AND branch_id=?' : '').' ORDER BY ordinal';
        $this->db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        try {
            $query = $this->db->prepare($sql);
            $query->execute($branch !== null ? [$set, $collection, $branch] : [$set, $collection]);
            $seal = in_array($collection, ClinicProtocol::COLLECTIONS, true);
            echo '[';
            $first = true;
            while (($r = $query->fetch(PDO::FETCH_NUM)) !== false) {
                [$json, $recordId] = $r;
                if ($recordId !== null && isset($cold[$recordId])) continue;
                if ($seal) {
                    $record = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
                    if (trim($record->protocol ?? '') === '') {
                        ClinicProtocol::seal($collection, $record, null);
                        $json = ClinicRecords::encode($record);
                    }
                }
                echo $first ? '' : ',', $json;
                $first = false;
            }
            echo ']';
            $query->closeCursor();
        } finally {
            $this->db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
        }
    }

    /**
     * Merkez yedeği: kliniğin TAMAMI (arşiv dahil) veritabanından doğrudan akıtılır; bellek kullanımı klinik
     * büyüklüğünden bağımsızdır. Biçim CenterManagement::backup ile aynıdır (vetnet-workspace-v1).
     */
    public function backup(string $partner, string $branch = ''): bool
    {
        $workspace = 'partner:'.$partner;
        $this->cold = [];
        $this->db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
            $head = $this->db->prepare('SELECT w.revision, w.payload, s.id AS set_id FROM clinic_workspace w
                 JOIN clinic_record_set s ON s.workspace_id=w.user_id WHERE w.user_id=?');
            $head->execute([$workspace]);
            $row = $head->fetch();
            $head->closeCursor();
            $metadata = $row ? json_decode($row['payload']) : null;
            if (!$metadata instanceof \stdClass) { $this->db->exec('COMMIT'); return false; }
            $dataBranch = null;
            if ($branch !== '') {
                $selected = null;
                foreach ($metadata->branches ?? [] as $b) if (($b->id ?? '') === $branch) { $selected = $b; break; }
                if (!$selected) { $this->db->exec('COMMIT'); throw new \RuntimeException('Şube bulunamadı.', 404); }
                $dataBranch = ($selected->sharedWith ?? '') ?: $branch;
            }
            foreach (ClinicRecords::COLLECTIONS as $collection) $metadata->$collection ??= [];
            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            $prefix = ['format'=>'vetnet-workspace-v1', 'partner'=>$partner] + ($branch !== '' ? ['branch'=>$branch, 'dataBranch'=>$dataBranch] : []);
            echo substr(json_encode($prefix, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 0, -1), ',"revision":', (int)$row['revision'], ',"state":{';
            $first = true;
            foreach ($metadata as $key => $value) {
                if ($branch !== '' && $key === 'branches') {
                    $value = array_values(array_filter($value, static fn($b) => in_array($b->id ?? '', [$branch, $dataBranch], true)));
                } elseif ($branch !== '' && !is_array($value)) {
                    continue; // şube yedeğinde yalnız şubeler ve listeler
                }
                echo $first ? '' : ',', json_encode((string)$key, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), ':';
                $first = false;
                if (in_array($key, ClinicRecords::COLLECTIONS, true) && is_array($value)) $this->rows((int)$row['set_id'], (string)$key, $dataBranch);
                else echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            }
            echo '}}';
            $this->db->exec('COMMIT');
            return true;
        } catch (\Throwable $error) {
            try { $this->db->exec('ROLLBACK'); } catch (\Throwable) {}
            throw $error;
        }
    }
}
