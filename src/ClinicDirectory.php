<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DomainException;
use PDO;
use RuntimeException;

final class ClinicDirectory
{
    private const GROUPS = [
        'clients' => 'clinic_directory_owner',
        'patients' => 'clinic_directory_patient',
    ];

    public function __construct(private readonly PDO $db)
    {
    }

    private function query(string $sql, array $parameters): \PDOStatement
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($parameters);
        return $statement;
    }

    private function marker(string $workspace): ?array
    {
        return $this->query(
            'SELECT id, revision, active FROM clinic_directory WHERE workspace_id = ? FOR UPDATE',
            [$workspace]
        )->fetch() ?: null;
    }

    private function lockWorkspace(string $workspace): array
    {
        $row = $this->query(
            'SELECT revision FROM clinic_workspace WHERE user_id = ? FOR UPDATE',
            [$workspace]
        )->fetch();
        if (!$row) throw new RuntimeException('Çalışma alanı bulunamadı.');
        return (new WorkspaceRepository($this->db))->load($workspace);
    }

    /** Uses the transaction that owns the updated workspace row. */
    public function sync(string $workspace, int $previousRevision, object $state): void
    {
        $marker = $this->marker($workspace);
        if (!$marker || (int)$marker['revision'] !== $previousRevision) return;
        $this->syncRows((string)$marker['id'], $state);
        $this->query('UPDATE clinic_directory SET revision = ? WHERE id = ?', [$previousRevision + 1, $marker['id']]);
    }

    /** Seed one workspace, verify and keep reads disabled until explicitly enabled. */
    public function seed(string $workspace): array
    {
        $row = $this->lockWorkspace($workspace);
        $marker = $this->marker($workspace);
        if ($marker) {
            $id = (string)$marker['id'];
            $this->query('UPDATE clinic_directory SET revision = ?, active = 0 WHERE id = ?', [$row['revision'], $id]);
            $this->query('DELETE FROM clinic_directory_patient WHERE directory_id = ?', [$id]);
            $this->query('DELETE FROM clinic_directory_owner WHERE directory_id = ?', [$id]);
        } else {
            $this->query('INSERT INTO clinic_directory(workspace_id, revision) VALUES (?, ?)', [$workspace, $row['revision']]);
            $id = $this->db->lastInsertId();
        }
        $state = $row['state'];
        $this->syncRows($id, $state);
        return $this->compare($id, $state) + ['revision' => (int)$row['revision'], 'active' => false];
    }

    public function verify(string $workspace, bool $activate = false): array
    {
        $row = $this->lockWorkspace($workspace);
        $marker = $this->marker($workspace);
        if (!$marker || (string)$marker['revision'] !== (string)$row['revision']) {
            throw new RuntimeException('Dizin eksik veya eski. Önce seed çalıştırın.');
        }
        $result = $this->compare((string)$marker['id'], $row['state']);
        if ($activate) {
            $this->query('UPDATE clinic_directory SET active = 1 WHERE id = ?', [$marker['id']]);
        }
        return $result + ['revision' => (int)$row['revision'], 'active' => $activate || (bool)$marker['active']];
    }

    public function disable(string $workspace): array
    {
        $this->lockWorkspace($workspace);
        $this->query('UPDATE clinic_directory SET active = 0 WHERE workspace_id = ?', [$workspace]);
        return ['active' => false];
    }

    /** A single consistent read. The caller must still verify membership, branch and owner phone. */
    public function bookingState(string $workspace, string $owner): ?object
    {
        $query = $this->query(
            'SELECT w.request_branches, o.record_data AS owner_data, p.record_data AS patient_data
             FROM clinic_directory d
             JOIN clinic_workspace w ON w.user_id = d.workspace_id AND w.revision = d.revision
             LEFT JOIN clinic_directory_owner o ON o.directory_id = d.id AND o.record_id = ?
             LEFT JOIN clinic_directory_patient p ON p.directory_id = o.directory_id AND p.branch_id = o.branch_id AND p.owner_id = o.record_id
             WHERE d.workspace_id = ? AND d.active = 1
             ORDER BY p.position, p.record_id',
            [$owner, $workspace]
        );
        $first = $query->fetch();
        if (!$first) return null;
        $state = (object)[
            'branches' => $first['request_branches'] === null ? [] : json_decode($first['request_branches'], false, 512, JSON_THROW_ON_ERROR),
            'clients' => $first['owner_data'] === null ? [] : [self::decode($first['owner_data'])],
            'patients' => [],
        ];
        for ($row = $first; $row; $row = $query->fetch()) {
            if ($row['patient_data'] !== null) $state->patients[] = self::decode($row['patient_data']);
        }
        return $state;
    }

    private function storedRows(string $table, string $id): array
    {
        return array_column($this->query(
            "SELECT record_id, branch_id, position, record_data".
            ($table === self::GROUPS['patients'] ? ', owner_id' : '').
            " FROM $table WHERE directory_id = ? ORDER BY position, record_id",
            [$id]
        )->fetchAll(), null, 'record_id');
    }

    private function syncRows(string $id, object $state): void
    {
        $next = $before = [];
        foreach (self::GROUPS as $group => $table) {
            $next[$group] = self::index($state->$group ?? [], $group);
            $before[$group] = $this->storedRows($table, $id);
        }

        foreach ($next['patients'] as $record) {
            $owner = $record['owner'];
            if ($owner !== null && ($next['clients'][$owner]['branch'] ?? null) !== $record['branch']) {
                throw new DomainException('Hasta ile sahibi aynı şube kapsamında bulunmalıdır.');
            }
        }
        // Remove missing patients first. Then write owners and patients in FK order.
        $this->removeRows(self::GROUPS['patients'], $id, array_diff_key($before['patients'], $next['patients']));
        foreach (self::GROUPS as $group => $table) {
            $ownerColumns = $group === 'patients' ? ', owner_id' : '';
            $ownerValue = $group === 'patients' ? ', ?' : '';
            $ownerUpdate = $group === 'patients' ? ', owner_id = VALUES(owner_id)' : '';
            $upsert = $this->db->prepare(
                "INSERT INTO $table(directory_id, record_id, branch_id, position, record_data$ownerColumns)
                 VALUES (?, ?, ?, ?, ?$ownerValue)
                 ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), position = VALUES(position),
                     record_data = VALUES(record_data)$ownerUpdate"
            );
            foreach ($next[$group] as $key => $record) {
                $old = $before[$group][$key] ?? null;
                if ($old && self::matches($record, $old)) continue;
                $params = [$id, (string)$key, $record['branch'], $record['position'], $record['json']];
                if ($group === 'patients') $params[] = $record['owner'];
                $upsert->execute($params);
            }
        }
        $this->removeRows(self::GROUPS['clients'], $id, array_diff_key($before['clients'], $next['clients']));
    }

    private function removeRows(string $table, string $directory, array $rows): void
    {
        if (!$rows) return;
        $delete = $this->db->prepare("DELETE FROM $table WHERE directory_id = ? AND record_id = ?");
        foreach ($rows as $id => $row) $delete->execute([$directory, (string)$id]);
    }

    private function compare(string $id, object $state): array
    {
        $counts = [];
        foreach (self::GROUPS as $group => $table) {
            $expected = self::index($state->$group ?? [], $group);
            $stored = $this->storedRows($table, $id);
            if (array_keys($expected) !== array_keys($stored)) throw new RuntimeException('Dizin kayıt kimlikleri veya sırası eşleşmiyor.');
            foreach ($expected as $key => $row) {
                if (!self::matches($row, $stored[$key])) {
                    throw new RuntimeException('Dizin kaydı kaynak ile eşleşmiyor.');
                }
            }
            $counts[$group] = count($expected);
        }
        return $counts;
    }

    private static function matches(array $expected, array $stored): bool
    {
        return $expected['position'] === (int)$stored['position'] &&
            $expected['branch'] === $stored['branch_id'] &&
            $expected['owner'] === ($stored['owner_id'] ?? null) &&
            $expected['json'] === $stored['record_data'];
    }

    private static function index(mixed $records, string $group): array
    {
        if (!is_array($records) || !array_is_list($records)) throw new DomainException('Klinik kayıt listesi geçersiz.');
        $indexed = [];
        foreach ($records as $position => $record) {
            if (!is_object($record) || !self::isId($record->id ?? null) || !self::isId($record->branch ?? null) ||
                isset($indexed[$record->id])) throw new DomainException('Klinik kayıt kimliği veya şubesi geçersiz.');
            $owner = $group === 'patients' ? ($record->owner ?? '') : '';
            if ($owner !== '' && !self::isId($owner)) throw new DomainException('Hasta sahibi kimliği geçersiz.');
            $indexed[$record->id] = [
                'branch' => $record->branch,
                'owner' => $owner === '' ? null : $owner,
                'position' => $position,
                'json' => json_encode($record, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ];
        }
        return $indexed;
    }

    private static function isId(mixed $id): bool
    {
        return is_string($id) && preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $id) === 1;
    }

    private static function decode(string $json): object
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }
}
