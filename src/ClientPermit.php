<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Müşteri (hayvan sahibi) KVKK aydınlatması ve iletişim izinleri onay formu.
 * - Klinik formu oluşturur; metin o anki haliyle mühürlenir (SHA-256) ve değiştirilemez.
 * - Hayvan sahibi tek kullanımlık bağlantıyla (SMS/WhatsApp) kendi telefonunda ya da klinikte tablette okuyup el imzasıyla onaylar.
 * - Her iletişim izni ayrı ayrı ve boş (işaretsiz) gelir; KVKK açık rızası ve ticari ileti onayı serbest iradeyle verilir.
 * - İmzalı son form; hatırlatma ve toplu mesajlarda müşterinin SMS/WhatsApp/e-posta izni olarak esas alınır.
 */
final class ClientPermit
{
    public const CHOICES = ['sms' => 'SMS ile bilgilendirme ve hatırlatma', 'whatsapp' => 'WhatsApp ile bilgilendirme ve hatırlatma', 'email' => 'E-posta ile bilgilendirme ve hatırlatma',
        'marketing' => 'Kampanya, indirim ve tanıtım iletileri (ticari elektronik ileti)'];
    private const TTL = 72 * 3600;

    public function __construct(private readonly PDO $db, private readonly string $origin = '') {}

    private static function hash(string $v): string { return hash('sha256', $v); }

    /** SMS karakter sınırı için kısa, tek kullanımlık anahtar: 10 karakter (62^10 olasılık; 72 saat geçerli, deneme sınırlı). */
    public static function shortToken(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        $out = '';
        for ($i = 0; $i < 10; $i++) $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        return $out;
    }

    /** SMS'te yer kaplamasın diye "https://" yazılmaz; telefonlar www.… adresini bağlantı olarak tanır. */
    public static function shortUrl(string $origin, string $token): string
    {
        return preg_replace('~\Ahttps://~', '', rtrim($origin, '/')).'/o/'.$token;
    }

    private static function guard(array $actor, bool $write): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'clients', $write)) {
            throw new RuntimeException($write ? 'Onay formu için müşteri yazma yetkisi gerekir.' : 'Onay formları için müşteri yetkisi gerekir.', 403);
        }
    }

    // ───────────────────────────── metin ─────────────────────────────
    public static function defaultNotice(): string
    {
        return <<<'TXT'
## Veri sorumlusu
Kişisel verileriniz ve evcil hayvanınıza ait kayıtlar, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu sıfatıyla **{klinik}** tarafından işlenir. Adres: {adres} · Telefon: {telefon} · E-posta: {eposta}

## İşlenen veriler
- Kimlik ve iletişim: ad soyad, telefon, e-posta, adres; fatura gerekirse T.C. kimlik numarası.
- Hayvanınıza ait kayıtlar: tür, ırk, mikroçip ve pasaport bilgisi, muayene, aşı, tedavi, laboratuvar ve görüntüleme kayıtları.
- Müşteri işlem bilgileri: randevu, ödeme, borç-alacak ve yazışma kayıtları.

## İşleme amaçları ve hukuki sebepler
- Veteriner hekimlik hizmetinin sunulması, randevu ve tedavi takibi (KVKK m.5/2-c, sözleşmenin ifası).
- Aşı ve kimlik kayıtlarının ilgili kamu sistemlerine bildirilmesi, faturalama ve mevzuattan doğan saklama yükümlülükleri (KVKK m.5/2-ç).
- Bir hakkın tesisi, kullanılması veya korunması (KVKK m.5/2-e).
- Randevu, aşı ve tedavi hatırlatmalarının SMS, WhatsApp veya e-posta ile gönderilmesi ile kampanya ve tanıtım iletileri: yalnızca aşağıda ayrı ayrı vereceğiniz onaya dayanır (KVKK m.5/1 ve 6563 sayılı Kanun).

## Aktarım
Verileriniz; klinik yazılımı ve barındırma hizmeti alınan Vetzimo.com (veri işleyen), mesaj gönderiminde kullanılan iletişim altyapıları, yasal zorunluluk hâlinde yetkili kamu kurumları ile sınırlı olarak paylaşılabilir. WhatsApp ile iletişimi seçerseniz mesajlar WhatsApp altyapısı üzerinden iletilir.

## Saklama
Kayıtlar, hizmet ilişkisi süresince ve mevzuatta öngörülen süreler boyunca saklanır; süre sonunda silinir veya anonim hâle getirilir.

## Haklarınız
KVKK m.11 uyarınca verilerinize erişme, düzeltilmesini veya silinmesini isteme, işlemeye itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Taleplerinizi yukarıdaki iletişim bilgileriyle kliniğe iletebilirsiniz. İletişim izinlerinizi dilediğiniz zaman, ücretsiz olarak ve gerekçe göstermeden geri alabilirsiniz; her iletinin içinde ret yolu bulunur.
TXT;
    }

    public function notice(string $partner): array
    {
        $q = $this->db->prepare('SELECT notice,updated_at FROM clinic_permit_setting WHERE partner_id=?');
        $q->execute([$partner]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        return ['text' => $row['notice'] ?? self::defaultNotice(), 'custom' => (bool)$row, 'updatedAt' => $row ? (int)$row['updated_at'] : null, 'default' => self::defaultNotice()];
    }

    public function saveNotice(array $actor, mixed $text, int $now): array
    {
        self::guard($actor, true);
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Aydınlatma metnini yalnızca klinik yöneticisi değiştirebilir.', 403);
        if ($text === null || $text === '') {
            $this->db->prepare('DELETE FROM clinic_permit_setting WHERE partner_id=?')->execute([$actor['partner_id']]);
            return $this->notice($actor['partner_id']);
        }
        if (!is_string($text) || mb_strlen(trim($text)) < 200 || strlen($text) > 60000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $text)) {
            throw new RuntimeException('Aydınlatma metni 200 karakterden kısa veya geçersiz olamaz.', 422);
        }
        $this->db->prepare('INSERT INTO clinic_permit_setting (partner_id,notice,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE notice=VALUES(notice),updated_at=VALUES(updated_at)')
            ->execute([$actor['partner_id'], str_replace("\r\n", "\n", trim($text)), $now]);
        return $this->notice($actor['partner_id']);
    }

    /** Onaya sunulan belgenin anlık görüntüsü: klinik bilgisi, aydınlatma metni, platform metinlerinin sürümleri ve izin seçenekleri. */
    private function document(array $actor, object $state, object $client, int $now): array
    {
        $p = $state->preferences ?? (object)[];
        $branch = ClinicAccess::branch($state, $client->branch ?? '');
        $clinic = trim((string)($p->clinic ?? '')) ?: (string)($branch->name ?? 'Klinik');
        $fields = ['klinik' => $clinic, 'adres' => trim((string)($p->address ?? '')) ?: '-', 'telefon' => trim((string)($p->phone ?? '')) ?: '-', 'eposta' => trim((string)($p->email ?? '')) ?: '-'];
        $notice = strtr($this->notice($actor['partner_id'])['text'], array_combine(array_map(static fn($k) => '{'.$k.'}', array_keys($fields)), array_values($fields)));
        $platform = [];
        if (class_exists(SiteLegal::class)) {
            $legal = new SiteLegal($this->db);
            foreach (SiteLegal::DOCS as $slug => $title) {
                if ($slug === DealerAgreement::SLUG) continue; // bayi sözleşmesi hasta sahibine gösterilmez
                $doc = $legal->doc($slug);
                $platform[] = ['slug' => $slug, 'title' => $doc['title'], 'version' => $doc['version'], 'date' => $doc['effective_on'], 'url' => $this->origin.'/platform/yasal/'.$slug,
                    'hash' => self::hash($doc['title']."\n".$doc['body'])];
            }
        }
        return ['title' => $clinic.' · Kişisel Veriler ve İletişim İzinleri Onay Formu', 'clinic' => $fields, 'client' => (string)($client->name ?? ''), 'phone' => (string)($client->phone ?? ''),
            'notice' => $notice, 'platform' => $platform, 'choices' => self::CHOICES, 'createdAt' => $now,
            'declaration' => 'Bu formu okuduğumu ve anladığımı; verdiğim kimlik ve iletişim bilgilerinin bana ait ve doğru olduğunu, değişiklikleri kliniğe bildirmekle yükümlü olduğumu; yukarıda işaretlediğim iletişim izinlerini özgür irademle verdiğimi ve dilediğim zaman geri alabileceğimi beyan ederim.'];
    }

    // ───────────────────────────── klinik tarafı ─────────────────────────────
    private function client(array $actor, string $id): array
    {
        if (!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $id)) throw new RuntimeException('Müşteri bulunamadı.', 404);
        $state = (new ClinicRecords($this->db))->slice('partner:'.$actor['partner_id'], ['clients' => [$id]])
            ?? (new WorkspaceRepository($this->db))->load('partner:'.$actor['partner_id'])['state'];
        $client = null;
        foreach ($state->clients ?? [] as $c) if (($c->id ?? '') === $id) { $client = $c; break; }
        if (!$client) throw new RuntimeException('Müşteri bulunamadı. Önce müşteriyi kaydedin.', 404);
        if (($actor['role'] ?? '') !== 'dealer') {
            $branch = ClinicAccess::branch($state, $actor['branch_id'] ?? '');
            if (!$branch || (($branch->sharedWith ?? '') ?: $branch->id) !== $client->branch) throw new RuntimeException('Müşteri bulunamadı.', 404);
        }
        return [$state, $client];
    }

    public static function out(array $r, bool $full = false): array
    {
        $out = ['id' => $r['id'], 'client' => $r['client_id'], 'clientName' => $r['client_name'], 'phone' => $r['phone'], 'status' => $r['status'], 'method' => $r['method'],
            'choices' => json_decode((string)$r['choices'], true) ?: null, 'signer' => $r['signer_name'], 'createdBy' => $r['created_by'], 'createdAt' => (int)$r['created_at'],
            'openedAt' => $r['opened_at'] === null ? null : (int)$r['opened_at'], 'decidedAt' => $r['decided_at'] === null ? null : (int)$r['decided_at'],
            'expiresAt' => (int)$r['expires_at'], 'applied' => $r['applied_at'] !== null, 'hash' => $r['doc_hash']];
        if ($full) $out += ['doc' => json_decode((string)$r['doc'], true), 'signature' => $r['signature'], 'ip' => $r['signer_ip'], 'agent' => $r['signer_agent']];
        return $out;
    }

    private function sweep(string $partner, int $now): void
    {
        $this->db->prepare("UPDATE clinic_client_permit SET status='expired',token_hash=NULL WHERE partner_id=? AND status='pending' AND expires_at<?")->execute([$partner, $now]);
    }

    public function forClient(array $actor, string $client, int $now): array
    {
        self::guard($actor, false);
        $this->client($actor, $client);
        $this->sweep($actor['partner_id'], $now);
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE partner_id=? AND client_id=? ORDER BY created_at DESC LIMIT 20');
        $q->execute([$actor['partner_id'], $client]);
        $rows = array_map(static fn($r) => self::out($r), $q->fetchAll(PDO::FETCH_ASSOC));
        $signed = array_values(array_filter($rows, static fn($r) => in_array($r['status'], ['signed', 'declined'], true)));
        return ['permits' => $rows, 'effective' => $signed[0] ?? null, 'channels' => $this->channels($actor['partner_id'])];
    }

    public function list(array $actor, string $status, int $now): array
    {
        self::guard($actor, false);
        $this->sweep($actor['partner_id'], $now);
        $where = in_array($status, ['pending', 'signed', 'declined', 'expired', 'cancelled'], true) ? ' AND status=?' : '';
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE partner_id=?'.$where.' ORDER BY created_at DESC LIMIT 300');
        $q->execute($where ? [$actor['partner_id'], $status] : [$actor['partner_id']]);
        $c = $this->db->prepare('SELECT status,COUNT(*) FROM clinic_client_permit WHERE partner_id=? GROUP BY status');
        $c->execute([$actor['partner_id']]);
        return ['permits' => array_map(static fn($r) => self::out($r), $q->fetchAll(PDO::FETCH_ASSOC)), 'counts' => array_map('intval', $c->fetchAll(PDO::FETCH_KEY_PAIR))];
    }

    /** Bağlantı hangi kanallardan gönderilebilir? (Telefon Bağlantısı) */
    private function channels(string $partner): array
    {
        $gateway = class_exists(PhoneGateway::class) ? new PhoneGateway($this->db) : null;
        return ['sms' => $gateway ? (bool)$gateway->route($partner, 'sms') : false, 'whatsapp' => $gateway ? $gateway->route($partner, 'whatsapp') : false];
    }

    public function create(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $method = $input->method ?? 'link';
        if (!in_array($method, ['sms', 'whatsapp', 'link', 'clinic'], true)) throw new RuntimeException('Gönderim yöntemi geçersiz.', 422);
        [$state, $client] = $this->client($actor, (string)($input->client ?? ''));
        $phone = DealerLogin::normalizePhone((string)($client->phone ?? ''));
        if (in_array($method, ['sms', 'whatsapp'], true) && $phone === '') throw new RuntimeException('Müşterinin geçerli bir cep telefonu yok.', 422);
        // Aynı müşteriye bekleyen eski bağlantılar geçersizleşir; tek geçerli bağlantı kalır.
        $this->db->prepare("UPDATE clinic_client_permit SET status='cancelled',token_hash=NULL WHERE partner_id=? AND client_id=? AND status='pending'")->execute([$actor['partner_id'], $client->id]);
        $doc = $this->document($actor, $state, $client, $now);
        $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $token = self::shortToken();
        $id = bin2hex(random_bytes(16));
        $this->db->prepare('INSERT INTO clinic_client_permit (id,partner_id,branch_id,client_id,client_name,phone,token_hash,expires_at,status,method,doc,doc_hash,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $actor['partner_id'], $client->branch, $client->id, mb_substr((string)($client->name ?? ''), 0, 160), $phone, self::hash($token), $now + self::TTL, 'pending', $method, $json, self::hash($json),
                mb_substr((string)($actor['name'] ?? ''), 0, 120), $now]);
        $url = self::shortUrl($this->origin, $token);
        $sent = null;
        if (in_array($method, ['sms', 'whatsapp'], true) && empty($input->silent)) {
            $route = $this->channels($actor['partner_id'])[$method];
            $text = $doc['clinic']['klinik'].': Kişisel verileriniz ve iletişim izinleriniz için onay formunuz: '.$url.' (72 saat geçerlidir)';
            if ($route) {
                (new PhoneGateway($this->db))->enqueue($actor['partner_id'], $method, $phone, $text, 'manual', 'permit:'.$id, 0, $now, $now + self::TTL, (string)($actor['name'] ?? ''));
                $sent = $method === 'whatsapp' && $route === 'assist' ? 'assist' : 'queued';
            } else {
                $sent = 'manual';
            }
        }
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE id=?');
        $q->execute([$id]);
        return ['permit' => self::out($q->fetch(PDO::FETCH_ASSOC)), 'url' => $url, 'sent' => $sent,
            'whatsappLink' => $phone !== '' ? PhoneGateway::waLink($phone, $doc['clinic']['klinik'].': Onay formunuz: '.$url) : null];
    }

    public function act(array $actor, object $input, int $now): array
    {
        $action = (string)($input->action ?? '');
        if ($action === 'create') return $this->create($actor, $input, $now);
        if ($action === 'notice') return $this->saveNotice($actor, $input->text ?? null, $now);
        self::guard($actor, true);
        $id = $input->id ?? '';
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new RuntimeException('Form bulunamadı.', 404);
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE id=? AND partner_id=?');
        $q->execute([$id, $actor['partner_id']]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Form bulunamadı.', 404);
        $this->client($actor, $row['client_id']);
        if ($action === 'cancel') {
            if ($row['status'] !== 'pending') throw new RuntimeException('Yalnızca bekleyen form iptal edilebilir.', 409);
            $this->db->prepare("UPDATE clinic_client_permit SET status='cancelled',token_hash=NULL WHERE id=?")->execute([$id]);
        } elseif ($action === 'applied') {
            // Klinik uygulaması imzalı izinleri müşteri kartına işledi.
            if (!in_array($row['status'], ['signed', 'declined'], true)) throw new RuntimeException('Form henüz yanıtlanmadı.', 409);
            $this->db->prepare('UPDATE clinic_client_permit SET applied_at=COALESCE(applied_at,?) WHERE id=?')->execute([$now, $id]);
        } else {
            throw new RuntimeException('İşlem geçersiz.', 422);
        }
        $q->execute([$id, $actor['partner_id']]);
        return ['permit' => self::out($q->fetch(PDO::FETCH_ASSOC))];
    }

    public function signedDocument(array $actor, string $id): array
    {
        self::guard($actor, false);
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE id=? AND partner_id=?');
        $q->execute([$id, $actor['partner_id']]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Form bulunamadı.', 404);
        $this->client($actor, $row['client_id']);
        return self::out($row, true);
    }

    // ───────────────────────────── hayvan sahibi tarafı (tek kullanımlık bağlantı) ─────────────────────────────
    private function byToken(string $token, bool $lock = false): array
    {
        if (!preg_match('/\A(?:[A-Za-z0-9]{10}|[A-Za-z0-9_-]{32})\z/', $token)) throw new RuntimeException('Bağlantı geçersiz.', 404);
        $q = $this->db->prepare('SELECT * FROM clinic_client_permit WHERE token_hash=?'.($lock ? ' FOR UPDATE' : ''));
        $q->execute([self::hash($token)]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Bu bağlantı kullanılmış, iptal edilmiş veya süresi dolmuş. Yeni bağlantı için kliniğe başvurun.', 404);
        if ((int)$row['expires_at'] < time() || $row['status'] !== 'pending') throw new RuntimeException('Bu bağlantının süresi dolmuş. Yeni bağlantı için kliniğe başvurun.', 410);
        return $row;
    }

    public function open(string $token, int $now): array
    {
        $row = $this->byToken($token);
        if ($row['opened_at'] === null) $this->db->prepare('UPDATE clinic_client_permit SET opened_at=? WHERE id=?')->execute([$now, $row['id']]);
        $doc = json_decode((string)$row['doc'], true);
        return ['doc' => $doc, 'hash' => $row['doc_hash'], 'expiresAt' => (int)$row['expires_at'], 'maskedPhone' => $row['phone'] !== '' ? substr($row['phone'], 0, 6).' ••• •• '.substr($row['phone'], -2) : ''];
    }

    public function decide(string $token, object $input, int $now, array $server): array
    {
        $decision = $input->decision ?? 'sign';
        if (!in_array($decision, ['sign', 'decline'], true)) throw new RuntimeException('İşlem geçersiz.', 422);
        $name = is_string($input->signerName ?? null) ? trim(preg_replace('/\s+/u', ' ', $input->signerName) ?? '') : '';
        if (mb_strlen($name) < 3 || mb_strlen($name) > 120 || preg_match('/[\x00-\x1F<>]/', $name)) throw new RuntimeException('Adınızı ve soyadınızı yazın.', 422);
        $choices = [];
        foreach (array_keys(self::CHOICES) as $k) $choices[$k] = $decision === 'sign' && (($input->choices->$k ?? false) === true);
        $signature = null;
        if ($decision === 'sign') {
            if (($input->read ?? false) !== true) throw new RuntimeException('Aydınlatma metnini okuduğunuzu onaylayın.', 422);
            $signature = $input->signature ?? null;
            if (!is_string($signature) || strlen($signature) > 400000 || !preg_match('~\Adata:image/png;base64,([A-Za-z0-9+/=]+)\z~D', $signature, $parts)) throw new RuntimeException('Lütfen imza alanına imzanızı atın.', 422);
            $bytes = base64_decode($parts[1], true);
            $info = $bytes === false ? false : @getimagesizefromstring($bytes);
            if (!$info || $info['mime'] !== 'image/png' || $info[0] > 2400 || $info[1] > 1200 || $info[0] < 100) throw new RuntimeException('İmza görseli geçersiz.', 422);
            if (strlen($bytes) < 600) throw new RuntimeException('İmza çok kısa görünüyor; lütfen imzanızı atın.', 422);
        }
        $this->db->beginTransaction();
        try {
            $row = $this->byToken($token, true);
            if (!hash_equals($row['doc_hash'], self::hash((string)$row['doc']))) throw new RuntimeException('Belge bütünlüğü doğrulanamadı.', 409);
            if (!is_string($input->hash ?? null) || !hash_equals($row['doc_hash'], $input->hash)) throw new RuntimeException('Form siz okurken değişti; sayfayı yenileyin.', 409);
            $agent = mb_substr(preg_replace('/[\x00-\x1F\x7F]/', '', (string)($server['HTTP_USER_AGENT'] ?? '')) ?? '', 0, 255);
            $ip = substr(preg_replace('/[^0-9a-fA-F:.]/', '', (string)($server['REMOTE_ADDR'] ?? '')) ?? '', 0, 64);
            $this->db->prepare('UPDATE clinic_client_permit SET status=?,token_hash=NULL,choices=?,signer_name=?,signer_ip=?,signer_agent=?,signature=?,decided_at=? WHERE id=?')
                ->execute([$decision === 'sign' ? 'signed' : 'declined', json_encode($choices), $name, $ip, $agent, $signature, $now, $row['id']]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        return ['ok' => true, 'status' => $decision === 'sign' ? 'signed' : 'declined', 'choices' => $choices];
    }

    // ───────────────────────────── gönderimde esas alınan izinler ─────────────────────────────
    /** Müşterilerin bellekteki kopyasına son imzalı formdaki izinleri uygular (kayıt değiştirilmez). */
    public function overlay(string $partner, iterable $clients): void
    {
        try {
            $q = $this->db->prepare("SELECT p.client_id,p.status,p.choices FROM clinic_client_permit p
                JOIN (SELECT client_id,MAX(decided_at) d FROM clinic_client_permit WHERE partner_id=? AND status IN ('signed','declined') GROUP BY client_id) l
                ON l.client_id=p.client_id AND l.d=p.decided_at WHERE p.partner_id=? AND p.status IN ('signed','declined')");
            $q->execute([$partner, $partner]);
            $map = [];
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $map[$r['client_id']] = json_decode((string)$r['choices'], true) ?: [];
        } catch (\PDOException) { return; }
        if (!$map) return;
        foreach ($clients as $client) {
            if (!is_object($client) || !isset($map[$client->id ?? ''])) continue;
            $c = $map[$client->id];
            $client->sms = !empty($c['sms']) ? 'Var' : 'Yok';
            $client->whatsapp = !empty($c['whatsapp']) ? 'Var' : 'Yok';
            $client->emailPermission = !empty($c['email']) ? 'Var' : 'Yok';
            $client->marketingConsent = !empty($c['marketing']) ? 'Var' : 'Yok';
        }
    }

    // ───────────────────────────── HTML ─────────────────────────────
    private static function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    private static function tsi(int $ts, string $format): string { return (new \DateTimeImmutable('@'.$ts))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format($format); }

    /** Onay sayfası (mode=sign) veya klinik için imzalı belge kaydı (mode=record). */
    public static function html(array $doc, string $hash, string $mode, array $record = []): string
    {
        $e = [self::class, 'e'];
        $notice = class_exists(SiteLegal::class) ? SiteLegal::render((string)$doc['notice'], [])['html'] : nl2br($e((string)$doc['notice']));
        $platform = '';
        foreach ($doc['platform'] ?? [] as $p) {
            $platform .= '<li><a href="'.$e($p['url']).'" target="_blank" rel="noopener">'.$e($p['title']).'</a> <small>Sürüm '.(int)$p['version'].' · '.$e(SiteLegal::longDate($p['date'])).'</small></li>';
        }
        $choices = '';
        $given = $record['choices'] ?? [];
        foreach ($doc['choices'] as $key => $label) {
            $choices .= $mode === 'sign'
                ? '<label class="pm-choice"><input type="checkbox" name="'.$e($key).'"><span>'.$e($label).'</span></label>'
                : '<li>'.(!empty($given[$key]) ? '☑ <b>Onay verildi</b>' : '☐ Onay verilmedi').' — '.$e($label).'</li>';
        }
        $head = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">'
            .'<title>'.$e($doc['title']).'</title><link rel="stylesheet" href="/permit-sign.css?v=2"></head><body><main class="pm">'
            .'<header class="pm-head"><span class="pm-badge">'.$e($doc['clinic']['klinik']).'</span><h1>'.$e($doc['title']).'</h1>'
            .'<p>Sayın <b>'.$e($doc['client'] ?: 'Müşterimiz').'</b>, kişisel verilerinizin işlenmesi ve size hangi kanallardan ulaşabileceğimiz hakkındaki bilgilendirmeyi okuyup onayınızı imzanızla verebilirsiniz.</p></header>';
        $body = '<section class="pm-card"><h2>1. Kişisel Verilerin Korunması Aydınlatma Metni</h2><div class="pm-text">'.$notice.'</div></section>'
            .($platform !== '' ? '<section class="pm-card"><h2>2. Dijital hizmet metinleri</h2><p>Klinik kayıtları ve hasta sahibi portalı Vetzimo.com altyapısında sunulur. İlgili metinler:</p><ul class="pm-links">'.$platform.'</ul></section>' : '');
        if ($mode === 'sign') {
            $body .= '<form class="pm-card pm-form" id="pmForm" data-hash="'.$e($hash).'" novalidate>'
                .'<label class="pm-choice pm-read"><input type="checkbox" name="read" required><span>Yukarıdaki aydınlatma metnini ve dijital hizmet metinlerini okudum, anladım.</span></label>'
                .'<h2>3. İletişim izinleri <small>(isteğe bağlı, her biri ayrı)</small></h2><p class="pm-muted">İzin vermeseniz de klinik hizmeti almaya devam edersiniz. İzinlerinizi istediğiniz zaman geri alabilirsiniz.</p>'.$choices
                .'<h2>4. Beyan ve imza</h2><p class="pm-decl">'.$e($doc['declaration']).'</p>'
                .'<label class="pm-field">Adınız ve soyadınız<input name="signerName" autocomplete="name" maxlength="120" required></label>'
                .'<div class="pm-sign"><canvas id="pmPad" width="900" height="300" aria-label="İmza alanı"></canvas><button type="button" id="pmClear" class="pm-link">İmzayı temizle</button><span class="pm-hint">Parmağınızla veya kalemle imzanızı atın</span></div>'
                .'<p class="pm-error" id="pmError" role="alert"></p>'
                .'<div class="pm-actions"><button type="submit" class="pm-primary">Onayla ve imzala</button><button type="button" id="pmDecline" class="pm-secondary">Onay vermiyorum</button></div>'
                .'<p class="pm-muted">Belge kimliği: <code>'.$e(substr($hash, 0, 16)).'</code> · İmzaladığınızda tarih, saat ve cihaz bilgisi kayıt altına alınır.</p></form>'
                .'<section class="pm-card pm-done" id="pmDone" hidden><h2>Teşekkürler</h2><p id="pmDoneText"></p></section>'
                .'<script src="/permit-sign.js?v=1" type="module"></script>';
        } else {
            $body .= '<section class="pm-card"><h2>3. İletişim izinleri</h2><ul class="pm-given">'.$choices.'</ul></section>'
                .'<section class="pm-card"><h2>4. Beyan ve imza</h2><p class="pm-decl">'.$e($doc['declaration']).'</p>'
                .'<p><b>Durum:</b> '.$e(['signed' => 'İmzalandı', 'declined' => 'Onay verilmedi', 'pending' => 'İmza bekleniyor', 'expired' => 'Süresi doldu', 'cancelled' => 'İptal edildi'][$record['status']] ?? $record['status']).'</p>'
                .($record['signature'] ? '<img class="pm-signature" src="'.$e($record['signature']).'" alt="İmza">' : '')
                .'<dl class="pm-meta"><dt>İmzalayan</dt><dd>'.$e($record['signer'] ?: '-').'</dd><dt>Tarih</dt><dd>'.($record['decidedAt'] ? $e(self::tsi($record['decidedAt'], 'd.m.Y H:i:s')).' (TSİ)' : '-').'</dd>'
                .'<dt>Gönderim</dt><dd>'.$e(['sms' => 'SMS bağlantısı', 'whatsapp' => 'WhatsApp bağlantısı', 'link' => 'Bağlantı', 'clinic' => 'Klinikte imza'][$record['method']] ?? $record['method']).' · '.$e($record['phone']).'</dd>'
                .'<dt>IP / cihaz</dt><dd>'.$e(($record['ip'] ?? '') ?: '-').' · '.$e(($record['agent'] ?? '') ?: '-').'</dd><dt>Belge özeti (SHA-256)</dt><dd><code>'.$e($hash).'</code></dd>'
                .'<dt>Oluşturan</dt><dd>'.$e($record['createdBy']).' · '.$e(self::tsi($record['createdAt'], 'd.m.Y H:i')).'</dd></dl></section>'
                .'<p class="pm-print"><button type="button" data-print>Yazdır / PDF</button></p><script src="/permit-sign.js?v=1" type="module"></script>';
        }
        return $head.$body.'</main></body></html>';
    }
}
