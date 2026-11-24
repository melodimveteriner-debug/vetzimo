<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;

final class ClinicRecords
{
    public const COLLECTIONS = [
        'clients','patients','appointments','exams','followups','weights','vaccineCatalog','labs',
        'treatments','prescriptions','stays','clinicNotes','products','suppliers','sales','purchases',
        'collections','payments','expenses','stockLots','stockMoves','templates','messages','users',
        'dealers','activity','visitors','documents','support','services',
    ];

    public function __construct(private readonly PDO $db) {}

    public static function encode(mixed $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public function load(string $workspace, ?string $branch = null, ?array $actor = null): array
    {
        $params = [$workspace, $workspace];
        $scope = '';
        if ($branch !== null && $actor !== null) {
            $collections = array_values(array_filter(self::COLLECTIONS, static fn($name) => ClinicAccess::allowed($actor, $name)));
            $scope = ' AND 1=0';
            if ($collections) {
                $scope = ' AND r.branch_id=? AND r.collection IN ('.implode(',',array_fill(0,count($collections),'?')).')';
                array_push($params,$branch,...$collections);
            }
        }
        // The metadata and ordered records must come from one database snapshot.
        $query = $this->db->prepare(
            "SELECT 0 AS row_type, '' AS collection, 0 AS seq, w.revision AS revision, w.payload AS document
             FROM clinic_workspace w WHERE w.user_id=?
             UNION ALL
             SELECT 1, r.collection, r.ordinal, 0, r.record_data
             FROM clinic_record_set s JOIN clinic_record r ON r.set_id=s.id WHERE s.workspace_id=?$scope
             ORDER BY row_type, collection, seq"
        );
        $query->execute($params);
        $first = $query->fetch();
        if (!$first) return ['revision'=>0,'state'=>null];
        $state = json_decode($first['document'], false, 512, JSON_THROW_ON_ERROR);
        while ($row = $query->fetch()) {
            $state->{$row['collection']}[] = json_decode($row['document'], false, 512, JSON_THROW_ON_ERROR);
        }
        return ['revision'=>(int)$first['revision'], 'state'=>$state];
    }

    public static function metadata(object $state): object
    {
        $metadata = clone $state;
        foreach (self::COLLECTIONS as $collection) {
            if (isset($state->$collection) && is_array($state->$collection) && array_is_list($state->$collection)) {
                $metadata->$collection = [];
            }
        }
        return $metadata;
    }

    /** The caller holds the workspace row lock until the transaction commits. */
    public function store(string $workspace, object $state, ?object $original=null): void
    {
        $collections = self::COLLECTIONS;
        // A legacy workspace needs its complete first insert. Protocol fields may
        // have been synthesized on read, so always compare those two lists to SQL.
        if ($original !== null && $this->migrated($workspace)) {
            $collections = array_values(array_filter($collections, static function ($name) use ($original, $state) {
                if (in_array($name, ClinicProtocol::COLLECTIONS, true)) return true;
                $old = $original->$name ?? null;
                $new = $state->$name ?? null;
                if (!is_array($old) || !is_array($new) || !array_is_list($old) || !array_is_list($new)) return true;
                if (count($old) !== count($new)) return true;
                foreach ($old as $index => $row) {
                    if ($row !== $new[$index] && self::encode($row) !== self::encode($new[$index])) return true;
                }
                return false;
            }));
        }
        $set = $this->db->prepare(
            'INSERT INTO clinic_record_set(workspace_id,client_count,patient_count) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),client_count=VALUES(client_count),patient_count=VALUES(patient_count)'
        );
        $set->execute([$workspace, self::count($state->clients ?? []), self::count($state->patients ?? [])]);
        $id = $this->db->lastInsertId();

        $slots = implode(',', array_fill(0,count($collections),'?'));
        $read = $this->db->prepare("SELECT collection,row_key,ordinal,content_hash FROM clinic_record WHERE set_id=? AND collection IN ($slots) ORDER BY collection,ordinal");
        $read->execute([$id,...$collections]);
        $previous = [];
        while ($row = $read->fetch()) {
            $previous[$row['collection']][$row['row_key']] = [$row['ordinal'], $row['content_hash']];
        }
        $upsert = $this->db->prepare(
            'INSERT INTO clinic_record(set_id,collection,row_key,ordinal,record_id,branch_id,owner_id,record_data,content_hash)
             VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ordinal=VALUES(ordinal), record_id=VALUES(record_id),
             branch_id=VALUES(branch_id), owner_id=VALUES(owner_id), record_data=VALUES(record_data), content_hash=VALUES(content_hash)'
        );
        foreach ($collections as $collection) {
            $rows = $state->$collection ?? null;
            if (!is_array($rows) || !array_is_list($rows)) continue;
            $keys = self::recordKeys($rows);
            $offset = self::firstOrdinal($keys, $previous[$collection] ?? []);
            foreach ($rows as $index => $row) {
                $key = $keys[$index];
                $ordinal = $offset + $index;
                $recordId = self::key($row->id ?? null);
                $json = self::encode($row);
                $hash = hash('sha256', $json, true);
                $old = $previous[$collection][$key] ?? null;
                unset($previous[$collection][$key]);
                if ($old && (int)$old[0] === $ordinal && hash_equals($old[1], $hash)) continue;
                $upsert->execute([
                    $id, $collection, $key, $ordinal, $recordId, self::key($row->branch ?? null),
                    $collection === 'patients' ? self::key($row->owner ?? null) : null,
                    $json, $hash,
                ]);
            }
        }
        $delete = $this->db->prepare('DELETE FROM clinic_record WHERE set_id=? AND collection=? AND row_key=?');
        foreach ($previous as $collection => $rows) {
            foreach (array_keys($rows) as $key) $delete->execute([$id, $collection, $key]);
        }
    }

    public static function recordKeys(array $rows): array
    {
        $keys = $seen = [];
        foreach ($rows as $index => $row) {
            $id = self::key($row->id ?? null);
            $keys[] = $id === null || isset($seen[$id]) ? '#'.$index : '@'.$id;
            if ($id !== null) $seen[$id] = true;
        }
        return $keys;
    }

    public static function firstOrdinal(array $keys, array $previous): int
    {
        if (!$previous) return 0;
        $first = array_key_first($previous);
        $start = array_search($first, $keys, true);
        if ($start === false) return 0;
        $ordinal = (int)$previous[$first][0];
        $index = $start;
        foreach ($previous as $key => $row) {
            if (($keys[$index] ?? null) !== $key || (int)$row[0] !== $ordinal + $index - $start) return 0;
            $index++;
        }
        // Preserve every existing rank for common prepend and append saves.
        return $ordinal - $start;
    }

    public function bookingState(string $workspace, string $owner): ?object
    {
        // Join the record id's first occurrence, as the legacy membership check expects unique ids.
        // Filter by the owner's data branch before reading patient bodies.
        $query = $this->db->prepare(
            "SELECT w.request_branches AS branches, c.record_data AS client, p.record_data AS patient
             FROM clinic_record_set s JOIN clinic_workspace w ON w.user_id=s.workspace_id
             LEFT JOIN clinic_record c ON c.set_id=s.id AND c.collection='clients' AND c.row_key=?
             LEFT JOIN clinic_record p ON p.set_id=s.id AND p.collection='patients'
               AND p.branch_id=c.branch_id AND p.owner_id=c.record_id
             WHERE s.workspace_id=? ORDER BY p.ordinal"
        );
        $query->execute(['@'.$owner, $workspace]);
        $first = $query->fetch();
        if (!$first) return null;
        $decode = static fn(?string $value) => $value === null ? [] : json_decode($value, false, 512, JSON_THROW_ON_ERROR);
        $state = (object)[
            'branches' => $decode($first['branches']),
            'clients' => $first['client'] === null ? [] : [$decode($first['client'])],
            'patients' => [],
        ];
        for ($row = $first; $row; $row = $query->fetch()) {
            if ($row['patient'] !== null) $state->patients[] = $decode($row['patient']);
        }
        return $state;
    }

    public function migrated(string $workspace): bool
    {
        $query = $this->db->prepare('SELECT 1 FROM clinic_record_set WHERE workspace_id=?');
        $query->execute([$workspace]);
        return (bool)$query->fetchColumn();
    }

    private static function count(mixed $rows): int
    {
        return is_array($rows) ? count($rows) : 0;
    }

    private static function key(mixed $value): ?string
    {
        return is_string($value) && preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $value) === 1 ? $value : null;
    }
}
