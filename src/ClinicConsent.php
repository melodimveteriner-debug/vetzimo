<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Dijital onam formları.
 * - Klinik (yetkili personel) hasta ve sahibi için bir onam metni hazırlar; metin SHA-256 ile mühürlenir.
 * - Hasta sahibi kendi portalında okuyup el imzasıyla onaylar ya da reddeder; klinikte aynı cihazda da imzalanabilir.
 * - İmzalanan ya da reddedilen form değiştirilemez; yalnızca bekleyen form iptal edilebilir.
 */
final class ClinicConsent
{
    private const TYPES = ['surgery', 'stay', 'exam', 'general'];
    private const LIST_FIELDS = 'id,branch_id,customer_id,patient_id,record_type,record_id,title,body_hash,status,created_by,created_at,decided_at,signer_name,signer_channel,note';

    public const LINK_TTL = 259200; // SMS / e-posta ile gönderilen imza bağlantısı 72 saat geçerli
    public const METHODS = ['portal', 'sms', 'whatsapp', 'email', 'clinic', 'in-person'];

    public function __construct(private readonly PDO $db, private readonly string $origin = '', private readonly string $encryptionKey = '') {}

    /** Tek kullanımlık imza bağlantıları tablosu (yoksa ilk kullanımda kurulur; ayrıca SQL çalıştırmak gerekmez). */
    private function linkTable(): void
    {
        $this->db->exec("CREATE TABLE IF NOT EXISTS clinic_consent_link (
            token_hash char(64) CHARACTER SET ascii NOT NULL,
            consent_id char(32) CHARACTER SET ascii NOT NULL,
            partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            method varchar(10) CHARACTER SET ascii NOT NULL,
            target varchar(160) NOT NULL DEFAULT '',
            expires_at int unsigned NOT NULL,
            created_at int unsigned NOT NULL,
            PRIMARY KEY (token_hash),
            KEY clinic_consent_link_consent (consent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    private static function id(mixed $value, string $message = 'Kayıt bilgisi geçersiz.'): string
    {
        if (!is_string($value) || !preg_match('~\A[A-Za-z0-9_-]{1,80}\z~', $value)) throw new RuntimeException($message, 422);
        return $value;
    }

    private static function text(mixed $value, int $max, string $message, bool $multiline = false): string
    {
        if (!is_string($value)) throw new RuntimeException($message, 422);
        $value = str_replace("\r\n", "\n", trim($value));
        $pattern = $multiline ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/' : '/[\x00-\x1F\x7F]/';
        if ($value === '' || mb_strlen($value, 'UTF-8') > $max || preg_match($pattern, $value) || !mb_check_encoding($value, 'UTF-8')) {
            throw new RuntimeException($message, 422);
        }
        return $value;
    }

    public static function hash(string $title, string $body): string
    {
        return hash('sha256', $title . "\n" . $body);
    }

    private function state(array $actor, array $wanted): object
    {
        $records = new ClinicRecords($this->db);
        $state = $records->slice('partner:' . $actor['partner_id'], $wanted)
            ?? (new WorkspaceRepository($this->db))->load('partner:' . $actor['partner_id'])['state'];
        if (!ClinicAccess::valid($actor, $state)) throw new RuntimeException('Klinik erişimi doğrulanamadı.', 403);
        return $state;
    }

    /** Personelin veri şubesi; ana hesap için null (tüm şubeler). */
    private static function dataBranch(object $state, array $actor): ?string
    {
        if ($actor['role'] === 'dealer') return null;
        $branch = ClinicAccess::branch($state, $actor['branch_id']);
        if (!$branch) throw new RuntimeException('Şube doğrulanamadı.', 403);
        return ($branch->sharedWith ?? '') ?: $branch->id;
    }

    private function clinic(array $actor, bool $write): void
    {
        if (!in_array($actor['role'], ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'patients', $write)) {
            throw new RuntimeException('Onam formları için hasta yetkisi gerekli.', 403);
        }
    }

    private function row(string $partner, string $id, bool $lock = false): array
    {
        $q = $this->db->prepare('SELECT * FROM clinic_consent WHERE partner_id=? AND id=?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$partner, $id]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Onam formu bulunamadı.', 404);
        return $row;
    }

    private static function out(array $row, bool $full): array
    {
        $out = [
            'id' => $row['id'], 'branch' => $row['branch_id'], 'customer' => $row['customer_id'], 'patient' => $row['patient_id'],
            'recordType' => $row['record_type'], 'recordId' => $row['record_id'], 'title' => $row['title'], 'hash' => $row['body_hash'],
            'status' => $row['status'], 'createdBy' => $row['created_by'], 'createdAt' => (int)$row['created_at'],
            'decidedAt' => $row['decided_at'] === null ? null : (int)$row['decided_at'], 'signerName' => $row['signer_name'],
            'channel' => $row['signer_channel'], 'note' => $row['note'],
        ];
        if ($full) {
            $out['body'] = $row['body'];
            $out['signature'] = $row['signature'] ?? '';
            $out['intact'] = hash_equals($row['body_hash'], self::hash($row['title'], $row['body']));
            $out['signerIp'] = $row['signer_ip'];
        }
        return $out;
    }

    private function visibleRow(array $actor, string $id, bool $lock = false): array
    {
        $row = $this->row($actor['partner_id'], $id, $lock);
        $state = $this->state($actor, []);
        $branch = self::dataBranch($state, $actor);
        if ($branch !== null && $row['branch_id'] !== $branch) throw new RuntimeException('Onam formu bulunamadı.', 404);
        return $row;
    }

    // ---------------- Klinik tarafı ----------------

    public function list(array $actor, array $query): array
    {
        $this->clinic($actor, false);
        $state = $this->state($actor, []);
        $branch = self::dataBranch($state, $actor);
        $where = ['partner_id=?'];
        $args = [$actor['partner_id']];
        if ($branch !== null) { $where[] = 'branch_id=?'; $args[] = $branch; }
        foreach (['patient' => 'patient_id', 'customer' => 'customer_id'] as $key => $column) {
            if (isset($query[$key]) && $query[$key] !== '') { $where[] = "$column=?"; $args[] = self::id($query[$key]); }
        }
        if (isset($query['record']) && $query['record'] !== '') {
            $where[] = 'record_id=?';
            $args[] = self::id($query['record']);
        }
        if (isset($query['status']) && in_array($query['status'], ['pending', 'signed', 'declined', 'cancelled'], true)) {
            $where[] = 'status=?';
            $args[] = $query['status'];
        }
        $q = $this->db->prepare('SELECT ' . self::LIST_FIELDS . ' FROM clinic_consent WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC, id LIMIT 200');
        $q->execute($args);
        return ['items' => array_map(static fn($row) => self::out($row, false), $q->fetchAll(PDO::FETCH_ASSOC))];
    }

    public function get(array $actor, string $id): array
    {
        if ($actor['role'] === 'customer') return $this->ownerGet($actor, $id);
        $this->clinic($actor, false);
        return self::out($this->visibleRow($actor, self::id($id)), true);
    }

    public function create(array $actor, object $input, int $now): array
    {
        $this->clinic($actor, true);
        $patientId = self::id($input->patient ?? null, 'Hasta seçin.');
        $type = $input->recordType ?? 'general';
        if (!is_string($type) || !in_array($type, self::TYPES, true)) throw new RuntimeException('Onam türü geçersiz.', 422);
        $recordId = ($input->recordId ?? '') === '' ? '' : self::id($input->recordId);
        $title = self::text($input->title ?? null, 200, 'Onam başlığını girin.');
        $body = self::text($input->body ?? null, 20000, 'Onam metnini girin (en çok 20.000 karakter).', true);
        $state = $this->state($actor, ['patients' => [$patientId]]);
        $patient = $state->patients[0] ?? null;
        $branch = self::dataBranch($state, $actor);
        if (!$patient || ($branch !== null && $patient->branch !== $branch)) throw new RuntimeException('Hasta bulunamadı.', 404);
        $owner = (string)($patient->owner ?? '');
        if ($owner === '') throw new RuntimeException('Onam için hastanın sahibi kayıtlı olmalı.', 422);
        $method = $input->method ?? 'portal';
        if (in_array($method, ['sms', 'whatsapp', 'email'], true)) {
            // Gönderim adresi yoksa form hiç oluşturulmadan uyarılır.
            $client = null;
            foreach ($this->state($actor, ['clients' => [$owner]])->clients ?? [] as $c) if (($c->id ?? '') === $owner) $client = $c;
            if ($method === 'email' && !filter_var(is_string($input->email ?? null) && $input->email !== '' ? trim($input->email) : (string)($client->email ?? ''), FILTER_VALIDATE_EMAIL)) {
                throw new RuntimeException('Hasta sahibinin geçerli bir e-posta adresi yok; adresi yazın.', 422);
            }
            if ($method !== 'email' && DealerLogin::normalizePhone((string)($client->phone ?? '')) === '') throw new RuntimeException('Hasta sahibinin geçerli bir cep telefonu yok.', 422);
        }
        $id = bin2hex(random_bytes(16));
        $this->db->prepare('INSERT INTO clinic_consent(id,partner_id,branch_id,customer_id,patient_id,record_type,record_id,title,body,body_hash,status,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, $actor['partner_id'], $patient->branch, $owner, $patientId, $type, $recordId,
            $title, $body, self::hash($title, $body), 'pending', mb_substr((string)($actor['name'] ?? ''), 0, 120, 'UTF-8'), $now]);
        (new DeliveryNotice($this->db))->add($actor['partner_id'], $patient->branch, $owner, 'shares', 'consent:' . $id,
            'İmzanızı bekleyen onam formu: ' . $title, '/hasta-sahibi?onam=' . $id);
        $this->audit($actor, 'consent.create', $id);
        $out = self::out($this->row($actor['partner_id'], $id), true);
        if (!is_string($method) || !in_array($method, self::METHODS, true)) $method = 'portal';
        if (in_array($method, ['sms', 'whatsapp', 'email'], true)) $out['delivery'] = $this->sendLink($actor, $id, $method, $input, $now);
        return $out;
    }

    /** Bekleyen forma SMS / WhatsApp / e-posta ile hesapsız imza bağlantısı gönderir (önceki bağlantılar geçersiz olur). */
    public function sendLink(array $actor, string $id, string $method, object $input, int $now): array
    {
        $this->clinic($actor, true);
        if (!in_array($method, ['sms', 'whatsapp', 'email'], true)) throw new RuntimeException('Gönderim yöntemi geçersiz.', 422);
        $row = $this->visibleRow($actor, self::id($id));
        if ($row['status'] !== 'pending') throw new RuntimeException('Yalnızca imza bekleyen form gönderilebilir.', 409);
        $state = $this->state($actor, ['clients' => [$row['customer_id']]]);
        $client = null;
        foreach ($state->clients ?? [] as $c) if (($c->id ?? '') === $row['customer_id']) $client = $c;
        if (!$client) throw new RuntimeException('Hasta sahibi bulunamadı.', 404);
        $clinic = (string)($this->db->query('SELECT name FROM partner_account WHERE id=' . $this->db->quote($actor['partner_id']))->fetchColumn() ?: 'Kliniğiniz');
        if ($method === 'email') {
            $target = is_string($input->email ?? null) && $input->email !== '' ? trim($input->email) : (string)($client->email ?? '');
            if (strlen($target) > 160 || !filter_var($target, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Hasta sahibinin geçerli bir e-posta adresi yok; adresi yazın.', 422);
        } else {
            $target = DealerLogin::normalizePhone((string)($client->phone ?? ''));
            if ($target === '') throw new RuntimeException('Hasta sahibinin geçerli bir cep telefonu yok.', 422);
        }
        $token = ClientPermit::shortToken();
        try { $this->storeLink($token, $row, $method, $target, $now); }
        catch (\PDOException $e) { if ($e->getCode() !== '42S02') throw $e; $this->linkTable(); $this->storeLink($token, $row, $method, $target, $now); }
        $full = rtrim($this->origin, '/') . '/k/' . $token;
        $short = preg_replace('~\Ahttps://~', '', $full);
        $text = $clinic . ': "' . $row['title'] . '" onam formunu okuyup imzalamanız için: ' . $short . ' (72 saat geçerli)';
        $result = ['method' => $method, 'url' => $full, 'status' => 'manual', 'share' => $text];
        if ($method === 'email') {
            try {
                (new Notifications($this->db, $this->encryptionKey))->send('smtp', $target, $clinic . ' · Onam formu imzanızı bekliyor',
                    "Sayın " . ($client->name ?? 'hasta sahibimiz') . ",\n\n" . $row['title'] . " formunu okuyup imzalamak için bağlantıyı açın (72 saat geçerli):\n\n" . $full . "\n\n" . $clinic);
                $result['status'] = 'email_sent';
            } catch (\Throwable) { $result['status'] = 'email_failed'; }
        } else {
            $gateway = new PhoneGateway($this->db);
            $route = $gateway->route($actor['partner_id'], $method);
            if ($route) {
                $gateway->enqueue($actor['partner_id'], $method, $target, $text, 'manual', 'consent:' . $row['id'] . ':' . $now, 0, $now, $now + self::LINK_TTL, (string)($actor['name'] ?? ''));
                $result['status'] = $method === 'whatsapp' && $route === 'assist' ? 'assist' : 'queued';
            }
            $result['whatsappLink'] = PhoneGateway::waLink($target, $text);
        }
        $this->audit($actor, 'consent.send.' . $method, $row['id']);
        return $result;
    }

    private function storeLink(string $token, array $row, string $method, string $target, int $now): void
    {
        $this->db->prepare('DELETE FROM clinic_consent_link WHERE consent_id=?')->execute([$row['id']]);
        $this->db->prepare('INSERT INTO clinic_consent_link(token_hash,consent_id,partner_id,method,target,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
            ->execute([hash('sha256', $token), $row['id'], $row['partner_id'], $method, mb_substr($target, 0, 160), $now + self::LINK_TTL, $now]);
    }

    // ---------------- Hesapsız imza bağlantısı (/k/…) ----------------

    private function byToken(string $token, int $now, bool $lock = false): array
    {
        if (!preg_match('/\A[A-Za-z0-9]{10}\z/', $token)) throw new RuntimeException('Bağlantı geçersiz.', 404);
        try {
            $q = $this->db->prepare('SELECT * FROM clinic_consent_link WHERE token_hash=?' . ($lock ? ' FOR UPDATE' : ''));
            $q->execute([hash('sha256', $token)]);
            $link = $q->fetch(PDO::FETCH_ASSOC);
        } catch (\PDOException) { $link = false; }
        if (!$link) throw new RuntimeException('Bağlantı geçersiz veya kullanılmış.', 404);
        if ((int)$link['expires_at'] < $now) throw new RuntimeException('Bağlantının süresi doldu. Kliniğinizden yeni bağlantı isteyin.', 410);
        $row = $this->row($link['partner_id'], $link['consent_id'], $lock);
        if ($row['status'] !== 'pending') throw new RuntimeException('Bu form zaten yanıtlanmış veya iptal edilmiş.', 410);
        return ['link' => $link, 'row' => $row];
    }

    /** Bağlantıyla açılan sayfa için formun metni (yalnız bekleyen form). */
    public function openLink(string $token, int $now): array
    {
        ['row' => $row] = $this->byToken($token, $now);
        $clinic = (string)($this->db->query('SELECT name FROM partner_account WHERE id=' . $this->db->quote($row['partner_id']))->fetchColumn() ?: '');
        return ['clinic' => $clinic, 'title' => $row['title'], 'body' => $row['body'], 'hash' => $row['body_hash']];
    }

    public function decideLink(string $token, object $input, int $now, array $server): array
    {
        ['link' => $link, 'row' => $first] = $this->byToken($token, $now);
        $input->agree = ($input->read ?? $input->agree ?? false) === true;
        $actor = ['partner_id' => $first['partner_id'], 'account_id' => '', 'name' => ''];
        $out = $this->decide($actor, $first['id'], $input, $now, $server, $link['method'],
            function (bool $lock) use ($token, $now) { return $this->byToken($token, $now, $lock)['row']; });
        $this->db->prepare('DELETE FROM clinic_consent_link WHERE consent_id=?')->execute([$first['id']]);
        return ['status' => $out['status']];
    }

    /** Hesapsız imza sayfası (permit-sign.js ve permit-sign.css ile aynı imza alanı). */
    public static function linkPage(array $doc): string
    {
        $e = static fn(string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
        return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">'
            . '<title>' . $e($doc['title']) . '</title><link rel="stylesheet" href="/permit-sign.css?v=2"></head><body><main class="pm">'
            . '<header class="pm-head"><span class="pm-badge">' . $e($doc['clinic']) . '</span><h1>' . $e($doc['title']) . '</h1>'
            . '<p>Formu okuyup onaylıyorsanız adınızı yazın ve imza alanına imzanızı atın.</p></header>'
            . '<section class="pm-card"><div class="pm-text" dir="auto" style="white-space:pre-wrap">' . $e($doc['body']) . '</div></section>'
            . '<form class="pm-card pm-form" id="pmForm" data-hash="' . $e($doc['hash']) . '" data-kind="consent" novalidate>'
            . '<label class="pm-choice pm-read"><input type="checkbox" name="read" required><span>Formu okudum, anladım. Bilgilendirildiğimi ve onay verdiğimi beyan ederim.</span></label>'
            . '<label class="pm-field">Adınız ve soyadınız<input name="signerName" autocomplete="name" maxlength="120" required></label>'
            . '<div class="pm-sign"><canvas id="pmPad" width="900" height="300" aria-label="İmza alanı"></canvas><button type="button" id="pmClear" class="pm-link">İmzayı temizle</button><span class="pm-hint">Parmağınızla veya kalemle imzanızı atın</span></div>'
            . '<p class="pm-error" id="pmError" role="alert"></p>'
            . '<div class="pm-actions"><button type="submit" class="pm-primary">Onayla ve imzala</button><button type="button" id="pmDecline" class="pm-secondary">Onay vermiyorum</button></div>'
            . '<p class="pm-muted">Belge kimliği: <code>' . $e(substr($doc['hash'], 0, 16)) . '</code> · İmzaladığınızda tarih, saat ve cihaz bilgisi kayıt altına alınır.</p></form>'
            . '<section class="pm-card pm-done" id="pmDone" hidden><h2>Teşekkürler</h2><p id="pmDoneText"></p></section>'
            . '<script src="/permit-sign.js?v=2" type="module"></script></main></body></html>';
    }

    public function cancel(array $actor, string $id, int $now): array
    {
        $this->clinic($actor, true);
        $this->db->beginTransaction();
        try {
            $row = $this->visibleRow($actor, self::id($id), true);
            if ($row['status'] !== 'pending') throw new RuntimeException('Yalnızca imza bekleyen form iptal edilebilir.', 409);
            $this->db->prepare("UPDATE clinic_consent SET status='cancelled',decided_at=?,note=? WHERE id=?")
                ->execute([$now, mb_substr('İptal: ' . ($actor['name'] ?? ''), 0, 500, 'UTF-8'), $row['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $this->audit($actor, 'consent.cancel', $id);
        return self::out($this->row($actor['partner_id'], $id), true);
    }

    /** Klinikte, aynı cihazda hasta sahibinin imzası. */
    public function signInClinic(array $actor, string $id, object $input, int $now, array $server): array
    {
        $this->clinic($actor, true);
        // Yüz yüze: personel kimliği gördüğünü onaylar; kayıtta "yüz yüze" ve doğrulayan personel görünür.
        $inPerson = ($input->inPerson ?? false) === true;
        if ($inPerson && ($input->verifiedInPerson ?? false) !== true) throw new RuntimeException('Yüz yüze imzada kimliği doğruladığınızı işaretleyin.', 422);
        if ($inPerson) $input->reason = $input->reason ?? '';
        $out = $this->decide($actor, $id, $input, $now, $server, $inPerson ? 'in-person' : 'clinic', fn(bool $lock) => $this->visibleRow($actor, self::id($id), $lock));
        if ($inPerson) {
            $this->db->prepare('UPDATE clinic_consent SET note=? WHERE id=?')->execute([mb_substr('Kimlik yüz yüze doğrulandı: ' . ($actor['name'] ?? ''), 0, 500, 'UTF-8'), $out['id']]);
            $out['note'] = 'Kimlik yüz yüze doğrulandı: ' . ($actor['name'] ?? '');
        }
        return $out;
    }

    // ---------------- Hasta sahibi tarafı ----------------

    private function ownerScope(array $actor): string
    {
        if ($actor['role'] !== 'customer') throw new RuntimeException('Hasta sahibi hesabı gerekli.', 403);
        $state = $this->state($actor, ['clients' => [(string)$actor['customer_id']]]);
        $branch = ClinicAccess::branch($state, $actor['branch_id']);
        return ($branch->sharedWith ?? '') ?: $branch->id;
    }

    private function ownerRow(array $actor, string $id, bool $lock = false): array
    {
        $branch = $this->ownerScope($actor);
        $row = $this->row($actor['partner_id'], self::id($id), $lock);
        if ($row['customer_id'] !== $actor['customer_id'] || $row['branch_id'] !== $branch || $row['status'] === 'cancelled') {
            throw new RuntimeException('Onam formu bulunamadı.', 404);
        }
        return $row;
    }

    public function ownerList(array $actor): array
    {
        $branch = $this->ownerScope($actor);
        $q = $this->db->prepare('SELECT ' . self::LIST_FIELDS . " FROM clinic_consent WHERE partner_id=? AND customer_id=? AND branch_id=? AND status<>'cancelled' ORDER BY status='pending' DESC, created_at DESC LIMIT 100");
        $q->execute([$actor['partner_id'], $actor['customer_id'], $branch]);
        return array_map(static fn($row) => self::out($row, false), $q->fetchAll(PDO::FETCH_ASSOC));
    }

    private function ownerGet(array $actor, string $id): array
    {
        return self::out($this->ownerRow($actor, $id), true);
    }

    public function ownerDecide(array $actor, string $id, object $input, int $now, array $server): array
    {
        return $this->decide($actor, $id, $input, $now, $server, 'portal', fn(bool $lock) => $this->ownerRow($actor, $id, $lock));
    }

    private function decide(array $actor, string $id, object $input, int $now, array $server, string $channel, callable $load): array
    {
        $decision = $input->decision ?? 'sign';
        if (!in_array($decision, ['sign', 'decline'], true)) throw new RuntimeException('İşlem geçersiz.', 422);
        $name = self::text($input->signerName ?? null, 120, 'Adınızı ve soyadınızı yazın.');
        if (mb_strlen($name, 'UTF-8') < 3) throw new RuntimeException('Adınızı ve soyadınızı yazın.', 422);
        $signature = null;
        $note = '';
        if ($decision === 'sign') {
            if (($input->agree ?? false) !== true) throw new RuntimeException('Metni okuduğunuzu onaylayın.', 422);
            $signature = $input->signature ?? null;
            if (!is_string($signature) || strlen($signature) > 400000 || !preg_match('~\Adata:image/png;base64,([A-Za-z0-9+/=]+)\z~D', $signature, $parts)) {
                throw new RuntimeException('Lütfen imza alanına imzanızı atın.', 422);
            }
            $bytes = base64_decode($parts[1], true);
            $info = $bytes === false ? false : @getimagesizefromstring($bytes);
            if (!$info || $info['mime'] !== 'image/png' || $info[0] > 2400 || $info[1] > 1200 || $info[0] < 100) {
                throw new RuntimeException('İmza görseli geçersiz.', 422);
            }
            if (($input->hash ?? '') === '' || !is_string($input->hash)) throw new RuntimeException('Belge sürümü doğrulanamadı.', 422);
        } else {
            $note = isset($input->reason) && $input->reason !== '' ? self::text($input->reason, 500, 'Açıklama en çok 500 karakter olabilir.') : '';
        }
        $this->db->beginTransaction();
        try {
            $row = $load(true);
            if ($row['status'] !== 'pending') throw new RuntimeException('Bu form zaten yanıtlanmış.', 409);
            if (!hash_equals($row['body_hash'], self::hash($row['title'], $row['body']))) throw new RuntimeException('Belge bütünlüğü doğrulanamadı.', 409);
            if ($decision === 'sign' && !hash_equals($row['body_hash'], (string)$input->hash)) {
                throw new RuntimeException('Form siz okurken değişti; lütfen sayfayı yenileyin.', 409);
            }
            $agent = mb_substr(preg_replace('/[\x00-\x1F\x7F]/', '', (string)($server['HTTP_USER_AGENT'] ?? '')), 0, 255, 'UTF-8');
            $ip = substr(preg_replace('/[^0-9a-fA-F:.]/', '', (string)($server['REMOTE_ADDR'] ?? '')), 0, 64);
            $this->db->prepare('UPDATE clinic_consent SET status=?,decided_at=?,signer_name=?,signer_channel=?,signer_ip=?,signer_agent=?,signature=?,note=? WHERE id=?')
                ->execute([$decision === 'sign' ? 'signed' : 'declined', $now, $name, $channel, $ip, $agent, $signature, $note, $row['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $this->audit($actor, 'consent.' . $decision, $id);
        return self::out($this->row($actor['partner_id'], $id), true);
    }

    private function audit(array $actor, string $action, string $id): void
    {
        try {
            $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')
                ->execute([$actor['partner_id'], $actor['account_id'] ?? '', $action . ':' . $id]);
        } catch (\PDOException) {
            // Denetim kaydı yazılamazsa işlem yine tamamlanır.
        }
    }
}
