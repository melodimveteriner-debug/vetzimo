<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Bakanlık köprüsü (e-Reçete ve aşı belgesi).
 *
 * Bakanlık sistemine API yetkisi olmadan, veterinerin kendi e-Devlet oturumunda işlem yapılır:
 * klinik bilgisayarındaki ajan, kliniğin bir kez "öğrettiği" ekran tarifine göre formları doldurur.
 * Sunucu yalnızca iş kuyruğunu tutar; e-Devlet şifresi hiçbir yerde görülmez ve saklanmaz.
 *
 * Çift kayıt güvenliği: ajan "Kaydet"e basmadan hemen önce işi "submitting" aşamasına alır. Bu aşamadan sonra
 * bağlantı koparsa iş kendiliğinden ASLA yeniden denenmez; "belirsiz" olur ve kullanıcı Bakanlıkta kontrol edip
 * belge numarasını bağlar ya da "belge yok" diyerek yeniden gönderir.
 */
final class MinistryBridge
{
    public const KINDS = ['prescription', 'vaccine'];
    private const ONLINE_SECONDS = 90;
    private const STALE_SECONDS = 600;

    public function __construct(private readonly PDO $db) {}

    private static function id(): string { return bin2hex(random_bytes(16)); }
    private static function hash(string $value): string { return hash('sha256', $value); }

    private static function text(mixed $value, int $max): string
    {
        if (!is_string($value)) return '';
        $value = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value) ?? '');
        return mb_substr($value, 0, $max, 'UTF-8');
    }

    // ---------------- Klinik tarafı ----------------

    private function guard(array $actor, bool $write, ?string $kind = null): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true)) throw new RuntimeException('Bakanlık köprüsü klinik ekibi içindir.', 403);
        $collection = $kind === 'vaccine' ? 'followups' : 'patients';
        if (!ClinicAccess::allowed($actor, $collection, $write)) throw new RuntimeException('Bu işlem için yetkiniz yok.', 403);
    }

    private function agent(string $partner): ?array
    {
        $q = $this->db->prepare('SELECT * FROM clinic_bridge_agent WHERE partner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL ORDER BY paired_at DESC LIMIT 1');
        $q->execute([$partner]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function sweep(string $partner, int $now): void
    {
        // Ajandan uzun süre ses gelmeyen işler: Kaydet'e basılmadıysa güvenle kuyruğa döner, basıldıysa belirsiz olur.
        $this->db->prepare("UPDATE clinic_bridge_job SET status='uncertain',error='Kaydetme sırasında bağlantı koptu.',updated_at=?
            WHERE partner_id=? AND status='claimed' AND phase='submitting' AND heartbeat_at<?")->execute([$now, $partner, $now - self::STALE_SECONDS]);
        $this->db->prepare("UPDATE clinic_bridge_job SET status=IF(attempts>=3,'error','queued'),error=IF(attempts>=3,'Ajan işi tamamlayamadı.',''),
            phase='',agent_id=NULL,updated_at=? WHERE partner_id=? AND status='claimed' AND phase<>'submitting' AND heartbeat_at<?")->execute([$now, $partner, $now - self::STALE_SECONDS]);
    }

    public function status(array $actor, int $now): array
    {
        $this->guard($actor, false);
        $partner = $actor['partner_id'];
        $this->sweep($partner, $now);
        $agent = $this->agent($partner);
        $q = $this->db->prepare('SELECT id,kind,record_key,patient_id,payload,status,phase,document_no,error,created_by,created_at,updated_at,finished_at,attempts
            FROM clinic_bridge_job WHERE partner_id=? ORDER BY FIELD(status,\'uncertain\',\'claimed\',\'queued\',\'error\',\'done\',\'cancelled\'),updated_at DESC LIMIT 300');
        $q->execute([$partner]);
        $jobs = [];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $payload = json_decode($row['payload'], true) ?: [];
            $jobs[] = ['id' => $row['id'], 'kind' => $row['kind'], 'records' => explode(',', $row['record_key']), 'patient' => $row['patient_id'],
                'status' => $row['status'], 'phase' => $row['phase'], 'documentNo' => $row['document_no'], 'error' => $row['error'],
                'createdBy' => $row['created_by'], 'createdAt' => (int)$row['created_at'], 'updatedAt' => (int)$row['updated_at'],
                'summary' => $payload['summary'] ?? '', 'search' => $payload['search'] ?? ''];
        }
        $maps = $this->db->prepare('SELECT kind,local_key,code,name FROM clinic_bridge_map WHERE partner_id=?');
        $maps->execute([$partner]);
        $recipes = $this->db->prepare('SELECT kind,version,updated_at,updated_by FROM clinic_bridge_recipe WHERE partner_id=?');
        $recipes->execute([$partner]);
        $pending = $this->db->prepare('SELECT pair_expires FROM clinic_bridge_agent WHERE partner_id=? AND revoked_at IS NULL AND token_hash IS NULL AND pair_expires>? LIMIT 1');
        $pending->execute([$partner, $now]);
        return [
            'agent' => $agent ? ['name' => $agent['name'], 'online' => $agent['last_seen'] !== null && $now - (int)$agent['last_seen'] <= self::ONLINE_SECONDS,
                'lastSeen' => $agent['last_seen'] === null ? null : (int)$agent['last_seen'], 'version' => $agent['version'],
                'ministry' => $agent['ministry'], 'ministryAt' => $agent['ministry_at'] === null ? null : (int)$agent['ministry_at'], 'command' => $agent['command']] : null,
            'pairingUntil' => ($p = $pending->fetchColumn()) ? (int)$p : null,
            'jobs' => $jobs,
            'maps' => $maps->fetchAll(PDO::FETCH_ASSOC),
            'recipes' => $recipes->fetchAll(PDO::FETCH_ASSOC),
        ];
    }

    /** Eşleştirme kodu üretir (tek seferlik, 30 dk). Önceki ajanın erişimi kapanır. */
    public function pair(array $actor, int $now): array
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch'], true)) throw new RuntimeException('Ajanı yalnızca klinik yöneticisi bağlayabilir.', 403);
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        for ($i = 0; $i < 10; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        $this->db->prepare('UPDATE clinic_bridge_agent SET revoked_at=? WHERE partner_id=? AND revoked_at IS NULL')->execute([$now, $actor['partner_id']]);
        $this->db->prepare('INSERT INTO clinic_bridge_agent(id,partner_id,name,pair_hash,pair_expires,created_at) VALUES (?,?,?,?,?,?)')
            ->execute([self::id(), $actor['partner_id'], '', self::hash($code), $now + 1800, $now]);
        $this->audit($actor, 'bridge.pair');
        return ['code' => substr($code, 0, 5) . '-' . substr($code, 5), 'expires' => $now + 1800];
    }

    public function revoke(array $actor, int $now): array
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch'], true)) throw new RuntimeException('Ajanı yalnızca klinik yöneticisi kaldırabilir.', 403);
        $this->db->prepare('UPDATE clinic_bridge_agent SET revoked_at=? WHERE partner_id=? AND revoked_at IS NULL')->execute([$now, $actor['partner_id']]);
        $this->audit($actor, 'bridge.revoke');
        return ['ok' => true];
    }

    public function command(array $actor, string $command): array
    {
        $this->guard($actor, true);
        if (!in_array($command, ['check-session', 'login'], true)) throw new RuntimeException('Komut geçersiz.', 422);
        $q = $this->db->prepare('UPDATE clinic_bridge_agent SET command=? WHERE partner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL');
        $q->execute([$command, $actor['partner_id']]);
        if (!$q->rowCount()) throw new RuntimeException('Bağlı ajan yok.', 409);
        return ['ok' => true];
    }

    private function records(array $actor, array $wanted): object
    {
        $state = (new ClinicRecords($this->db))->slice('partner:' . $actor['partner_id'], $wanted)
            ?? (new WorkspaceRepository($this->db))->load('partner:' . $actor['partner_id'])['state'];
        return ClinicAccess::visible($state, $actor);
    }

    private static function date(?string $value): string
    {
        return preg_match('/\A(\d{4})-(\d{2})-(\d{2})/', (string)$value, $m) ? "$m[3].$m[2].$m[1]" : '';
    }

    /**
     * Reçete (aynı hasta ve aynı günün bir ya da birkaç ilaç satırı) veya aşı için iş oluşturur.
     * Yükü sunucu kayıtlardan kurar; istemci yalnız kayıt kimliklerini ve Bakanlık ilaç/aşı karşılığını verir.
     */
    public function enqueue(array $actor, object $input, int $now): array
    {
        $kind = $input->kind ?? '';
        if (!in_array($kind, self::KINDS, true)) throw new RuntimeException('İş türü geçersiz.', 422);
        $this->guard($actor, true, $kind);
        $ids = $input->records ?? null;
        if (!is_array($ids) || !$ids || count($ids) > 12) throw new RuntimeException('Kayıt seçin.', 422);
        foreach ($ids as $id) if (!is_string($id) || !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $id)) throw new RuntimeException('Kayıt bilgisi geçersiz.', 422);
        sort($ids);
        $collection = $kind === 'vaccine' ? 'followups' : 'prescriptions';
        $state = $this->records($actor, [$collection => $ids]);
        $rows = array_column($state->$collection ?? [], null, 'id');
        if (count($rows) !== count($ids)) throw new RuntimeException('Kayıt bulunamadı.', 404);
        $patientId = $rows[$ids[0]]->patient ?? '';
        $date = substr((string)($rows[$ids[0]]->date ?? ''), 0, 10);
        foreach ($rows as $row) {
            if (($row->patient ?? '') !== $patientId) throw new RuntimeException('Bir reçetedeki ilaçlar aynı hastaya ait olmalı.', 422);
            if ($kind === 'prescription' && substr((string)($row->date ?? ''), 0, 10) !== $date) throw new RuntimeException('Bir reçetedeki ilaçlar aynı güne ait olmalı.', 422);
            if ($kind === 'vaccine' && ($row->kind ?? '') !== 'Aşı') throw new RuntimeException('Seçilen kayıt aşı değil.', 422);
        }
        if ($kind === 'vaccine' && count($ids) !== 1) throw new RuntimeException('Aşı belgesi tek aşı için gönderilir.', 422);
        $branch = $rows[$ids[0]]->branch;
        $people = $this->records($actor, ['patients' => [$patientId]]);
        $patient = $people->patients[0] ?? null;
        if (!$patient) throw new RuntimeException('Hasta bulunamadı.', 404);
        $owner = null;
        if (!empty($patient->owner)) $owner = ($this->records($actor, ['clients' => [$patient->owner]])->clients[0] ?? null);

        // Bakanlık karşılıkları: istemciden gelen eşleştirmeler kaydedilir, eksik olan iş açılmaz.
        $mapInput = is_object($input->map ?? null) ? get_object_vars($input->map) : [];
        $mapKind = $kind === 'vaccine' ? 'vaccine' : 'drug';
        $items = [];
        foreach ($ids as $id) {
            $row = $rows[$id];
            $label = $kind === 'vaccine' ? (string)($row->title ?? '') : (string)($row->drug ?? '');
            $localKey = mb_substr(mb_strtolower(trim($kind === 'vaccine' ? (($row->vaccine ?? '') ?: $label) : (($row->product ?? '') ?: $label)), 'UTF-8'), 0, 190, 'UTF-8');
            $given = $mapInput[$id] ?? null;
            if (is_object($given)) {
                $code = self::text($given->code ?? '', 80);
                $name = self::text($given->name ?? '', 200);
                if ($code === '' && $name === '') throw new RuntimeException('Bakanlık listesindeki karşılığı girin: ' . $label, 422);
                $this->db->prepare('INSERT INTO clinic_bridge_map(partner_id,kind,local_key,code,name,updated_at) VALUES (?,?,?,?,?,?)
                    ON DUPLICATE KEY UPDATE code=VALUES(code),name=VALUES(name),updated_at=VALUES(updated_at)')
                    ->execute([$actor['partner_id'], $mapKind, $localKey, $code, $name, $now]);
            }
            $q = $this->db->prepare('SELECT code,name FROM clinic_bridge_map WHERE partner_id=? AND kind=? AND local_key=?');
            $q->execute([$actor['partner_id'], $mapKind, $localKey]);
            $mapped = $q->fetch(PDO::FETCH_ASSOC);
            if (!$mapped) throw new RuntimeException('Bakanlık listesindeki karşılığı seçilmemiş: ' . $label, 422);
            $items[] = $kind === 'vaccine' ? [
                'name' => $label, 'ministryCode' => $mapped['code'], 'ministryName' => $mapped['name'],
                'lot' => self::text($input->lot ?? ($row->vaccineLot ?? ''), 60), 'dose' => self::text($input->dose ?? '1', 20),
                'date' => self::date($row->done ?? '') ?: self::date($row->date ?? ''), 'nextDate' => self::date($input->nextDate ?? ''),
            ] : [
                'name' => $label, 'ministryCode' => $mapped['code'], 'ministryName' => $mapped['name'],
                'quantity' => self::text((string)($row->quantity ?? '1'), 12) ?: '1', 'dose' => self::text($row->dose ?? '', 80),
                'route' => self::text($row->route ?? '', 60), 'frequency' => self::text($row->frequency ?? '', 60),
                'duration' => self::text($row->duration ?? '', 60), 'note' => self::text($row->notes ?? '', 300),
            ];
        }
        if ($kind === 'vaccine' && $items[0]['lot'] === '') throw new RuntimeException('Aşının parti (lot) numarasını girin.', 422);
        if (trim((string)($patient->chip ?? '')) === '' && trim((string)($patient->passport ?? '')) === '') {
            throw new RuntimeException('Bakanlık kaydı için hastanın mikroçip ya da pasaport numarası gerekli.', 422);
        }
        $recordKey = implode(',', $ids);
        $check = $this->db->prepare("SELECT status FROM clinic_bridge_job WHERE partner_id=? AND kind=? AND record_key=? AND status IN ('queued','claimed','uncertain','done') LIMIT 1");
        $check->execute([$actor['partner_id'], $kind, $recordKey]);
        if ($existing = $check->fetchColumn()) {
            throw new RuntimeException($existing === 'done' ? 'Bu kayıt Bakanlığa zaten gönderildi.' : 'Bu kayıt zaten kuyrukta.', 409);
        }
        $first = $rows[$ids[0]];
        $payload = [
            'kind' => $kind,
            'date' => self::date($first->date ?? ''),
            'diagnosis' => self::text($first->diagnosis ?? '', 200),
            'vet' => self::text($first->clinician ?? $actor['name'] ?? '', 120),
            'patient' => ['name' => self::text($patient->name ?? '', 80), 'species' => self::text($patient->species ?? '', 40),
                'breed' => self::text($patient->breed ?? '', 60), 'sex' => self::text($patient->sex ?? '', 20), 'birth' => self::date($patient->birth ?? ''),
                'color' => self::text($patient->color ?? '', 40), 'chip' => self::text($patient->chip ?? '', 30), 'passport' => self::text($patient->passport ?? '', 30),
                'weight' => self::text((string)($patient->weight ?? ''), 10)],
            'owner' => ['name' => self::text($owner->name ?? '', 120), 'nationalId' => self::text($owner->nationalId ?? '', 11),
                'phone' => self::text($owner->phone ?? '', 20), 'city' => self::text($owner->city ?? '', 40), 'district' => self::text($owner->district ?? '', 40)],
            'items' => $items,
            'summary' => ($kind === 'vaccine' ? 'Aşı: ' : 'Reçete: ') . implode(', ', array_column($items, 'name')) . ' · ' . self::text($patient->name ?? '', 80),
            'search' => trim(self::text($patient->chip ?? '', 30) . ' ' . (self::date($first->done ?? '') ?: self::date($first->date ?? ''))),
        ];
        $id = self::id();
        $this->db->prepare('INSERT INTO clinic_bridge_job(id,partner_id,branch_id,kind,record_key,patient_id,payload,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $actor['partner_id'], $branch, $kind, $recordKey, $patientId, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'queued',
                mb_substr((string)($actor['name'] ?? ''), 0, 120, 'UTF-8'), $now, $now]);
        $this->audit($actor, 'bridge.enqueue');
        return ['id' => $id, 'status' => 'queued'];
    }

    private function job(string $partner, string $id, bool $lock = false): array
    {
        if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new RuntimeException('İş bulunamadı.', 404);
        $q = $this->db->prepare('SELECT * FROM clinic_bridge_job WHERE partner_id=? AND id=?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$partner, $id]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('İş bulunamadı.', 404);
        return $row;
    }

    /** Kullanıcı kararı: kuyruktan çıkar, belgeyi bağla ya da (kontrol ettim, yok) yeniden gönder. */
    public function resolve(array $actor, object $input, int $now): array
    {
        $this->guard($actor, true);
        $job = $this->job($actor['partner_id'], (string)($input->id ?? ''));
        $action = $input->action ?? '';
        if ($action === 'cancel') {
            if (!in_array($job['status'], ['queued', 'error'], true)) throw new RuntimeException('Yalnızca bekleyen ya da hatalı iş kuyruktan çıkarılabilir.', 409);
            $this->db->prepare("UPDATE clinic_bridge_job SET status='cancelled',updated_at=? WHERE id=?")->execute([$now, $job['id']]);
        } elseif ($action === 'link') {
            $number = self::text($input->documentNo ?? '', 64);
            if (!in_array($job['status'], ['uncertain', 'error'], true) || $number === '') throw new RuntimeException('Bakanlıktaki belge numarasını girin.', 422);
            $this->db->prepare("UPDATE clinic_bridge_job SET status='done',document_no=?,error='',finished_at=?,updated_at=? WHERE id=?")->execute([$number, $now, $now, $job['id']]);
        } elseif ($action === 'resend') {
            if (!in_array($job['status'], ['uncertain', 'error'], true)) throw new RuntimeException('Bu iş yeniden gönderilemez.', 409);
            if ($job['status'] === 'uncertain' && ($input->checked ?? false) !== true) throw new RuntimeException('Önce Bakanlıkta belge olmadığını kontrol edin.', 422);
            $this->db->prepare("UPDATE clinic_bridge_job SET status='queued',phase='',attempts=0,error='',agent_id=NULL,updated_at=? WHERE id=?")->execute([$now, $job['id']]);
        } else {
            throw new RuntimeException('İşlem geçersiz.', 422);
        }
        $this->audit($actor, 'bridge.' . $action);
        return ['ok' => true];
    }

    // ---------------- Ajan tarafı ----------------

    public function agentPair(string $code, string $name, string $version, int $now): array
    {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');
        if (strlen($code) !== 10) throw new RuntimeException('Eşleştirme kodu geçersiz.', 422);
        $q = $this->db->prepare('SELECT id,partner_id FROM clinic_bridge_agent WHERE pair_hash=? AND pair_expires>? AND revoked_at IS NULL AND token_hash IS NULL');
        $q->execute([self::hash($code), $now]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Eşleştirme kodu geçersiz ya da süresi dolmuş.', 403);
        $token = bin2hex(random_bytes(32));
        $this->db->prepare('UPDATE clinic_bridge_agent SET token_hash=?,pair_hash=NULL,pair_expires=NULL,paired_at=?,last_seen=?,name=?,version=? WHERE id=?')
            ->execute([self::hash($token), $now, $now, self::text($name, 80), self::text($version, 20), $row['id']]);
        return ['token' => $token];
    }

    public function agentAuth(string $header): array
    {
        if (!preg_match('/\ABearer ([a-f0-9]{64})\z/', $header, $m)) throw new RuntimeException('Ajan kimliği gerekli.', 401);
        $q = $this->db->prepare('SELECT * FROM clinic_bridge_agent WHERE token_hash=? AND revoked_at IS NULL');
        $q->execute([self::hash($m[1])]);
        $agent = $q->fetch(PDO::FETCH_ASSOC);
        if (!$agent) throw new RuntimeException('Ajan erişimi kaldırılmış. Klinik panelinden yeniden eşleştirin.', 401);
        return $agent;
    }

    public function heartbeat(array $agent, object $input, int $now): array
    {
        $ministry = in_array($input->ministry ?? '', ['open', 'closed', 'unknown', 'waiting'], true) ? $input->ministry : $agent['ministry'];
        $this->db->prepare('UPDATE clinic_bridge_agent SET last_seen=?,version=?,ministry_at=IF(?<>ministry,?,COALESCE(ministry_at,?)),ministry=?,command=\'\' WHERE id=?')
            ->execute([$now, self::text($input->version ?? $agent['version'], 20), $ministry, $now, $now, $ministry, $agent['id']]);
        $this->sweep($agent['partner_id'], $now);
        $c = $this->db->prepare("SELECT COUNT(*) FROM clinic_bridge_job WHERE partner_id=? AND status='queued'");
        $c->execute([$agent['partner_id']]);
        return ['command' => $agent['command'], 'queued' => (int)$c->fetchColumn()];
    }

    public function claim(array $agent, int $now): array
    {
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare("SELECT * FROM clinic_bridge_job WHERE partner_id=? AND status='queued' ORDER BY seq LIMIT 1 FOR UPDATE");
            $q->execute([$agent['partner_id']]);
            $job = $q->fetch(PDO::FETCH_ASSOC);
            if (!$job) { $this->db->commit(); return ['job' => null]; }
            $this->db->prepare("UPDATE clinic_bridge_job SET status='claimed',phase='',agent_id=?,claimed_at=?,heartbeat_at=?,attempts=attempts+1,updated_at=? WHERE id=?")
                ->execute([$agent['id'], $now, $now, $now, $job['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $r = $this->db->prepare('SELECT recipe,version FROM clinic_bridge_recipe WHERE partner_id=? AND kind=?');
        $r->execute([$agent['partner_id'], $job['kind']]);
        $recipe = $r->fetch(PDO::FETCH_ASSOC);
        return ['job' => ['id' => $job['id'], 'kind' => $job['kind'], 'payload' => json_decode($job['payload'], true)],
            'recipe' => $recipe ? json_decode($recipe['recipe'], true) : null];
    }

    /** Aşama bildirimi: "filling" → "submitting" (Kaydet'e basılmak üzere). Geri dönüş yoktur. */
    public function progress(array $agent, object $input, int $now): array
    {
        $job = $this->job($agent['partner_id'], (string)($input->id ?? ''));
        if ($job['status'] !== 'claimed' || $job['agent_id'] !== $agent['id']) throw new RuntimeException('İş bu ajana ait değil.', 409);
        $phase = $input->phase ?? '';
        if (!in_array($phase, ['filling', 'submitting'], true) || ($job['phase'] === 'submitting' && $phase !== 'submitting')) throw new RuntimeException('Aşama geçersiz.', 422);
        $this->db->prepare('UPDATE clinic_bridge_job SET phase=?,heartbeat_at=?,updated_at=? WHERE id=?')->execute([$phase, $now, $now, $job['id']]);
        return ['ok' => true];
    }

    public function result(array $agent, object $input, int $now): array
    {
        $this->db->beginTransaction();
        try {
            $job = $this->job($agent['partner_id'], (string)($input->id ?? ''), true);
            if ($job['status'] !== 'claimed' || $job['agent_id'] !== $agent['id']) throw new RuntimeException('İş bu ajana ait değil.', 409);
            $outcome = $input->outcome ?? '';
            $error = self::text($input->error ?? '', 480);
            if ($outcome === 'done') {
                $number = self::text($input->documentNo ?? '', 64);
                if ($number === '') $outcome = 'uncertain';
                else $this->db->prepare("UPDATE clinic_bridge_job SET status='done',document_no=?,error='',finished_at=?,updated_at=? WHERE id=?")->execute([$number, $now, $now, $job['id']]);
            }
            if ($outcome === 'error') {
                // Kaydet'e basıldıktan sonraki hata ancak Bakanlık ekranı açık bir hata gösterdiyse "kayıt oluşmadı" sayılır.
                if ($job['phase'] === 'submitting' && ($input->rejected ?? false) !== true) $outcome = 'uncertain';
                else $this->db->prepare("UPDATE clinic_bridge_job SET status='error',error=?,finished_at=?,updated_at=? WHERE id=?")->execute([$error ?: 'Gönderilemedi.', $now, $now, $job['id']]);
            }
            if ($outcome === 'retry') {
                if ($job['phase'] === 'submitting') $outcome = 'uncertain';
                else $this->db->prepare("UPDATE clinic_bridge_job SET status='queued',phase='',agent_id=NULL,error=?,updated_at=? WHERE id=?")->execute([$error, $now, $job['id']]);
            }
            if ($outcome === 'uncertain') {
                $this->db->prepare("UPDATE clinic_bridge_job SET status='uncertain',error=?,updated_at=? WHERE id=?")->execute([$error ?: 'Belgenin oluşup oluşmadığı doğrulanamadı.', $now, $job['id']]);
            } elseif (!in_array($outcome, ['done', 'error', 'retry'], true)) {
                throw new RuntimeException('Sonuç geçersiz.', 422);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
        return ['ok' => true, 'status' => $outcome];
    }

    /** Ajan "öğretme modunda" kaydettiği ekran tarifini yükler (adımlar ve alan eşlemeleri). */
    public function saveRecipe(array $agent, object $input, int $now): array
    {
        $kind = $input->kind ?? '';
        if (!in_array($kind, [...self::KINDS, 'session'], true)) throw new RuntimeException('Tarif türü geçersiz.', 422);
        $recipe = $input->recipe ?? null;
        if (!is_object($recipe) || !is_array($recipe->steps ?? null) || count($recipe->steps) < 1 || count($recipe->steps) > 200) throw new RuntimeException('Tarif geçersiz.', 422);
        $allowed = ['goto', 'fill', 'select', 'click', 'check', 'wait', 'submit', 'read', 'repeat', 'end', 'press', 'pick'];
        foreach ($recipe->steps as $step) {
            if (!is_object($step) || !in_array($step->action ?? '', $allowed, true)) throw new RuntimeException('Tarif adımı geçersiz.', 422);
            if (isset($step->url) && (!is_string($step->url) || !preg_match('~\A(https://([a-z0-9-]+\.)+gov\.tr|https?://(127\.0\.0\.1|localhost)(:\d+)?)(/|\z)~i', $step->url))) throw new RuntimeException('Tarif yalnızca gov.tr adreslerine gidebilir.', 422);
        }
        $json = json_encode($recipe, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($json) > 400000) throw new RuntimeException('Tarif çok büyük.', 422);
        $this->db->prepare('INSERT INTO clinic_bridge_recipe(partner_id,kind,recipe,version,updated_at,updated_by) VALUES (?,?,?,1,?,?)
            ON DUPLICATE KEY UPDATE recipe=VALUES(recipe),version=version+1,updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)')
            ->execute([$agent['partner_id'], $kind, $json, $now, 'Ajan · ' . $agent['name']]);
        return ['ok' => true];
    }

    public function recipes(array $agent): array
    {
        $q = $this->db->prepare('SELECT kind,recipe,version FROM clinic_bridge_recipe WHERE partner_id=?');
        $q->execute([$agent['partner_id']]);
        $out = [];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) $out[$row['kind']] = ['version' => (int)$row['version'], 'recipe' => json_decode($row['recipe'], true)];
        return ['recipes' => $out];
    }

    private function audit(array $actor, string $action): void
    {
        try {
            $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$actor['partner_id'], $actor['account_id'] ?? '', $action]);
        } catch (\PDOException) {
        }
    }
}
