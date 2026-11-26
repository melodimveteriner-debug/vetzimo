<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use PDOException;

require_once __DIR__ . '/ClinicDirectory.php';
require_once __DIR__ . '/ClinicRecords.php';
require_once __DIR__ . '/ClinicProtocol.php';
require_once __DIR__ . '/PartialSave.php';

final class WorkspaceRepository
{
    public const WRITE_REQUEST_BYTES = 16_000_000;
    private readonly ClinicRecords $records;

    public function __construct(private readonly PDO $database)
    {
        $this->records = new ClinicRecords($database);
    }

    /**
     * Büyük kliniklerde (on binlerce kayıt) tüm çalışma alanı 128 MB PHP sınırını aşabilir; barındırma izin veriyorsa
     * bu istek için sınır 512 MB'a çıkarılır (yalnız düşükse). İzin yoksa sessizce geçer.
     */
    public static function headroom(int $megabytes=512): void
    {
        $limit=(string)ini_get('memory_limit');
        if ($limit==='-1') return;
        $n=(int)$limit;
        $bytes=match(strtolower(substr(trim($limit),-1))) {'g'=>$n<<30,'m'=>$n<<20,'k'=>$n<<10,default=>$n};
        if ($bytes<($megabytes<<20)) @ini_set('memory_limit',$megabytes.'M');
    }

    /** Yalnız istenen koleksiyonlar (şubeler ve tercihler her zaman gelir); eski biçimde tam yüklemeye düşer. */
    public function only(string $workspaceId, array $collections): ?object
    {
        return $this->records->collections($workspaceId, $collections) ?? $this->load($workspaceId)['state'];
    }

    /** @return array{revision: int, state: object|null} */
    public function load(string $workspaceId, ?string $branch=null, ?array $actor=null): array
    {
        self::headroom();
        $result = $this->records->load($workspaceId,$branch,$actor);
        foreach (ClinicProtocol::COLLECTIONS as $collection) {
            foreach ($result['state']->$collection ?? [] as $row) {
                if (trim($row->protocol ?? '') === '') ClinicProtocol::seal($collection,$row,null);
            }
        }
        return $result;
    }

    public function revision(string $workspaceId): int
    {
        $query = $this->database->prepare('SELECT revision FROM clinic_workspace WHERE user_id = ?');
        $query->execute([$workspaceId]);
        return (int)$query->fetchColumn();
    }

    public function branches(string $workspaceId): array
    {
        $query = $this->database->prepare('SELECT request_branches FROM clinic_workspace WHERE user_id = ?');
        $query->execute([$workspaceId]);
        $value = $query->fetchColumn();
        return is_string($value) ? (array)json_decode($value, false, 512, JSON_THROW_ON_ERROR) : [];
    }

    public function ownerMembershipState(string $workspace, string $owner): ?object
    {
        $query = $this->database->prepare(
            "SELECT w.request_branches, c.record_data FROM clinic_record_set s
             JOIN clinic_workspace w ON w.user_id=s.workspace_id
             LEFT JOIN clinic_record c ON c.set_id=s.id AND c.collection='clients' AND c.row_key=?
             WHERE s.workspace_id=?"
        );
        $query->execute(['@'.$owner,$workspace]);
        $row = $query->fetch();
        if (!$row) return $this->load($workspace)['state'];
        return (object)[
            'branches'=>json_decode($row['request_branches'] ?? '[]',false,512,JSON_THROW_ON_ERROR),
            'clients'=>$row['record_data'] === null ? [] : [json_decode($row['record_data'],false,512,JSON_THROW_ON_ERROR)],
        ];
    }

    public function patientCount(string $workspaceId): int
    {
        $query = $this->database->prepare(
            'SELECT COALESCE(s.patient_count,w.patient_count) FROM clinic_workspace w
             LEFT JOIN clinic_record_set s ON s.workspace_id=w.user_id WHERE w.user_id=?'
        );
        $query->execute([$workspaceId]);
        return (int)$query->fetchColumn();
    }

    public function bookingState(string $workspaceId, string $owner): ?object
    {
        return $this->records->bookingState($workspaceId, $owner)
            ?? (new ClinicDirectory($this->database))->bookingState($workspaceId, $owner);
    }

    /**
     * Persist an already validated workspace for the authenticated actor.
     * Returns null when a newer revision exists.
     */
    public function save(string $workspaceId, int $revision, object $state, ?object $original=null, ?array $partial=null): ?int
    {
        if ($revision < 0 || $revision >= PHP_INT_MAX) {
            throw new \InvalidArgumentException('Çalışma alanı sürümü geçersiz.');
        }
        $metadata = ClinicRecords::encode(ClinicRecords::metadata($state));
        $ownTransaction = !$this->database->inTransaction();
        if ($ownTransaction) $this->database->beginTransaction();
        try {
            if ($revision === 0) {
                $insert = $this->database->prepare('INSERT INTO clinic_workspace(user_id,revision,payload) VALUES (?,1,?)');
                try {
                    $insert->execute([$workspaceId, $metadata]);
                    $updated = true;
                } catch (PDOException $error) {
                    if ((int)($error->errorInfo[1] ?? 0) !== 1062) throw $error;
                    $updated = false;
                }
            } else {
                $update = $this->database->prepare(
                    'UPDATE clinic_workspace SET revision=revision+1,payload=?,updated_at=CURRENT_TIMESTAMP(3)
                     WHERE user_id=? AND revision=?'
                );
                $update->execute([$metadata, $workspaceId, $revision]);
                $updated = $update->rowCount() === 1;
            }
            if ($updated && $partial !== null) {
                // Seçici kayıt: eski müşteri dizini kullanan alanlar seçici yola hiç alınmaz.
                $directory = $this->database->prepare('SELECT COUNT(*) FROM clinic_directory WHERE workspace_id=?');
                $directory->execute([$workspaceId]);
                if ($original === null || (int)$directory->fetchColumn() > 0) throw new \RuntimeException('Kayıt alanı güncellendi.', 409);
                (new PartialSave($this->database))->store($workspaceId, $partial, $original, $state);
            } elseif ($updated) {
                $this->records->store($workspaceId, $state, $original);
                if ($revision && str_starts_with($workspaceId, 'partner:')) {
                    (new ClinicDirectory($this->database))->sync($workspaceId, $revision, $state);
                }
            }
            if ($ownTransaction) $this->database->commit();
            return $updated ? $revision + 1 : null;
        } catch (\Throwable $error) {
            if ($ownTransaction && $this->database->inTransaction()) $this->database->rollBack();
            throw $error;
        }
    }

    public function migrate(string $workspaceId): array
    {
        $this->database->beginTransaction();
        try {
            $lock = $this->database->prepare('SELECT revision FROM clinic_workspace WHERE user_id=? FOR UPDATE');
            $lock->execute([$workspaceId]);
            if (!$lock->fetchColumn()) throw new \RuntimeException('Bayi çalışma alanı bulunamadı.');
            $current = $this->load($workspaceId);
            $converted = !$this->records->migrated($workspaceId);
            if ($converted && $this->save($workspaceId, $current['revision'], $current['state']) === null) {
                throw new \RuntimeException('Çalışma alanı değişti.');
            }
            $after = $this->load($workspaceId);
            if ($after['state'] != $current['state']) {
                throw new \RuntimeException('Satır karşılaştırması eşleşmedi.');
            }
            $this->database->commit();
            return [
                'converted' => $converted,
                'revision' => $after['revision'],
                'owners' => count($after['state']->clients ?? []),
                'patients' => count($after['state']->patients ?? []),
            ];
        } catch (\Throwable $error) {
            if ($this->database->inTransaction()) $this->database->rollBack();
            throw $error;
        }
    }
}
