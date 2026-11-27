<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

require_once __DIR__.'/AppPush.php';

/**
 * VetZimo uygulama merkezi: Android, iOS, masaüstü ve web (PWA) cihaz kaydı, bildirim merkezi (geçmiş, okundu,
 * temizleme, kategori sessize alma), rol/kategori politikaları, kilit ekranı şablonları, sürüm yönetimi, hata
 * kayıtları ve hesap silme talepleri. Bildirimler klinik olay kuyruğundan (clinic_delivery_notice) ve sağ üst
 * uyarılardan (ClinicAlerts) üretilir; yalnız ilgili ve yetkili kişiye gider, aynı olay iki kez gönderilmez.
 * Gönderim AppPush (FCM, APNs, Web Push) ile yapılır.
 */
final class AppHub
{
    /** key => [etiket, kritik mi (kapatılamaz), kilit ekranında ayrıntı gizlensin mi, varsayılan roller] */
    public const CATEGORIES = [
        'appointments'  => ['Randevular', false, false, ['dealer', 'branch', 'staff', 'customer']],
        'vaccines'      => ['Aşı, parazit ve kontrol tarihleri', false, false, ['dealer', 'branch', 'staff', 'customer']],
        'homeVisits'    => ['Evde hizmet talepleri ve rota', false, true, ['dealer', 'branch', 'staff', 'customer']],
        'patients'      => ['Hasta kabul ve işlem güncellemeleri', false, true, ['dealer', 'branch', 'staff', 'customer']],
        'labs'          => ['Tetkik ve görüntüleme sonuçları', false, true, ['dealer', 'branch', 'staff', 'customer']],
        'payments'      => ['Ödeme, tahsilat, borç ve fatura', false, true, ['dealer', 'branch', 'customer', 'center']],
        'stock'         => ['Kritik stok ve son kullanma', false, false, ['dealer', 'branch', 'staff']],
        'messages'      => ['Yeni mesajlar', false, true, ['dealer', 'branch', 'staff']],
        'homecare'      => ['Evden takip', false, true, ['dealer', 'branch', 'staff', 'customer']],
        'support'       => ['Destek talepleri ve yanıtları', false, false, ['dealer', 'center']],
        'announcements' => ['Yönetici duyuruları', false, false, ['dealer', 'branch', 'staff', 'customer']],
        'security'      => ['Güvenlik ve yeni oturum', true, false, ['dealer', 'branch', 'staff', 'customer', 'center']],
        'system'        => ['Sistem uyarıları', true, false, ['dealer', 'branch', 'staff', 'center']],
    ];
    public const ROLES = ['center' => 'Merkez yöneticisi', 'dealer' => 'Bayi yöneticisi', 'branch' => 'Şube yöneticisi', 'staff' => 'Personel', 'customer' => 'Hasta sahibi'];
    public const PLATFORMS = ['android', 'ios', 'web', 'windows', 'macos', 'linux'];
    public const PROVIDERS = ['fcm', 'apns', 'webpush', 'desktop'];
    public const SOUNDS = ['default', 'vz_chime', 'vz_soft', 'vz_alert', 'silent'];
    private const CURSOR_ID = '00000000000000000000000000000004';

    public function __construct(private readonly PDO $db, private readonly array $config = []) {}

    private function q(string $sql, array $args = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($args);
        return $q;
    }

    private static function text(mixed $v, int $max, bool $required = false): string
    {
        if (!is_string($v) && !is_int($v) && $v !== null) throw new RuntimeException('Geçersiz alan.', 422);
        $v = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v) ?? '');
        if ($required && $v === '') throw new RuntimeException('Zorunlu alan eksik.', 422);
        return mb_substr($v, 0, $max);
    }

    public static function role(array $actor): string
    {
        return ($actor['kind'] ?? '') === 'center' ? 'center' : (string)($actor['role'] ?? '');
    }

    // ───────────────────────── Politikalar ve şablonlar ─────────────────────────

    /** @return array<string,array<string,bool>> kategori => rol => açık mı */
    public function policies(): array
    {
        $out = [];
        foreach (self::CATEGORIES as $key => [, , , $roles]) foreach (self::ROLES as $role => $_) $out[$key][$role] = in_array($role, $roles, true);
        try {
            foreach ($this->q('SELECT category,role,enabled FROM app_policy')->fetchAll() as $r)
                if (isset($out[$r['category']][$r['role']]) && !self::CATEGORIES[$r['category']][1]) $out[$r['category']][$r['role']] = (bool)$r['enabled'];
        } catch (\PDOException) {}
        return $out;
    }

    /** Hasta sahibine giden bildirimlerin hazır metinleri. Değişkenler: {sahip} {hasta} {konu} {tarih} {saat} {klinik} {telefon} */
    public const MESSAGES = [
        'appointments'  => 'Sayın {sahip}, {hasta} için randevunuz: {konu} · {tarih} {saat}. Değişiklik için bize ulaşın. {klinik} · {telefon}',
        'vaccines'      => 'Sayın {sahip}, {hasta} için aşı / kontrol hatırlatması: {konu} · {tarih}. Geciken aşılar koruyuculuğu azaltır; randevu için arayın. {klinik} · {telefon}',
        'homeVisits'    => 'Sayın {sahip}, evde hizmet ekibimizden bilgi: {konu}. {klinik} · {telefon}',
        'patients'      => 'Sayın {sahip}, {hasta} ile ilgili güncelleme: {konu}. {klinik} · {telefon}',
        'labs'          => 'Sayın {sahip}, {hasta} için tetkik / görüntüleme sonucu hazır: {konu}. Hekimimiz değerlendirip size bilgi verecek. {klinik} · {telefon}',
        'payments'      => 'Sayın {sahip}, ödeme bilgilendirmesi: {konu}. Sorularınız için bize ulaşın. {klinik} · {telefon}',
        'stock'         => '{konu}',
        'messages'      => '{konu}',
        'homecare'      => 'Sayın {sahip}, {hasta} için evden takip: {konu}. Durumda kötüleşme olursa hemen arayın. {klinik} · {telefon}',
        'support'       => '{konu}',
        'announcements' => 'Sayın {sahip}, {konu}. {klinik} · {telefon}',
        'security'      => '{konu}',
        'system'        => '{konu}',
    ];

    public function templates(): array
    {
        $out = [];
        foreach (self::CATEGORIES as $key => [$label, , $private]) $out[$key] = ['title' => 'VetZimo · '.$label, 'body' => $private ? 'Ayrıntıları görmek için dokunun.' : '', 'message' => self::MESSAGES[$key] ?? '{konu}'];
        try {
            foreach ($this->q('SELECT category,title,body,message FROM app_template')->fetchAll() as $r)
                if (isset($out[$r['category']])) $out[$r['category']] = ['title' => $r['title'], 'body' => $r['body'], 'message' => $r['message'] !== '' ? $r['message'] : $out[$r['category']]['message']];
        } catch (\PDOException) {
            try {
                foreach ($this->q('SELECT category,title,body FROM app_template')->fetchAll() as $r)
                    if (isset($out[$r['category']])) $out[$r['category']] = ['title' => $r['title'], 'body' => $r['body'], 'message' => $out[$r['category']]['message']];
            } catch (\PDOException) {}
        }
        return $out;
    }

    /** Şablondaki değişkenleri doldurur; boş kalan değişkenin çevresindeki fazla ayraçlar temizlenir. */
    public static function fill(string $template, array $vars): string
    {
        $text = strtr($template, array_map(static fn($v) => trim((string)$v), $vars));
        $text = preg_replace(['/\{[a-z]+\}/u', '/\s+·\s+(?=[.·]|$)/u', '/\s+([.,])/u', '/\s{2,}/u', '/^[\s·,.]+|[\s·,]+$/u'], ['', '', '$1', ' ', ''], $text);
        return mb_substr(trim((string)$text), 0, 400);
    }

    /** Hasta sahibi bildirimi için değişkenler: sahip, hasta, tarih ve saat kayıttan (kayit= parametresi) okunur. */
    private function ownerVars(array $n, string $ownerName, array &$cache): array
    {
        $partner = $n['partner_id'];
        $cache['p'][$partner] ??= $this->q('SELECT name,phone FROM partner_account WHERE id=?', [$partner])->fetch() ?: ['name' => '', 'phone' => ''];
        $vars = ['{sahip}' => $ownerName !== '' ? $ownerName : 'hasta sahibimiz', '{hasta}' => 'dostunuz', '{konu}' => $n['title'], '{tarih}' => '', '{saat}' => '',
            '{klinik}' => (string)$cache['p'][$partner]['name'], '{telefon}' => (string)$cache['p'][$partner]['phone']];
        parse_str((string)parse_url((string)$n['target'], PHP_URL_QUERY), $query);
        $record = is_string($query['kayit'] ?? null) ? $query['kayit'] : '';
        if ($record !== '' && strlen($record) <= 120) {
            try {
                $q = $this->db->prepare("SELECT r.collection,r.record_data FROM clinic_record r JOIN clinic_record_set s ON s.id=r.set_id WHERE s.workspace_id=? AND r.record_id=? AND r.collection IN ('appointments','followups','labs','exams','stays','sales') LIMIT 1");
                $q->execute(['partner:'.$partner, $record]);
                $row = $q->fetch();
                $data = $row ? json_decode((string)$row['record_data'], true) : null;
                if (is_array($data)) {
                    if (preg_match('/\A\d{4}-\d{2}-\d{2}/', (string)($data['date'] ?? ''))) { [$y, $m, $d] = explode('-', substr((string)$data['date'], 0, 10)); $vars['{tarih}'] = "$d.$m.$y"; }
                    if (preg_match('/\A\d{2}:\d{2}\z/', (string)($data['time'] ?? ''))) $vars['{saat}'] = $data['time'];
                    $pid = (string)($data['patient'] ?? '');
                    if ($pid !== '') {
                        $p = $this->db->prepare("SELECT r.record_data FROM clinic_record r JOIN clinic_record_set s ON s.id=r.set_id WHERE s.workspace_id=? AND r.collection='patients' AND r.record_id=? LIMIT 1");
                        $p->execute(['partner:'.$partner, $pid]);
                        $pd = json_decode((string)$p->fetchColumn(), true);
                        if (is_array($pd) && trim((string)($pd['name'] ?? '')) !== '') $vars['{hasta}'] = trim((string)$pd['name']);
                    }
                }
            } catch (\PDOException) {}
        }
        return $vars;
    }

    // ───────────────────────── Cihazlar ─────────────────────────

    public function register(array $actor, string $sessionDevice, object $body, int $now): array
    {
        $platform = $body->platform ?? '';
        $provider = $body->provider ?? '';
        if (!in_array($platform, self::PLATFORMS, true) || !in_array($provider, self::PROVIDERS, true)) throw new RuntimeException('Platform geçersiz.', 422);
        if ($provider === 'webpush') {
            $sub = $body->subscription ?? null;
            $endpoint = is_object($sub) ? (string)($sub->endpoint ?? '') : '';
            $p256 = is_object($sub) ? (string)($sub->keys->p256dh ?? '') : '';
            $auth = is_object($sub) ? (string)($sub->keys->auth ?? '') : '';
            if (!preg_match('~\Ahttps://[A-Za-z0-9.-]+(?::\d+)?/[\x21-\x7E]{1,900}\z~', $endpoint) || !preg_match('/\A[A-Za-z0-9_-]{80,100}\z/', $p256) || !preg_match('/\A[A-Za-z0-9_-]{16,32}\z/', $auth))
                throw new RuntimeException('Bildirim aboneliği geçersiz.', 422);
            $token = json_encode(['endpoint' => $endpoint, 'p256dh' => $p256, 'auth' => $auth], JSON_UNESCAPED_SLASHES);
        } elseif ($provider === 'desktop') {
            $token = 'desktop:'.$sessionDevice;
        } else {
            $token = (string)($body->token ?? '');
            if (!preg_match('/\A[A-Za-z0-9:_.-]{32,4096}\z/', $token)) throw new RuntimeException('Cihaz anahtarı geçersiz.', 422);
        }
        $sound = in_array($body->sound ?? 'default', self::SOUNDS, true) ? $body->sound ?? 'default' : 'default';
        $hash = hash('sha256', $provider.'|'.$token);
        $enc = Totp::encrypt($token, (string)($this->config['encryptionKey'] ?? ''));
        $id = bin2hex(random_bytes(16));
        $this->q('INSERT INTO app_device(id,account_id,membership_id,session_device,platform,provider,token_hash,token,app_version,os_version,model,locale,sound,created_at,seen_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),membership_id=VALUES(membership_id),session_device=VALUES(session_device),
            platform=VALUES(platform),token=VALUES(token),app_version=VALUES(app_version),os_version=VALUES(os_version),model=VALUES(model),locale=VALUES(locale),seen_at=VALUES(seen_at),revoked_at=NULL',
            [$id, $actor['account_id'], (string)($actor['membership_id'] ?? ''), $sessionDevice, $platform, $provider, $hash, $enc,
                self::text($body->appVersion ?? '', 32), self::text($body->osVersion ?? '', 40), self::text($body->model ?? '', 60),
                preg_match('/\A[a-z]{2}\z/', (string)($body->locale ?? '')) ? $body->locale : 'tr', $sound, $now, $now]);
        // Aynı oturum cihazında eski anahtarlar (yenilenen FCM anahtarı) devre dışı kalır.
        $this->q('UPDATE app_device SET revoked_at=? WHERE session_device=? AND token_hash<>? AND provider=? AND revoked_at IS NULL', [$now, $sessionDevice, $hash, $provider]);
        $row = $this->q('SELECT id,sound,muted FROM app_device WHERE token_hash=?', [$hash])->fetch();
        return ['device' => $row['id'], 'sound' => $row['sound'], 'muted' => json_decode((string)$row['muted'], true) ?: [], 'badge' => $this->unread($actor)];
    }

    /** Oturum kapatılınca bu cihaza artık bildirim gitmez. */
    public function forgetSession(string $sessionDevice): void
    {
        try { $this->q('UPDATE app_device SET revoked_at=? WHERE session_device=? AND revoked_at IS NULL', [time(), $sessionDevice]); } catch (\PDOException) {}
    }

    public function preferences(array $actor, string $sessionDevice, object $body): array
    {
        $muted = [];
        foreach ((array)($body->muted ?? []) as $c) if (is_string($c) && isset(self::CATEGORIES[$c]) && !self::CATEGORIES[$c][1]) $muted[] = $c;
        $sound = in_array($body->sound ?? 'default', self::SOUNDS, true) ? $body->sound : 'default';
        $quiet = self::quiet($body->quiet ?? null);
        $this->q('INSERT INTO app_preference(account_id,muted,sound,quiet) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE muted=VALUES(muted),sound=VALUES(sound),quiet=VALUES(quiet)',
            [$actor['account_id'], json_encode(array_values(array_unique($muted))), $sound, $quiet ? json_encode($quiet) : null]);
        $this->q('UPDATE app_device SET sound=?,muted=? WHERE account_id=? AND revoked_at IS NULL', [$sound, json_encode($muted), $actor['account_id']]);
        return $this->settings($actor);
    }

    private static function quiet(mixed $v): ?array
    {
        if (!is_object($v) || empty($v->on)) return null;
        $from = (string)($v->from ?? ''); $to = (string)($v->to ?? '');
        if (!preg_match('/\A([01]\d|2[0-3]):[0-5]\d\z/', $from) || !preg_match('/\A([01]\d|2[0-3]):[0-5]\d\z/', $to)) throw new RuntimeException('Sessiz saat geçersiz.', 422);
        return ['on' => true, 'from' => $from, 'to' => $to];
    }

    public function settings(array $actor): array
    {
        $role = self::role($actor);
        $policies = $this->policies();
        $p = $this->q('SELECT muted,sound,quiet FROM app_preference WHERE account_id=?', [$actor['account_id']])->fetch() ?: ['muted' => '[]', 'sound' => 'default', 'quiet' => null];
        $cats = [];
        foreach (self::CATEGORIES as $key => [$label, $critical]) if ($policies[$key][$role] ?? false) $cats[] = ['key' => $key, 'label' => $label, 'critical' => $critical];
        return ['scope' => ($actor['kind'] ?? '') === 'center' ? (string)$actor['account_id'] : (string)($actor['membership_id'] ?? ''), 'role' => $role, 'categories' => $cats, 'muted' => json_decode((string)$p['muted'], true) ?: [], 'sound' => $p['sound'], 'quiet' => json_decode((string)$p['quiet'], true),
            'sounds' => self::SOUNDS, 'vapid' => (new AppPush($this->db, $this->config))->vapidPublic(), 'badge' => $this->unread($actor),
            'devices' => $this->q('SELECT id,platform,provider,app_version,model,seen_at FROM app_device WHERE account_id=? AND revoked_at IS NULL ORDER BY seen_at DESC LIMIT 20', [$actor['account_id']])->fetchAll()];
    }

    public function revokeDevice(array $actor, string $id): void
    {
        $this->q('UPDATE app_device SET revoked_at=? WHERE id=? AND account_id=?', [time(), $id, $actor['account_id']]);
    }

    // ───────────────────────── Bildirim merkezi ─────────────────────────

    /**
     * Bildirim görünürlüğü: merkez hesabı kendi bildirimlerini; telefonla giren kişi yalnız o an açık olan üyeliğinin
     * (hangi klinik, hangi rol) bildirimlerini görür. Böylece aynı numara hem personel hem hasta sahibi olsa da gün sonu
     * listesi gibi ekip bildirimleri hasta sahibi panelinde, bir kliniğin bildirimleri diğer klinikte görünmez.
     * @return array{0:string,1:list<string>}
     */
    private static function scope(array $actor): array
    {
        if (($actor['kind'] ?? '') === 'center') return ['account_id=?', [(string)$actor['account_id']]];
        return ["account_id=? AND membership_id IN (?,'')", [(string)$actor['account_id'], (string)($actor['membership_id'] ?? '')]];
    }

    /** $who: hesap kimliği (eski çağrılar, tüm üyelikler) veya actor dizisi (yalnız açık üyelik). */
    public function unread(string|array $who, ?string $membership = null): int
    {
        if (is_array($who)) [$w, $a] = self::scope($who);
        elseif ($membership !== null) [$w, $a] = ["account_id=? AND membership_id IN (?,'')", [$who, $membership]];
        else [$w, $a] = ['account_id=?', [$who]];
        return (int)$this->q("SELECT COUNT(*) FROM app_notification WHERE $w AND read_at IS NULL AND cleared_at IS NULL", $a)->fetchColumn();
    }

    public function inbox(array $actor, ?string $before, ?string $category, bool $unreadOnly): array
    {
        [$where, $args] = self::scope($actor);
        $where .= ' AND cleared_at IS NULL';
        if ($before !== null && ctype_digit($before)) { $where .= ' AND id<?'; $args[] = (int)$before; }
        if ($category !== null && isset(self::CATEGORIES[$category])) { $where .= ' AND category=?'; $args[] = $category; }
        if ($unreadOnly) $where .= ' AND read_at IS NULL';
        $rows = $this->q("SELECT id,membership_id,category,title,body,href,created_at,read_at FROM app_notification WHERE $where ORDER BY id DESC LIMIT 40", $args)->fetchAll();
        $names = [];
        foreach ($this->q('SELECT m.id,p.name FROM identity_membership m JOIN partner_account p ON p.id=m.partner_id WHERE m.account_id=?', [$actor['account_id']])->fetchAll() as $m) $names[$m['id']] = $m['name'];
        return ['items' => array_map(static fn($r) => ['id' => (int)$r['id'], 'membership' => $r['membership_id'], 'clinic' => $names[$r['membership_id']] ?? '',
            'category' => $r['category'], 'label' => self::CATEGORIES[$r['category']][0] ?? '', 'title' => $r['title'], 'body' => $r['body'], 'href' => $r['href'],
            'time' => (int)$r['created_at'], 'unread' => $r['read_at'] === null], $rows), 'unread' => $this->unread($actor), 'more' => count($rows) === 40];
    }

    public function mark(array $actor, object $body, int $now): array
    {
        $ids = array_values(array_filter(array_map('intval', array_slice((array)($body->ids ?? []), 0, 200))));
        $action = $body->action ?? '';
        [$w, $sa] = self::scope($actor);
        $in = $ids ? implode(',', array_fill(0, count($ids), '?')) : '';
        match ($action) {
            'read' => $ids && $this->q("UPDATE app_notification SET read_at=? WHERE $w AND read_at IS NULL AND id IN ($in)", [$now, ...$sa, ...$ids]),
            'unread' => $ids && $this->q("UPDATE app_notification SET read_at=NULL WHERE $w AND id IN ($in)", [...$sa, ...$ids]),
            'clear' => $ids && $this->q("UPDATE app_notification SET cleared_at=?,read_at=COALESCE(read_at,?) WHERE $w AND id IN ($in)", [$now, $now, ...$sa, ...$ids]),
            'readAll' => $this->q("UPDATE app_notification SET read_at=? WHERE $w AND read_at IS NULL".(isset(self::CATEGORIES[$body->category ?? '']) ? ' AND category=?' : ''),
                array_merge([$now, ...$sa], isset(self::CATEGORIES[$body->category ?? '']) ? [$body->category] : [])),
            'clearAll' => $this->q("UPDATE app_notification SET cleared_at=?,read_at=COALESCE(read_at,?) WHERE $w AND cleared_at IS NULL", [$now, $now, ...$sa]),
            default => throw new RuntimeException('İşlem geçersiz.', 422),
        };
        return ['unread' => $this->unread($actor)];
    }

    /**
     * Bir üyeliğe bildirim ekler (aynı anahtar ikinci kez eklenmez). Politika ve kişisel sessize alma, gönderim
     * aşamasında değil burada uygulanır; böylece kapatılan kategori geçmişte de birikmez.
     */
    public function notify(string $account, string $membership, string $role, string $category, string $title, string $body, string $href, string $key, int $now, ?array $policies = null): bool
    {
        if (!isset(self::CATEGORIES[$category])) return false;
        $policies ??= $this->policies();
        if (!($policies[$category][$role] ?? false)) return false;
        $href = preg_match('~\A/[\x21-\x7E]{0,480}\z~', $href) ? $href : '/app';
        $q = $this->db->prepare('INSERT IGNORE INTO app_notification(account_id,membership_id,category,title,body,href,dedupe,created_at) VALUES (?,?,?,?,?,?,?,?)');
        $q->execute([$account, $membership, $category, mb_substr($title, 0, 160), mb_substr($body, 0, 400), $href, hash('sha256', $membership.'|'.$key, true), $now]);
        return $q->rowCount() === 1;
    }

    /** Klinik üyelerinden bildirimi alması gerekenler (rol, şube ve modül izni denetlenir). */
    private function clinicMembers(string $partner, string $branch, ?string $module, array &$cache): array
    {
        $key = $partner.'|'.$branch.'|'.$module;
        if (isset($cache[$key])) return $cache[$key];
        $out = [];
        $rows = $this->q("SELECT m.*,a.identifier,a.kind,p.name AS partner_name FROM identity_membership m JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            JOIN partner_account p ON p.id=m.partner_id AND p.active=1
            WHERE m.partner_id=? AND m.status='active' AND m.role IN ('dealer','branch','staff')", [$partner])->fetchAll();
        $commerce = new Commerce($this->db);
        foreach ($rows as $m) {
            if ($m['role'] !== 'dealer' && $branch !== '' && $m['branch_id'] !== $branch) continue;
            if ($module !== null) {
                try { if (!ClinicAccess::allowed($commerce->packageActor($m), $module)) continue; } catch (\Throwable) { continue; }
            }
            $out[] = $m;
        }
        return $cache[$key] = $out;
    }

    private static function noticeCategory(array $n): array
    {
        $t = mb_strtolower($n['title']);
        $target = (string)$n['target'];
        return match (true) {
            in_array($n['kind'], ['visit_clinic', 'visit_owner', 'native_visit_clinic', 'native_visit_owner'], true) => ['homeVisits', null],
            $n['kind'] === 'homecare' => ['homecare', null],
            in_array($n['kind'], ['lab', 'xray'], true) || str_contains($t, 'tetkik') || str_contains($t, 'sonuç') || str_contains($t, 'görüntü') => ['labs', 'labs'],
            $n['kind'] === 'appointments' || str_contains($t, 'randevu') => ['appointments', 'appointments'],
            str_contains($t, 'aşı') || str_contains($t, 'takip') || str_contains($t, 'parazit') || str_contains($t, 'kontrol') => ['vaccines', 'followups'],
            str_contains($t, 'stok') || str_contains($t, 'son kullanma') => ['stock', 'products'],
            str_contains($t, 'tahsilat') || str_contains($t, 'ödeme') || str_contains($t, 'borç') || str_contains($t, 'fatura') => ['payments', 'sales'],
            str_contains($t, 'konaklama') || str_contains($t, 'yatış') || str_contains($t, 'kabul') || in_array($n['kind'], ['shares', 'exam'], true) || str_contains($target, 'stays') => ['patients', 'patients'],
            default => ['system', null],
        };
    }

    /**
     * Olay kuyruğundaki yeni kayıtları bildirime çevirir. İlk çalışmada geçmiş kuyruk atlanır (eski olaylar yağmuru olmaz).
     * @return int eklenen bildirim sayısı
     */
    public function fanout(int $now, int $limit = 500): int
    {
        $cursor = $this->q("SELECT payload FROM center_management WHERE id=? AND kind='app_cursor'", [self::CURSOR_ID])->fetchColumn();
        if ($cursor === false) {
            $max = (int)$this->q('SELECT COALESCE(MAX(id),0) FROM clinic_delivery_notice')->fetchColumn();
            $this->q("INSERT INTO center_management(id,kind,payload) VALUES (?,'app_cursor',?)", [self::CURSOR_ID, json_encode(['notice' => $max])]);
            return 0;
        }
        $last = (int)(json_decode((string)$cursor, true)['notice'] ?? 0);
        $rows = $this->q('SELECT * FROM clinic_delivery_notice WHERE id>? ORDER BY id LIMIT '.max(1, min(2000, $limit)), [$last])->fetchAll();
        if (!$rows) return 0;
        $policies = $this->policies();
        $cache = [];
        $added = 0;
        $templates = $this->templates();
        $varCache = [];
        $customer = $this->db->prepare("SELECT m.id,m.account_id,m.name FROM identity_membership m JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            WHERE m.partner_id=? AND m.customer_id=? AND m.role='customer' AND m.status='active'");
        $clinicName = [];
        foreach ($rows as $n) {
            $last = (int)$n['id'];
            if ($n['kind'] === 'guest') continue;
            [$category, $module] = self::noticeCategory($n);
            $clinicName[$n['partner_id']] ??= (string)$this->q('SELECT name FROM partner_account WHERE id=?', [$n['partner_id']])->fetchColumn();
            $key = 'notice:'.$n['dedupe'];
            if ($n['customer_id'] !== '') {
                $customer->execute([$n['partner_id'], $n['customer_id']]);
                foreach ($customer->fetchAll() as $m) {
                    if ($n['membership_id'] !== '' && $n['membership_id'] !== $m['id']) continue;
                    $href = str_starts_with($n['target'], '/hasta-sahibi') || str_starts_with($n['target'], '/evde-hizmet') ? $n['target'] : '/hasta-sahibi';
                    // Hazır şablon: "Sayın {sahip}, {hasta} için ... {klinik} · {telefon}" (kilit ekranında gizlilik metni ayrıca uygulanır)
                    $text = self::fill($templates[$category]['message'] ?? '{konu}', $this->ownerVars($n, (string)($m['name'] ?? ''), $varCache));
                    $added += (int)$this->notify($m['account_id'], $m['id'], 'customer', $category, $n['title'], $text !== '' ? $text : $clinicName[$n['partner_id']], $href, $key, $now, $policies);
                }
            } elseif (in_array($n['kind'], ['clinic', 'visit_clinic', 'native_visit_clinic'], true)) {
                foreach ($this->clinicMembers($n['partner_id'], $n['branch_id'], $module, $cache) as $m) {
                    $href = str_starts_with($n['target'], '/clinic') || str_starts_with($n['target'], '/evde-hizmet') ? $n['target'] : '/clinic';
                    $added += (int)$this->notify($m['account_id'], $m['id'], $m['role'], $category, $n['title'], $clinicName[$n['partner_id']], $href, $key, $now, $policies);
                }
            }
        }
        $this->q("UPDATE center_management SET payload=? WHERE id=?", [json_encode(['notice' => $last]), self::CURSOR_ID]);
        return $added;
    }

    /**
     * Sağ üst uyarıları (mesaj, onay, sorunlu iş, telefon hattı, web mesajı, abonelik) cihazı kayıtlı ekip üyelerine
     * bildirim olarak aktarır. Yalnız uygulaması olan kişiler için çalışır; milyonlarca hasta sahibinde yük oluşturmaz.
     */
    public function alerts(int $now): int
    {
        $members = $this->q("SELECT DISTINCT m.* ,a.kind FROM app_device d JOIN identity_membership m ON m.account_id=d.account_id AND m.status='active' AND m.role IN ('dealer','branch','staff')
            JOIN identity_account a ON a.id=m.account_id AND a.blocked=0 JOIN partner_account p ON p.id=m.partner_id AND p.active=1
            WHERE d.revoked_at IS NULL AND d.seen_at>? LIMIT 5000", [$now - 90 * 86400])->fetchAll();
        $map = ['inbox' => 'messages', 'web' => 'messages', 'permit' => 'patients', 'job' => 'system', 'phone' => 'system', 'subscription' => 'payments', 'device' => 'labs'];
        $alerts = new ClinicAlerts($this->db);
        $commerce = new Commerce($this->db);
        $policies = $this->policies();
        $added = 0;
        foreach ($members as $m) {
            try { $list = $alerts->list($commerce->packageActor($m), $now)['items']; } catch (\Throwable) { continue; }
            foreach ($list as $i) {
                $cat = $map[$i['kind']] ?? 'system';
                $added += (int)$this->notify($m['account_id'], $m['id'], $m['role'], $cat, $i['title'], (string)$i['body'], '/clinic'.$i['href'], 'alert:'.$i['key'], $now, $policies);
            }
        }
        return $added;
    }

    /** Hesaba yeni cihazdan giriş: hesabın diğer cihazlarına güvenlik bildirimi. */
    public function securityLogin(string $account, string $membership, string $role, string $agent, int $now): void
    {
        try {
            if (!(int)$this->q('SELECT COUNT(*) FROM app_device WHERE account_id=? AND revoked_at IS NULL', [$account])->fetchColumn()) return;
            $device = self::agentName($agent);
            $this->notify($account, $membership, $role, 'security', 'Hesabınıza yeni bir oturum açıldı',
                $device.' · '.(new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('d.m.Y H:i').'. Siz değilseniz şifrenizi hemen değiştirin.',
                '/app#guvenlik', 'login:'.$now.':'.substr(hash('sha256', $agent), 0, 12), $now);
        } catch (\Throwable) {}
    }

    public static function agentName(string $ua): string
    {
        $os = match (true) { str_contains($ua, 'iPhone') => 'iPhone', str_contains($ua, 'iPad') => 'iPad', str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Windows') => 'Windows', str_contains($ua, 'Mac OS') => 'Mac', str_contains($ua, 'Linux') => 'Linux', default => 'Bilinmeyen cihaz' };
        $app = match (true) { str_contains($ua, 'VetZimoApp') => 'VetZimo uygulaması', str_contains($ua, 'Edg/') => 'Edge', str_contains($ua, 'Chrome') => 'Chrome',
            str_contains($ua, 'Firefox') => 'Firefox', str_contains($ua, 'Safari') => 'Safari', default => 'tarayıcı' };
        return $os.' · '.$app;
    }

    /** Merkez duyurusu: seçilen rollere (ve isterse tek bayiye) bildirim. */
    public function announce(object $body, int $now): int
    {
        $title = self::text($body->title ?? '', 120, true);
        $text = self::text($body->body ?? '', 400);
        $roles = array_values(array_intersect(['dealer', 'branch', 'staff', 'customer'], (array)($body->roles ?? [])));
        if (!$roles) throw new RuntimeException('En az bir rol seçin.', 422);
        $partner = preg_match('/\A[a-f0-9]{32}\z/', (string)($body->partner ?? '')) ? $body->partner : null;
        $in = implode(',', array_fill(0, count($roles), '?'));
        $sql = "SELECT m.id,m.account_id,m.role FROM identity_membership m JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            JOIN partner_account p ON p.id=m.partner_id AND p.active=1 WHERE m.status='active' AND m.role IN ($in)".($partner ? ' AND m.partner_id=?' : '');
        $key = 'announce:'.bin2hex(random_bytes(8));
        $q = $this->db->prepare($sql);
        $q->execute($partner ? [...$roles, $partner] : $roles);
        $policies = $this->policies();
        $n = 0;
        while ($m = $q->fetch()) $n += (int)$this->notify($m['account_id'], $m['id'], $m['role'], 'announcements', $title, $text, $m['role'] === 'customer' ? '/hasta-sahibi' : '/clinic', $key, $now, $policies);
        return $n;
    }

    /** Merkez hesaplarına (destek, ödeme onayı, sistem) bildirim. */
    public function notifyCenter(string $category, string $title, string $body, string $href, string $key, int $now): void
    {
        try {
            $policies = $this->policies();
            foreach ($this->q("SELECT a.id FROM identity_account a JOIN identity_center c ON c.account_id=a.id WHERE a.kind='center' AND a.blocked=0")->fetchAll(PDO::FETCH_COLUMN) as $acc)
                $this->notify($acc, '', 'center', $category, $title, $body, $href, $key, $now, $policies);
        } catch (\Throwable) {}
    }

    // ───────────────────────── Sürümler, hatalar ─────────────────────────

    public function release(string $platform, int $build): array
    {
        if (!in_array($platform, self::PLATFORMS, true)) throw new RuntimeException('Platform geçersiz.', 422);
        $r = $this->q('SELECT version,build,min_build,url,notes,published_at FROM app_release WHERE platform=? AND published_at IS NOT NULL ORDER BY build DESC LIMIT 1', [$platform])->fetch();
        if (!$r) return ['latest' => null, 'update' => false, 'required' => false];
        return ['latest' => ['version' => $r['version'], 'build' => (int)$r['build'], 'url' => $r['url'], 'notes' => $r['notes']],
            'update' => $build > 0 && $build < (int)$r['build'], 'required' => $build > 0 && $build < (int)$r['min_build']];
    }

    public function error(?array $actor, object $body, string $sessionDevice, int $now): void
    {
        $platform = in_array($body->platform ?? '', self::PLATFORMS, true) ? $body->platform : 'web';
        $message = self::text($body->message ?? '', 500, true);
        $stack = mb_substr((string)($body->stack ?? ''), 0, 4000);
        $page = self::text($body->page ?? '', 300);
        $version = self::text($body->version ?? '', 32);
        $hash = hash('sha256', $platform.'|'.$version.'|'.$message.'|'.date('Ymd', $now), true);
        $recent = (int)$this->q('SELECT COUNT(*) FROM app_error WHERE reporter=? AND last_at>?', [hash('sha256', $sessionDevice), $now - 3600])->fetchColumn();
        if ($recent >= 30) return; // aynı cihaz saatte en çok 30 farklı hata bildirir
        $this->q('INSERT INTO app_error(hash,platform,version,message,stack,page,reporter,role,first_at,last_at,count) VALUES (?,?,?,?,?,?,?,?,?,?,1)
            ON DUPLICATE KEY UPDATE count=count+1,last_at=VALUES(last_at)', [$hash, $platform, $version, $message, $stack, $page, hash('sha256', $sessionDevice), $actor ? self::role($actor) : '', $now, $now]);
    }

    // ───────────────────────── Hesap silme ─────────────────────────

    public function deletion(array $actor, int $now, bool $request): array
    {
        if ($request) {
            if ($now - (int)$actor['reauth_at'] > 300) throw new RuntimeException('Talep için hesabınızı yeniden doğrulayın.', 403);
            $this->q("INSERT INTO account_deletion_request(account_id,requested_at,status) VALUES (?,?,'pending') ON DUPLICATE KEY UPDATE requested_at=IF(status='pending',requested_at,VALUES(requested_at)),status='pending'",
                [$actor['account_id'], $now]);
            $this->notifyCenter('system', 'Yeni hesap silme talebi', 'Bir kullanıcı hesabının silinmesini istedi.', '/yonetim#uygulamalar', 'deletion:'.$actor['account_id'].':'.$now, $now);
        }
        $r = $this->q('SELECT requested_at,status FROM account_deletion_request WHERE account_id=?', [$actor['account_id']])->fetch();
        return ['requestedAt' => $r ? (int)$r['requested_at'] : null, 'status' => $r['status'] ?? null];
    }

    /**
     * Talebi tamamlar: giriş bilgisi anonimleşir, oturumlar, cihazlar, bildirimler ve üyelikler kapanır.
     * Klinik tıbbi kayıtları yasal saklama yükümlülüğü nedeniyle kliniğin sorumluluğunda kalır.
     */
    public function processDeletion(string $account, string $decision, string $note, int $now): void
    {
        if (!in_array($decision, ['done', 'rejected'], true)) throw new RuntimeException('Karar geçersiz.', 422);
        $this->db->beginTransaction();
        try {
            $r = $this->q("SELECT status FROM account_deletion_request WHERE account_id=? FOR UPDATE", [$account])->fetch();
            if (!$r || $r['status'] !== 'pending') throw new RuntimeException('Bekleyen talep bulunamadı.', 404);
            if ($decision === 'done') {
                $kind = $this->q('SELECT kind FROM identity_account WHERE id=?', [$account])->fetchColumn();
                if ($kind !== 'phone') throw new RuntimeException('Bu hesap uygulama üzerinden silinemez.', 422);
                $this->q("UPDATE identity_account SET identifier=?,password_hash=NULL,blocked=1,version=version+1 WHERE id=?", ['silindi:'.substr(hash('sha256', $account.random_bytes(8)), 0, 24), $account]);
                $this->q("UPDATE identity_membership SET status='revoked' WHERE account_id=?", [$account]);
                $this->q('DELETE FROM identity_session WHERE account_id=?', [$account]);
                $this->q('DELETE FROM app_device WHERE account_id=?', [$account]);
                $this->q('DELETE FROM app_notification WHERE account_id=?', [$account]);
                $this->q('DELETE FROM app_preference WHERE account_id=?', [$account]);
            }
            $this->q('UPDATE account_deletion_request SET status=?,note=?,processed_at=? WHERE account_id=?', [$decision, mb_substr($note, 0, 300), $now, $account]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    // ───────────────────────── Merkez: Uygulama Yönetimi ─────────────────────────

    public function management(int $now): array
    {
        $push = new AppPush($this->db, $this->config);
        return [
            'devices' => $this->q('SELECT platform,provider,app_version,COUNT(*) total,SUM(seen_at>?) week FROM app_device WHERE revoked_at IS NULL GROUP BY platform,provider,app_version ORDER BY total DESC LIMIT 100', [$now - 7 * 86400])->fetchAll(),
            'totals' => $this->q('SELECT COUNT(*) devices,COUNT(DISTINCT account_id) accounts FROM app_device WHERE revoked_at IS NULL')->fetch(),
            'push' => $this->q('SELECT status,COUNT(*) total FROM app_push WHERE created_at>? GROUP BY status', [$now - 7 * 86400])->fetchAll(),
            'pushByDay' => $this->q("SELECT FROM_UNIXTIME(created_at,'%Y-%m-%d') day,SUM(status='sent') sent,SUM(status='failed') failed FROM app_push WHERE created_at>? GROUP BY day ORDER BY day", [$now - 14 * 86400])->fetchAll(),
            'categories' => array_map(static fn($k, $v) => ['key' => $k, 'label' => $v[0], 'critical' => $v[1], 'private' => $v[2]], array_keys(self::CATEGORIES), self::CATEGORIES),
            'roles' => self::ROLES,
            'policies' => $this->policies(),
            'templates' => $this->templates(),
            'mutedStats' => $this->q('SELECT muted FROM app_preference WHERE muted<>\'[]\' LIMIT 5000')->fetchAll(PDO::FETCH_COLUMN),
            'releases' => $this->q('SELECT id,platform,version,build,min_build,url,notes,published_at FROM app_release ORDER BY platform,build DESC LIMIT 60')->fetchAll(),
            'errors' => $this->q('SELECT HEX(hash) id,platform,version,message,page,role,first_at,last_at,count FROM app_error ORDER BY last_at DESC LIMIT 60')->fetchAll(),
            'deletionRequests' => $this->q("SELECT r.account_id,r.requested_at,r.status,r.processed_at,r.note,a.identifier FROM account_deletion_request r LEFT JOIN identity_account a ON a.id=r.account_id ORDER BY r.status='pending' DESC,r.requested_at DESC LIMIT 100")->fetchAll(),
            'providers' => $push->status(),
        ];
    }

    public function manage(object $body, int $now): array
    {
        $action = $body->action ?? '';
        switch ($action) {
            case 'policy':
                $c = $body->category ?? ''; $r = $body->role ?? '';
                if (!isset(self::CATEGORIES[$c]) || !isset(self::ROLES[$r]) || !is_bool($body->enabled ?? null)) throw new RuntimeException('Politika geçersiz.', 422);
                if (self::CATEGORIES[$c][1]) throw new RuntimeException('Kritik bildirimler kapatılamaz.', 422);
                $this->q('INSERT INTO app_policy(category,role,enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)', [$c, $r, (int)$body->enabled]);
                break;
            case 'template':
                $c = $body->category ?? '';
                if (!isset(self::CATEGORIES[$c])) throw new RuntimeException('Kategori geçersiz.', 422);
                $message = self::text($body->message ?? '', 400);
                $this->q('INSERT INTO app_template(category,title,body,message) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),body=VALUES(body),message=VALUES(message)',
                    [$c, self::text($body->title ?? '', 80, true), self::text($body->body ?? '', 160), $message === (self::MESSAGES[$c] ?? '') ? '' : $message]);
                break;
            case 'release':
                $p = $body->platform ?? '';
                if (!in_array($p, self::PLATFORMS, true)) throw new RuntimeException('Platform geçersiz.', 422);
                $build = (int)($body->build ?? 0); $min = (int)($body->minBuild ?? 0);
                if ($build < 1 || $build > 99999999 || $min < 0 || $min > $build) throw new RuntimeException('Derleme numarası geçersiz.', 422);
                $url = self::text($body->url ?? '', 300);
                if ($url !== '' && !preg_match('~\Ahttps://~', $url)) throw new RuntimeException('İndirme adresi https ile başlamalı.', 422);
                $this->q('INSERT INTO app_release(platform,version,build,min_build,url,notes,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)
                    ON DUPLICATE KEY UPDATE version=VALUES(version),min_build=VALUES(min_build),url=VALUES(url),notes=VALUES(notes),published_at=VALUES(published_at)',
                    [$p, self::text($body->version ?? '', 32, true), $build, $min, $url, self::text($body->notes ?? '', 1000), !empty($body->publish) ? $now : null, $now]);
                break;
            case 'releaseDelete':
                $this->q('DELETE FROM app_release WHERE id=?', [(int)($body->id ?? 0)]);
                break;
            case 'errorDelete':
                $this->q('DELETE FROM app_error WHERE '.(($body->id ?? '') === 'all' ? '1' : 'hash=UNHEX(?)'), ($body->id ?? '') === 'all' ? [] : [preg_replace('/[^A-F0-9]/', '', (string)($body->id ?? ''))]);
                break;
            case 'announce':
                return ['sent' => $this->announce($body, $now)] + $this->management($now);
            case 'deletion':
                $this->processDeletion((string)($body->account ?? ''), (string)($body->decision ?? ''), self::text($body->note ?? '', 300), $now);
                break;
            case 'providers':
                (new AppPush($this->db, $this->config))->saveSettings($body);
                break;
            case 'testPush':
                return ['test' => (new AppPush($this->db, $this->config))->test($now)] + $this->management($now);
            default:
                throw new RuntimeException('İşlem geçersiz.', 422);
        }
        return $this->management($now);
    }
}
