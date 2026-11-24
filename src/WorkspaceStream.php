<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

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
    public function __construct(private readonly PDO $db) {}

    /** Seçici akıtma uygun değilse (eski biçim) false döner; çağıran bilinen yolu kullanır. */
    public function send(array $actor, callable $session): bool
    {
        $workspace = 'partner:'.$actor['partner_id'];
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

    private function rows(int $set, string $collection, ?string $branch): void
    {
        $sql = 'SELECT record_data FROM clinic_record WHERE set_id=? AND collection=?'.($branch !== null ? ' AND branch_id=?' : '').' ORDER BY ordinal';
        $this->db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        try {
            $query = $this->db->prepare($sql);
            $query->execute($branch !== null ? [$set, $collection, $branch] : [$set, $collection]);
            $seal = in_array($collection, ClinicProtocol::COLLECTIONS, true);
            echo '[';
            $first = true;
            while (($json = $query->fetchColumn()) !== false) {
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
}
