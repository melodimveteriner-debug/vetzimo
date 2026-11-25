<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Cihaz entegrasyonu: hemogram, biyokimya, kan gazı, idrar analizörleri ile röntgen, ultrason, MR ve tomografi.
 * Klinik bilgisayarındaki VetZimo ajanı cihazdan gelen sonucu (HL7, ASTM, CSV, DICOM, PDF/görüntü) okur ve buraya
 * gönderir. Sunucu sonucu hasta sahibi ve hastayla eşleştirir:
 *   1. mikroçip, 2. VetZimo hasta/protokol numarası, 3. hasta adı + sahip adı, 4. klinikte tek olan hasta adı.
 * Kesin eşleşmede sonuç hastaya bağlanır ve "Tetkik sonucu hazır" bildirimi gider; klinik uygulaması sonucu
 * hastanın o günkü muayenesine tetkik kaydı olarak ekler. Belirsiz sonuç adaylarıyla birlikte onaya düşer.
 */
final class DeviceHub
{
    public const KINDS = [
        'hematology' => ['Hemogram', 'Hemogram'], 'biochemistry' => ['Biyokimya', 'Biyokimya'], 'bloodgas' => ['Kan gazı', 'Kan gazı'],
        'urine' => ['İdrar tahlili', 'İdrar tahlili'], 'xray' => ['Röntgen', 'Röntgen'], 'ultrasound' => ['Ultrason', 'Ultrason'],
        'mr' => ['MR', 'MR'], 'ct' => ['Tomografi', 'Tomografi'], 'other' => ['Diğer', 'Laboratuvar'],
    ];
    public const CONNECTIONS = ['folder', 'tcp', 'serial', 'dicom', 'manual'];
    private const ID = '/\A[a-f0-9]{32}\z/';
    public const CHUNK = 4 * 1024 * 1024;
    public const MAX_FILE = 200 * 1024 * 1024;

    public function __construct(private readonly PDO $db) {}

    private function q(string $sql, array $args = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($args);
        return $q;
    }

    private static function text(mixed $v, int $max): string
    {
        if (!is_scalar($v) && $v !== null) return '';
        return mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v) ?? ''), 0, $max);
    }

    /** Türkçe harfleri sadeleştirip küçük harfe çevirir; "Ayşe YILMAZ" ile "ayse yilmaz" aynı sayılır. */
    public static function fold(string $s): string
    {
        $s = strtr($s, ['İ' => 'i', 'I' => 'ı']);
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s, ['ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'â' => 'a', 'î' => 'i', 'û' => 'u', '^' => ' ', '_' => ' ', ',' => ' ', '.' => ' ']);
        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9 ]+/', ' ', $s) ?? '') ?? '');
    }

    // ───────────────────────── Cihaz listesi (klinik) ─────────────────────────

    public function devices(string $partner): array
    {
        return array_map(static fn($r) => ['id' => $r['id'], 'branch' => $r['branch_id'], 'name' => $r['name'], 'kind' => $r['kind'], 'vendor' => $r['vendor'], 'model' => $r['model'],
            'connection' => $r['connection'], 'settings' => json_decode($r['settings'], true) ?: (object)[], 'active' => (bool)$r['active'], 'lastSeen' => $r['last_seen'] ? (int)$r['last_seen'] : null, 'lastError' => $r['last_error']],
            $this->q('SELECT * FROM clinic_device WHERE partner_id=? ORDER BY created_at', [$partner])->fetchAll());
    }

    public static function settings(string $connection, mixed $s): array
    {
        $s = is_object($s) ? $s : (object)[];
        return match ($connection) {
            'folder' => ['path' => self::text($s->path ?? '', 300) ?: throw new RuntimeException('Sonuç klasörünü yazın.', 422), 'pattern' => self::text($s->pattern ?? '', 40)],
            'tcp' => ['port' => ($p = (int)($s->port ?? 0)) >= 1024 && $p <= 65535 ? $p : throw new RuntimeException('TCP bağlantı noktası 1024–65535 arasında olmalı.', 422),
                'protocol' => in_array($s->protocol ?? 'auto', ['auto', 'hl7', 'astm'], true) ? ($s->protocol ?? 'auto') : 'auto'],
            'serial' => ['port' => preg_match('~\A(COM\d{1,3}|/dev/tty[A-Za-z0-9._-]{1,40})\z~', (string)($s->port ?? '')) ? $s->port : throw new RuntimeException('Seri port adı geçersiz (ör. COM3).', 422),
                'baud' => in_array((int)($s->baud ?? 9600), [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200], true) ? (int)($s->baud ?? 9600) : 9600,
                'protocol' => in_array($s->protocol ?? 'auto', ['auto', 'hl7', 'astm'], true) ? ($s->protocol ?? 'auto') : 'auto'],
            'dicom' => ['port' => ($p = (int)($s->port ?? 0)) >= 104 && $p <= 65535 ? $p : throw new RuntimeException('DICOM bağlantı noktası geçersiz.', 422),
                'aeTitle' => preg_match('/\A[A-Z0-9_ -]{1,16}\z/', strtoupper((string)($s->aeTitle ?? 'VETZIMO'))) ? strtoupper((string)($s->aeTitle ?? 'VETZIMO')) : 'VETZIMO'],
            default => [],
        };
    }

    public function save(array $actor, object $b, int $now): array
    {
        $kind = $b->kind ?? '';
        $conn = $b->connection ?? '';
        if (!isset(self::KINDS[$kind]) || !in_array($conn, self::CONNECTIONS, true)) throw new RuntimeException('Cihaz türü veya bağlantı geçersiz.', 422);
        $name = self::text($b->name ?? '', 80);
        if ($name === '') throw new RuntimeException('Cihaz adını yazın.', 422);
        $settings = json_encode(self::settings($conn, $b->settings ?? null), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $branch = $actor['role'] === 'dealer' ? self::text($b->branch ?? '', 80) : (string)$actor['branch_id'];
        $id = is_string($b->id ?? null) && preg_match(self::ID, $b->id) ? $b->id : null;
        if ($id) {
            $q = $this->q('UPDATE clinic_device SET name=?,kind=?,vendor=?,model=?,connection=?,settings=?,branch_id=?,active=? WHERE id=? AND partner_id=?',
                [$name, $kind, self::text($b->vendor ?? '', 60), self::text($b->model ?? '', 60), $conn, $settings, $branch, empty($b->paused) ? 1 : 0, $id, $actor['partner_id']]);
        } else {
            if ((int)$this->q('SELECT COUNT(*) FROM clinic_device WHERE partner_id=?', [$actor['partner_id']])->fetchColumn() >= 40) throw new RuntimeException('En fazla 40 cihaz eklenebilir.', 422);
            $this->q('INSERT INTO clinic_device(id,partner_id,branch_id,name,kind,vendor,model,connection,settings,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [bin2hex(random_bytes(16)), $actor['partner_id'], $branch, $name, $kind, self::text($b->vendor ?? '', 60), self::text($b->model ?? '', 60), $conn, $settings, $now]);
        }
        return $this->devices($actor['partner_id']);
    }

    public function remove(array $actor, string $id): array
    {
        $this->q('DELETE FROM clinic_device WHERE id=? AND partner_id=?', [$id, $actor['partner_id']]);
        return $this->devices($actor['partner_id']);
    }

    /** Klinik bilgisayarındaki ajanın durumu (Bakanlık köprüsü ile aynı ajan). */
    public function agentState(string $partner, int $now): ?array
    {
        try {
            $a = $this->q('SELECT name,version,last_seen FROM clinic_bridge_agent WHERE partner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL ORDER BY last_seen DESC LIMIT 1', [$partner])->fetch();
        } catch (\PDOException) { return null; }
        return $a ? ['name' => $a['name'], 'version' => $a['version'], 'lastSeen' => $a['last_seen'] ? (int)$a['last_seen'] : null, 'online' => $a['last_seen'] && $now - (int)$a['last_seen'] < 120] : null;
    }

    // ───────────────────────── Ajan ─────────────────────────

    /** Ajanın dinleyeceği cihazlar (yalnız etkin olanlar). */
    public function agentDevices(array $agent, int $now): array
    {
        $this->q('UPDATE clinic_device SET last_seen=? WHERE partner_id=? AND active=1', [$now, $agent['partner_id']]);
        return ['devices' => array_values(array_filter($this->devices($agent['partner_id']), static fn($d) => $d['active'] && $d['connection'] !== 'manual'))];
    }

    public function agentError(array $agent, object $b): array
    {
        $id = (string)($b->device ?? '');
        $this->q('UPDATE clinic_device SET last_error=? WHERE id=? AND partner_id=?', [self::text($b->error ?? '', 300), $id, $agent['partner_id']]);
        return ['ok' => true];
    }

    /** Parçalı dosya yükleme (DICOM görüntüleri onlarca MB olabilir). */
    public function agentChunk(array $agent, string $upload, int $index, int $total, string $name, string $type, string $bytes, int $now): array
    {
        if (!preg_match(self::ID, $upload) || $total < 1 || $total > intdiv(self::MAX_FILE, self::CHUNK) + 1 || $index < 0 || $index >= $total || strlen($bytes) > self::CHUNK || $bytes === '')
            throw new RuntimeException('Dosya parçası geçersiz.', 422);
        $name = preg_replace('/[^\p{L}\p{N} ._()\-]+/u', '_', mb_substr($name, 0, 170)) ?: 'sonuc';
        $type = preg_match('~\A[a-z]+/[a-z0-9.+-]{1,60}\z~', $type) ? $type : 'application/octet-stream';
        $file = $this->q('SELECT partner_id,chunks FROM clinic_device_file WHERE id=?', [$upload])->fetch();
        if ($file && ($file['partner_id'] !== $agent['partner_id'] || (int)$file['chunks'] !== $total)) throw new RuntimeException('Dosya kimliği çakıştı.', 409);
        if (!$file) $this->q('INSERT INTO clinic_device_file(id,partner_id,name,type,chunks,created_at) VALUES (?,?,?,?,?,?)', [$upload, $agent['partner_id'], $name, $type, $total, $now]);
        $ins = $this->q('INSERT IGNORE INTO clinic_device_file_chunk(file_id,idx,data) VALUES (?,?,?)', [$upload, $index, $bytes]);
        if ($ins->rowCount()) $this->q('UPDATE clinic_device_file SET received=received+1,size=size+? WHERE id=?', [strlen($bytes), $upload]);
        $f = $this->q('SELECT received,chunks FROM clinic_device_file WHERE id=?', [$upload])->fetch();
        return ['received' => (int)$f['received'], 'complete' => (int)$f['received'] === (int)$f['chunks']];
    }

    /** Ajandan gelen sonuç: kaydedilir, eşleştirilir; aynı sonuç ikinci kez gelirse yok sayılır. */
    public function agentResult(array $agent, object $b, int $now): array
    {
        $device = $this->q('SELECT * FROM clinic_device WHERE id=? AND partner_id=?', [(string)($b->device ?? ''), $agent['partner_id']])->fetch();
        if (!$device) throw new RuntimeException('Cihaz bulunamadı; klinik panelinden cihazı ekleyin.', 404);
        $kind = isset(self::KINDS[$b->kind ?? '']) ? $b->kind : $device['kind'];
        $hint = [];
        foreach (['patientId' => 80, 'name' => 80, 'owner' => 120, 'chip' => 30, 'species' => 40, 'accession' => 64, 'sex' => 10, 'birth' => 12] as $k => $max) {
            $v = self::text($b->hint->$k ?? '', $max); if ($v !== '') $hint[$k] = $v;
        }
        $params = [];
        foreach (array_slice((array)($b->params ?? []), 0, 200) as $p) {
            if (!is_object($p)) continue;
            $name = self::text($p->name ?? $p->code ?? '', 40); $value = self::text($p->value ?? '', 40);
            if ($name === '' || $value === '') continue;
            $params[] = ['code' => self::text($p->code ?? '', 20), 'name' => $name, 'value' => $value, 'unit' => self::text($p->unit ?? '', 20),
                'low' => self::text($p->low ?? '', 16), 'high' => self::text($p->high ?? '', 16), 'flag' => strtoupper(self::text($p->flag ?? '', 4))];
        }
        $file = null;
        if (is_string($b->file ?? null) && preg_match(self::ID, $b->file)) {
            $f = $this->q('SELECT id,name,type,size,received,chunks FROM clinic_device_file WHERE id=? AND partner_id=?', [$b->file, $agent['partner_id']])->fetch();
            if (!$f || (int)$f['received'] !== (int)$f['chunks']) throw new RuntimeException('Dosya henüz tamamlanmadı.', 409);
            $file = $f;
        }
        if (!$params && !$file && self::text($b->summary ?? '', 10) === '') throw new RuntimeException('Sonuç boş.', 422);
        $data = ['params' => $params, 'summary' => mb_substr((string)($b->summary ?? ''), 0, 8000), 'title' => self::text($b->title ?? '', 120),
            'date' => preg_match('/\A\d{4}-\d{2}-\d{2}\z/', (string)($b->date ?? '')) ? $b->date : (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d'),
            'format' => self::text($b->format ?? '', 12), 'meta' => array_slice(array_map(fn($v) => self::text($v, 120), (array)($b->meta ?? [])), 0, 20, true),
            'file' => $file ? ['name' => $file['name'], 'type' => $file['type'], 'size' => (int)$file['size']] : null];
        $hash = hash('sha256', is_string($b->hash ?? null) && $b->hash !== '' ? 'agent:'.$b->hash : json_encode([$device['id'], $hint, $params, $data['summary'], $file['id'] ?? '']));
        $id = bin2hex(random_bytes(16));
        $ins = $this->q('INSERT IGNORE INTO clinic_device_result(id,partner_id,branch_id,device_id,kind,received_at,sample,hint,data,file_id,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [$id, $agent['partner_id'], $device['branch_id'], $device['id'], $kind, $now, self::text($b->sample ?? '', 80),
                json_encode($hint, JSON_UNESCAPED_UNICODE), json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $file['id'] ?? null, $hash]);
        if (!$ins->rowCount()) return ['duplicate' => true];
        $this->q('UPDATE clinic_device SET last_seen=?,last_error=\'\' WHERE id=?', [$now, $device['id']]);
        $match = $this->match($agent['partner_id'], $device['branch_id'], $hint, (string)($b->sample ?? ''));
        $this->applyMatch($id, $agent['partner_id'], $device['branch_id'], $kind, $match, $now);
        return ['id' => $id, 'status' => $match['patient'] ? 'matched' : 'pending', 'by' => $match['by'], 'candidates' => count($match['candidates'])];
    }

    // ───────────────────────── Eşleştirme ─────────────────────────

    private function setId(string $partner): ?int
    {
        $id = $this->q('SELECT id FROM clinic_record_set WHERE workspace_id=?', ['partner:'.$partner])->fetchColumn();
        return $id === false ? null : (int)$id;
    }

    /** @return list<array{id:string,branch:string,name:string,owner:string,species:string,chip:string}> */
    private function patients(int $set, string $column, string $value): array
    {
        $rows = $this->q("SELECT record_data FROM clinic_record WHERE set_id=? AND collection='patients' AND $column=? LIMIT 60", [$set, $value])->fetchAll(PDO::FETCH_COLUMN);
        return array_values(array_filter(array_map(static function ($json) {
            $r = json_decode($json, true);
            return is_array($r) && isset($r['id']) ? ['id' => (string)$r['id'], 'branch' => (string)($r['branch'] ?? ''), 'name' => (string)($r['name'] ?? ''), 'owner' => (string)($r['owner'] ?? ''),
                'species' => (string)($r['species'] ?? ''), 'chip' => (string)($r['chip'] ?? ''), 'protocol' => (string)($r['protocol'] ?? '')] : null;
        }, $rows)));
    }

    private function clientNames(int $set, array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if (!$ids) return [];
        $in = implode(',', array_fill(0, count($ids), '?'));
        $out = [];
        foreach ($this->q("SELECT record_data FROM clinic_record WHERE set_id=? AND collection='clients' AND record_id IN ($in)", [$set, ...$ids])->fetchAll(PDO::FETCH_COLUMN) as $json) {
            $r = json_decode($json, true); if (is_array($r)) $out[(string)$r['id']] = ['name' => (string)($r['name'] ?? ''), 'phone' => (string)($r['phone'] ?? '')];
        }
        return $out;
    }

    private static function ownerMatches(string $hint, string $owner): bool
    {
        $a = array_filter(explode(' ', self::fold($hint))); $b = array_filter(explode(' ', self::fold($owner)));
        if (!$a || !$b) return false;
        $common = array_intersect($a, $b);
        return count($common) >= min(2, count($a)) || (count($a) === 1 && in_array(reset($a), $b, true)) || end($a) === end($b) && count($common) >= 1;
    }

    /**
     * @return array{patient:?array,by:string,candidates:list<array>}
     */
    public function match(string $partner, string $branch, array $hint, string $sample = ''): array
    {
        $set = $this->setId($partner);
        $none = ['patient' => null, 'by' => '', 'candidates' => []];
        if ($set === null) return $none;
        $pick = function (array $list, string $by) use ($branch, $set): ?array {
            if (!$list) return null;
            $same = array_values(array_filter($list, static fn($p) => $branch === '' || $p['branch'] === $branch));
            $list = $same ?: $list;
            if (count($list) !== 1) return null;
            $p = $list[0];
            $p['ownerName'] = $this->clientNames($set, [$p['owner']])[$p['owner']]['name'] ?? '';
            return ['patient' => $p, 'by' => $by, 'candidates' => []];
        };
        $digits = static fn(string $s) => preg_replace('/\D+/', '', $s) ?? '';
        foreach (['chip', 'patientId', 'accession'] as $k) {
            $v = $hint[$k] ?? '';
            if ($k === 'chip' || strlen($digits($v)) === 15) {
                if (strlen($digits($v)) === 15 && ($r = $pick($this->patients($set, 'chip_key', $digits($v)), 'chip'))) return $r;
            }
        }
        foreach (array_filter([$hint['patientId'] ?? '', $hint['accession'] ?? '', $sample]) as $v) {
            if (($r = $pick($this->patients($set, 'protocol_key', $v), 'protocol'))) return $r;
            if (preg_match('/\A[A-Za-z0-9_-]{6,80}\z/', $v) && ($r = $pick($this->patients($set, 'record_id', $v), 'id'))) return $r;
        }
        $name = trim((string)($hint['name'] ?? ''));
        if ($name === '') return $none;
        // "PAMUK^AYSE YILMAZ" biçimi (DICOM) veya "Pamuk (Ayşe Yılmaz)" gibi birleşik adlar ayrılır.
        $owner = (string)($hint['owner'] ?? '');
        if ($owner === '' && preg_match('/\A([^^()]+)[\^(]\s*([^)]+)\)?\z/u', $name, $m)) { $name = trim($m[1]); $owner = trim($m[2]); }
        $variants = array_unique([$name, mb_convert_case(mb_strtolower($name), MB_CASE_TITLE), mb_strtoupper($name), mb_strtolower($name)]);
        $found = [];
        foreach ($variants as $v) foreach ($this->patients($set, 'name_key', $v) as $p) $found[$p['id']] = $p;
        // Ada göre bulunamadıysa Türkçe harf farklarına bakılır (Pasa/Paşa)
        if (!$found) foreach ($this->patients($set, 'name_key', strtr($name, ['s' => 'ş', 'S' => 'Ş'])) as $p) $found[$p['id']] = $p;
        $found = array_values(array_filter($found, fn($p) => self::fold($p['name']) === self::fold($name)));
        if (!$found) return $none;
        $owners = $this->clientNames($set, array_column($found, 'owner'));
        foreach ($found as &$p) $p['ownerName'] = $owners[$p['owner']]['name'] ?? '';
        unset($p);
        if ($owner !== '') {
            $withOwner = array_values(array_filter($found, fn($p) => self::ownerMatches($owner, $p['ownerName'])));
            if (count($withOwner) === 1) return ['patient' => $withOwner[0], 'by' => 'name+owner', 'candidates' => []];
            if ($withOwner) $found = $withOwner;
        }
        $same = array_values(array_filter($found, static fn($p) => $branch === '' || $p['branch'] === $branch));
        if (count($same) === 1 && $owner === '') return ['patient' => $same[0], 'by' => 'name', 'candidates' => []];
        return ['patient' => null, 'by' => '', 'candidates' => array_slice(array_map(static fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'owner' => $p['ownerName'], 'species' => $p['species'], 'client' => $p['owner']], $same ?: $found), 0, 12)];
    }

    private function applyMatch(string $id, string $partner, string $branch, string $kind, array $m, int $now): void
    {
        if ($m['patient']) {
            $p = $m['patient'];
            $this->q("UPDATE clinic_device_result SET status='matched',patient_id=?,client_id=?,match_by=?,candidates='[]',matched_at=? WHERE id=?", [$p['id'], $p['owner'], $m['by'], $now, $id]);
            (new DeliveryNotice($this->db))->add($partner, $p['branch'] ?: $branch, '', 'clinic', 'device:'.$id, 'Tetkik sonucu hazır · '.self::KINDS[$kind][0].' · '.$p['name'], '/clinic#patient/'.rawurlencode($p['id']));
        } else {
            $this->q("UPDATE clinic_device_result SET candidates=? WHERE id=?", [json_encode($m['candidates'], JSON_UNESCAPED_UNICODE), $id]);
        }
    }

    // ───────────────────────── Klinik: gelen kutusu ─────────────────────────

    private static function row(array $r): array
    {
        return ['id' => $r['id'], 'device' => $r['device_id'], 'deviceName' => $r['device_name'] ?? '', 'kind' => $r['kind'], 'kindLabel' => self::KINDS[$r['kind']][0] ?? $r['kind'],
            'labKind' => self::KINDS[$r['kind']][1] ?? 'Laboratuvar', 'receivedAt' => (int)$r['received_at'], 'sample' => $r['sample'], 'hint' => json_decode($r['hint'], true) ?: (object)[],
            'data' => json_decode($r['data'], true), 'file' => $r['file_id'], 'status' => $r['status'], 'patient' => $r['patient_id'], 'client' => $r['client_id'], 'by' => $r['match_by'],
            'candidates' => json_decode($r['candidates'], true) ?: [], 'lab' => $r['lab_id']];
    }

    public function inbox(array $actor, string $state, int $limit = 60): array
    {
        $states = ['pending' => "r.status='pending'", 'matched' => "r.status='matched'", 'done' => "r.status IN ('imported','ignored')", 'all' => '1'];
        $where = $states[$state] ?? $states['pending'];
        $branch = $actor['role'] === 'dealer' ? '' : ' AND (r.branch_id=? OR r.branch_id=\'\')';
        $args = [$actor['partner_id']]; if ($branch) $args[] = $actor['branch_id'];
        $rows = $this->q("SELECT r.*,d.name device_name FROM clinic_device_result r LEFT JOIN clinic_device d ON d.id=r.device_id WHERE r.partner_id=? AND $where$branch ORDER BY r.received_at DESC LIMIT ".max(1, min(200, $limit)), $args)->fetchAll();
        $counts = $this->q("SELECT status,COUNT(*) n FROM clinic_device_result WHERE partner_id=? AND received_at>? GROUP BY status", [$actor['partner_id'], time() - 90 * 86400])->fetchAll(PDO::FETCH_KEY_PAIR);
        return ['items' => array_map([self::class, 'row'], $rows), 'counts' => array_map('intval', $counts)];
    }

    /** Klinik uygulaması bu sonuçları tetkik kaydı olarak ekler (aynı kimlikle iki kez eklenmez). */
    public function claimMatched(array $actor, int $limit = 20): array
    {
        $rows = $this->q("SELECT r.*,d.name device_name FROM clinic_device_result r LEFT JOIN clinic_device d ON d.id=r.device_id WHERE r.partner_id=? AND r.status='matched' ORDER BY r.received_at LIMIT ".max(1, min(50, $limit)), [$actor['partner_id']])->fetchAll();
        return ['items' => array_map([self::class, 'row'], $rows)];
    }

    public function imported(array $actor, object $b, int $now): array
    {
        foreach (array_slice((array)($b->items ?? []), 0, 50) as $i) {
            if (!is_object($i) || !preg_match(self::ID, (string)($i->id ?? ''))) continue;
            $this->q("UPDATE clinic_device_result SET status='imported',lab_id=?,imported_at=? WHERE id=? AND partner_id=? AND status='matched'",
                [self::text($i->lab ?? '', 80), $now, $i->id, $actor['partner_id']]);
        }
        return ['ok' => true];
    }

    /** Elle eşleştirme ya da yok sayma. */
    public function resolve(array $actor, object $b, int $now): array
    {
        $id = (string)($b->id ?? '');
        $r = $this->q('SELECT * FROM clinic_device_result WHERE id=? AND partner_id=?', [$id, $actor['partner_id']])->fetch();
        if (!$r) throw new RuntimeException('Sonuç bulunamadı.', 404);
        if (($b->action ?? '') === 'ignore') {
            $this->q("UPDATE clinic_device_result SET status='ignored' WHERE id=?", [$id]);
        } elseif (($b->action ?? '') === 'assign') {
            $set = $this->setId($actor['partner_id']);
            $pid = self::text($b->patient ?? '', 80);
            $p = $set ? ($this->patients($set, 'record_id', $pid)[0] ?? null) : null;
            if (!$p) throw new RuntimeException('Hasta bulunamadı.', 404);
            if ($actor['role'] !== 'dealer' && $p['branch'] !== $actor['branch_id']) throw new RuntimeException('Bu hasta başka şubede.', 403);
            if ($r['status'] === 'imported') throw new RuntimeException('Sonuç zaten tetkik olarak eklendi.', 409);
            $this->applyMatch($id, $actor['partner_id'], $r['branch_id'], $r['kind'], ['patient' => $p, 'by' => 'manual', 'candidates' => []], $now);
        } elseif (($b->action ?? '') === 'retry') {
            $m = $this->match($actor['partner_id'], $r['branch_id'], json_decode($r['hint'], true) ?: [], $r['sample']);
            $this->applyMatch($id, $actor['partner_id'], $r['branch_id'], $r['kind'], $m, $now);
        } else throw new RuntimeException('İşlem geçersiz.', 422);
        return $this->inbox($actor, 'pending');
    }

    /** Elle yükleme (ajan yoksa): PDF, görüntü veya sonuç dosyası klinikte seçilir. */
    public function manualUpload(array $actor, object $b, int $now): array
    {
        $device = $this->q("SELECT * FROM clinic_device WHERE id=? AND partner_id=?", [(string)($b->device ?? ''), $actor['partner_id']])->fetch();
        if (!$device) throw new RuntimeException('Önce cihazı ekleyin.', 422);
        $agent = ['partner_id' => $actor['partner_id']];
        return $this->agentResult($agent, $b, $now);
    }

    public function file(array $actor, string $id): array
    {
        $f = $this->q('SELECT f.* FROM clinic_device_file f JOIN clinic_device_result r ON r.file_id=f.id AND r.partner_id=f.partner_id WHERE f.id=? AND f.partner_id=? LIMIT 1', [$id, $actor['partner_id']])->fetch();
        if (!$f) throw new RuntimeException('Dosya bulunamadı.', 404);
        return $f;
    }

    public function streamFile(string $id): void
    {
        $q = $this->db->prepare('SELECT data FROM clinic_device_file_chunk WHERE file_id=? ORDER BY idx');
        $q->execute([$id]);
        while (($chunk = $q->fetchColumn()) !== false) { echo $chunk; flush(); }
    }

    /** Hasta dosyasında: o hastaya gelen cihaz sonuçları. */
    public function forPatient(array $actor, string $patient): array
    {
        $rows = $this->q("SELECT r.*,d.name device_name FROM clinic_device_result r LEFT JOIN clinic_device d ON d.id=r.device_id WHERE r.partner_id=? AND r.patient_id=? ORDER BY r.received_at DESC LIMIT 50", [$actor['partner_id'], $patient])->fetchAll();
        return ['items' => array_map([self::class, 'row'], $rows)];
    }
}
