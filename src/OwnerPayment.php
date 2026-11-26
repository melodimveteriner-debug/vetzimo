<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Hasta sahibi borç ödemesi (hasta sahibi girişinden):
 * - Kartla: bayinin KENDİ PayTR mağazası; PayTR bildirimi imzayla doğrulanınca tutar en eski borçlu satıştan başlayarak
 *   tahsilat olarak kasaya işlenir (otomatik).
 * - Havale: bayinin IBAN'ı ve ödeme kodu gösterilir; hasta sahibi "havale yaptım" der, klinik (bayi/şube yöneticisi)
 *   bankada görünce onaylar, tahsilat o zaman işlenir.
 * Ayarlar bayiye özeldir; VetZimo merkezinin hesabı kullanılmaz.
 */
final class OwnerPayment
{
    private const ENDPOINT = 'https://www.paytr.com/odeme/api/get-token';

    public function __construct(private readonly PDO $db, private readonly string $key, private readonly array $config = []) {}

    private static function sid(string $partner): string { return substr(hash('sha256', 'owner-pay:'.$partner), 0, 32); }

    private function raw(string $partner): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='owner_pay'");
        $q->execute([self::sid($partner)]);
        return json_decode((string)$q->fetchColumn(), true) ?: [];
    }

    public function settings(string $partner, bool $secrets = false): array
    {
        $s = $this->raw($partner);
        $out = ['card' => ($s['card'] ?? false) === true, 'merchantId' => (string)($s['merchantId'] ?? ''), 'test' => ($s['test'] ?? true) === true,
            'hasKey' => ($s['key'] ?? '') !== '', 'hasSalt' => ($s['salt'] ?? '') !== '',
            'bank' => ($s['bank'] ?? false) === true, 'iban' => (string)($s['iban'] ?? ''), 'beneficiary' => (string)($s['beneficiary'] ?? ''), 'bankName' => (string)($s['bankName'] ?? ''),
            'banks' => array_values(array_filter(is_array($s['banks'] ?? null) ? $s['banks'] : [], 'is_array'))];
        if ($secrets) {
            $out['key'] = ($s['key'] ?? '') !== '' ? Totp::decrypt($s['key'], $this->key) : '';
            $out['salt'] = ($s['salt'] ?? '') !== '' ? Totp::decrypt($s['salt'], $this->key) : '';
        }
        return $out;
    }

    private static function manager(array $actor): void
    {
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Ödeme ayarlarını bayi yöneticisi değiştirebilir.', 403);
    }

    public function saveSettings(array $actor, object $b): array
    {
        self::manager($actor);
        $p = $actor['partner_id'];
        $old = $this->raw($p);
        $merchant = trim((string)($b->merchantId ?? ''));
        if ($merchant !== '' && !preg_match('/\A[0-9]{3,12}\z/', $merchant)) throw new RuntimeException('PayTR mağaza numarası yalnız rakamlardan oluşur.', 422);
        $iban = strtoupper(preg_replace('/\s+/', '', (string)($b->iban ?? '')) ?? '');
        if ($iban !== '' && !self::validIban($iban)) throw new RuntimeException('IBAN geçersiz (TR ile başlayan 26 karakter).', 422);
        $new = ['card' => ($b->card ?? false) === true, 'merchantId' => $merchant, 'test' => ($b->test ?? true) === true, 'key' => $old['key'] ?? '', 'salt' => $old['salt'] ?? '',
            'bank' => ($b->bank ?? false) === true, 'iban' => $iban, 'beneficiary' => mb_substr(trim((string)($b->beneficiary ?? '')), 0, 120), 'bankName' => mb_substr(trim((string)($b->bankName ?? '')), 0, 80)];
        // Ek banka hesapları (farklı bankalar için en çok 4 IBAN daha).
        $new['banks'] = [];
        foreach (is_array($b->banks ?? null) ? array_slice($b->banks, 0, 4) : [] as $x) {
            if (!is_object($x)) continue;
            $xi = strtoupper(preg_replace('/\s+/', '', (string)($x->iban ?? '')) ?? '');
            if ($xi === '') continue;
            if (!self::validIban($xi)) throw new RuntimeException('Ek banka hesabındaki IBAN geçersiz: '.$xi, 422);
            $new['banks'][] = ['iban' => $xi, 'beneficiary' => mb_substr(trim((string)($x->beneficiary ?? '')) ?: $new['beneficiary'], 0, 120), 'bankName' => mb_substr(trim((string)($x->bankName ?? '')), 0, 80)];
        }
        foreach (['key', 'salt'] as $f) {
            $v = trim((string)($b->$f ?? ''));
            if ($v === '') continue;
            if (!preg_match('/\A[A-Za-z0-9]{8,64}\z/', $v)) throw new RuntimeException('PayTR mağaza '.($f === 'key' ? 'parolası' : 'gizli anahtarı').' geçersiz.', 422);
            $new[$f] = Totp::encrypt($v, $this->key);
        }
        if ($new['card'] && ($new['merchantId'] === '' || $new['key'] === '' || $new['salt'] === '')) throw new RuntimeException('Kartla ödeme için PayTR mağaza numarası, parola ve gizli anahtar gerekli.', 422);
        if ($new['bank'] && ($new['iban'] === '' || $new['beneficiary'] === '')) throw new RuntimeException('Havale için IBAN ve alıcı adı gerekli.', 422);
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'owner_pay',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::sid($p), json_encode($new, JSON_THROW_ON_ERROR)]);
        return $this->dealer($actor);
    }

    public static function validIban(string $iban): bool
    {
        if (!preg_match('/\ATR[0-9]{24}\z/', $iban)) return false;
        $n = substr($iban, 4).'2927'.substr($iban, 2, 2); // TR = 29 27
        $r = 0;
        foreach (str_split($n, 7) as $part) $r = (int)(($r.$part) % 97);
        return $r === 1;
    }

    /** Klinik ekranı: ayarlar, onay bekleyen havaleler, son ödemeler. */
    public function dealer(array $actor): array
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch'], true)) throw new RuntimeException('Bu bölüm bayi ve şube yöneticilerine açıktır.', 403);
        $q = $this->db->prepare('SELECT id,branch_id,customer_name,amount,method,status,reference,created_at,paid_at,decided_by FROM owner_payment WHERE partner_id=? ORDER BY created_at DESC LIMIT 100');
        $q->execute([$actor['partner_id']]);
        $rows = array_map(static fn($r) => ['amount' => (int)$r['amount'], 'created_at' => (int)$r['created_at'], 'paid_at' => $r['paid_at'] === null ? null : (int)$r['paid_at'], 'code' => strtoupper(substr($r['id'], 0, 8))] + $r, $q->fetchAll(PDO::FETCH_ASSOC));
        if (($actor['role'] ?? '') === 'branch') $rows = array_values(array_filter($rows, static fn($r) => $r['branch_id'] === ($actor['branch_id'] ?? '')));
        return ['settings' => ($actor['role'] ?? '') === 'dealer' ? $this->settings($actor['partner_id']) : null, 'payments' => $rows];
    }

    /** Hasta sahibinin borçlu satışları (en eski önce) ve toplam borcu (kuruş). */
    private function debts(object $state, string $customer): array
    {
        $paid = [];
        foreach ($state->collections ?? [] as $c) if (is_string($c->sale ?? null)) $paid[$c->sale] = ($paid[$c->sale] ?? 0) + Finance::money((string)$c->amount);
        $rows = [];
        foreach ($state->sales ?? [] as $s) {
            if (($s->client ?? '') !== $customer) continue;
            $left = Finance::money((string)$s->amount) - Finance::money((string)($s->paid ?? '0')) - ($paid[$s->id] ?? 0);
            if ($left > 0) $rows[] = ['sale' => $s, 'left' => $left];
        }
        usort($rows, static fn($a, $b) => strcmp((string)($a['sale']->date ?? ''), (string)($b['sale']->date ?? '')));
        return $rows;
    }

    /** Yalnız bu hasta sahibinin kayıtları (büyük kliniklerde tüm veri yüklenmez). */
    private function ownerState(string $partner, string $customer): ?object
    {
        $slice = (new ClinicRecords($this->db))->ownerSlice('partner:'.$partner, $customer);
        return $slice ?? (new WorkspaceRepository($this->db))->load('partner:'.$partner)['state'];
    }

    /** Hasta sahibi: borç, açık ödeme yöntemleri, havale bilgisi, son ödemeleri. */
    public function owner(array $actor): array
    {
        if (($actor['role'] ?? '') !== 'customer') throw new RuntimeException('Hasta sahibi girişi gerekli.', 403);
        $state = $this->ownerState($actor['partner_id'], (string)$actor['customer_id']);
        $debt = array_sum(array_column($state ? $this->debts($state, (string)$actor['customer_id']) : [], 'left'));
        $s = $this->settings($actor['partner_id']);
        $q = $this->db->prepare('SELECT id,amount,method,status,created_at FROM owner_payment WHERE partner_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 10');
        $q->execute([$actor['partner_id'], $actor['customer_id']]);
        return ['debt' => $debt, 'card' => $s['card'], 'bank' => $s['bank'] ? ['iban' => $s['iban'], 'beneficiary' => $s['beneficiary'], 'bankName' => $s['bankName']] : null,
            'banks' => $s['bank'] ? array_merge([['iban' => $s['iban'], 'beneficiary' => $s['beneficiary'], 'bankName' => $s['bankName']]], $s['banks']) : [],
            'payments' => array_map(static fn($r) => ['amount' => (int)$r['amount'], 'created_at' => (int)$r['created_at'], 'code' => strtoupper(substr($r['id'], 0, 8))] + $r, $q->fetchAll(PDO::FETCH_ASSOC))];
    }

    /** Hasta sahibi ödeme başlatır. Kart: PayTR ödeme sayfası adresi; havale: ödeme kodu ve IBAN. */
    public function start(array $actor, object $b, string $ip, string $origin, int $now, string $back = ''): array
    {
        $info = $this->owner($actor);
        $method = (string)($b->method ?? '');
        $amount = is_int($b->amount ?? null) ? $b->amount : (int)round(((float)($b->amount ?? 0)) * 100);
        if (!in_array($method, ['card', 'bank'], true)) throw new RuntimeException('Ödeme yöntemi seçin.', 422);
        if ($method === 'card' && !$info['card'] || $method === 'bank' && !$info['bank']) throw new RuntimeException('Bu ödeme yöntemi kliniğinizde açık değil.', 422);
        if ($info['debt'] <= 0) throw new RuntimeException('Ödenecek borcunuz bulunmuyor.', 422);
        if ($amount < 100 || $amount > $info['debt']) throw new RuntimeException('Tutar 1,00 TL ile borcunuz arasında olmalı.', 422);
        $open = $this->db->prepare("SELECT COUNT(*) FROM owner_payment WHERE partner_id=? AND customer_id=? AND status IN ('pending','review') AND created_at>?");
        $open->execute([$actor['partner_id'], $actor['customer_id'], $now - 86400]);
        if ((int)$open->fetchColumn() >= 5) throw new RuntimeException('Bekleyen ödeme talepleriniz var. Klinik onayladıktan sonra yeniden deneyin.', 429);
        $id = bin2hex(random_bytes(16));
        $state = $this->ownerState($actor['partner_id'], (string)$actor['customer_id']);
        $client = null;
        foreach ($state->clients ?? [] as $c) if (($c->id ?? '') === $actor['customer_id']) { $client = $c; break; }
        $this->db->prepare('INSERT INTO owner_payment(id,partner_id,branch_id,customer_id,membership_id,customer_name,amount,method,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $actor['partner_id'], (string)($client->branch ?? $actor['branch_id'] ?? ''), $actor['customer_id'], $actor['membership_id'],
                mb_substr((string)($client->name ?? $actor['name'] ?? ''), 0, 160), $amount, $method, 'pending', $now]);
        $code = strtoupper(substr($id, 0, 8));
        if ($method === 'bank') return ['id' => $id, 'method' => 'bank', 'code' => $code, 'amount' => $amount, 'bank' => $info['bank']];
        return ['id' => $id, 'method' => 'card', 'url' => $this->token($id, $actor, $client, $amount, $ip, $origin, $back)];
    }

    private function token(string $id, array $actor, ?object $client, int $amount, string $ip, string $origin, string $back = ''): string
    {
        $s = $this->settings($actor['partner_id'], true);
        $q = $this->db->prepare('SELECT name FROM partner_account WHERE id=?');
        $q->execute([$actor['partner_id']]);
        $clinic = (string)$q->fetchColumn();
        $email = filter_var($client->email ?? '', FILTER_VALIDATE_EMAIL) ? $client->email : 'odeme@vetzimo.com';
        $oid = 'VZO'.$id;
        $basket = base64_encode(json_encode([[$clinic.' · borç ödemesi', number_format($amount / 100, 2, '.', ''), 1]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $test = $s['test'] ? '1' : '0';
        $hash = $s['merchantId'].$ip.$oid.$email.$amount.$basket.'0'.'0'.'TL'.$test;
        $fields = ['merchant_id' => $s['merchantId'], 'user_ip' => $ip, 'merchant_oid' => $oid, 'email' => $email, 'payment_amount' => (string)$amount,
            'paytr_token' => base64_encode(hash_hmac('sha256', $hash.$s['salt'], $s['key'], true)), 'user_basket' => $basket, 'debug_on' => $test,
            'no_installment' => '0', 'max_installment' => '0', 'user_name' => mb_substr((string)($client->name ?? 'Hasta sahibi'), 0, 60), 'user_address' => 'Türkiye',
            'user_phone' => preg_replace('/\D/', '', (string)($client->phone ?? '')) ?: '05000000000', 'merchant_ok_url' => $back !== '' ? $back.'?sonuc=tamam' : $origin.'/app#odeme-tamam',
            'merchant_fail_url' => $back !== '' ? $back.'?sonuc=hata' : $origin.'/app#odeme-hata', 'timeout_limit' => '30', 'currency' => 'TL', 'test_mode' => $test, 'lang' => 'tr'];
        $endpoint = (string)($this->config['paytrEndpoint'] ?? self::ENDPOINT);
        if ($endpoint !== self::ENDPOINT && !preg_match('~\Ahttp://127\.0\.0\.1:\d+/~', $endpoint)) throw new RuntimeException('Ödeme adresi geçersiz.', 503);
        $c = curl_init($endpoint);
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($fields), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => false]);
        $raw = curl_exec($c);
        curl_close($c);
        $res = is_string($raw) ? json_decode($raw, true) : null;
        if (($res['status'] ?? '') !== 'success' || !is_string($res['token'] ?? null) || !preg_match('/\A[A-Za-z0-9]{8,128}\z/', $res['token'])) {
            $this->db->prepare("UPDATE owner_payment SET status='failed' WHERE id=?")->execute([$id]);
            throw new RuntimeException('Ödeme sayfası açılamadı'.(isset($res['reason']) ? ': '.mb_substr((string)$res['reason'], 0, 160) : '.'), 502);
        }
        return 'https://www.paytr.com/odeme/guvenli/'.$res['token'];
    }

    /** Hasta sahibi havale yaptığını bildirir (isteğe bağlı banka referansı). */
    public function notifyBank(array $actor, object $b): array
    {
        $id = (string)($b->id ?? '');
        $ref = mb_substr(trim((string)($b->reference ?? '')), 0, 100);
        $q = $this->db->prepare("UPDATE owner_payment SET status='review',reference=? WHERE id=? AND partner_id=? AND customer_id=? AND method='bank' AND status='pending'");
        $q->execute([$ref, $id, $actor['partner_id'], $actor['customer_id']]);
        if (!$q->rowCount()) throw new RuntimeException('Bildirim bekleyen havale bulunamadı.', 409);
        return $this->owner($actor);
    }

    /** PayTR bildirimi (bayinin mağazası): imza o bayinin anahtarıyla doğrulanır. PayTR'ye "OK" döner. */
    public function callback(array $post, int $now): string
    {
        $oid = (string)($post['merchant_oid'] ?? '');
        if (!preg_match('/\AVZO([a-f0-9]{32})\z/', $oid, $m)) throw new RuntimeException('Sipariş bulunamadı.', 404);
        $q = $this->db->prepare('SELECT * FROM owner_payment WHERE id=?');
        $q->execute([$m[1]]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Sipariş bulunamadı.', 404);
        $s = $this->settings($row['partner_id'], true);
        $status = (string)($post['status'] ?? '');
        $total = (string)($post['total_amount'] ?? '');
        $expected = base64_encode(hash_hmac('sha256', $oid.$s['salt'].$status.$total, $s['key'], true));
        if ($s['key'] === '' || !hash_equals($expected, (string)($post['hash'] ?? ''))) throw new RuntimeException('Ödeme bildirimi imzası geçersiz.', 400);
        if ($row['status'] !== 'pending') return 'OK';
        if ($status === 'success' && ctype_digit($total) && (int)$total >= (int)$row['amount']) $this->apply($row, 'Kredi kartı (online)', 'PayTR', $now);
        else $this->db->prepare("UPDATE owner_payment SET status='failed',reference=? WHERE id=? AND status='pending'")->execute([mb_substr((string)($post['failed_reason_msg'] ?? 'Ödeme tamamlanmadı'), 0, 100), $row['id']]);
        return 'OK';
    }

    /** Klinik: havaleyi onayla/reddet. */
    public function decide(array $actor, object $b, int $now): array
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch'], true)) throw new RuntimeException('Bu işlem bayi ve şube yöneticilerine açıktır.', 403);
        $id = (string)($b->id ?? '');
        $q = $this->db->prepare("SELECT * FROM owner_payment WHERE id=? AND partner_id=? AND method='bank' AND status IN ('pending','review')");
        $q->execute([$id, $actor['partner_id']]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Onay bekleyen havale bulunamadı.', 409);
        if (($actor['role'] ?? '') === 'branch' && $row['branch_id'] !== ($actor['branch_id'] ?? '')) throw new RuntimeException('Bu havale başka şubeye ait.', 403);
        $by = mb_substr((string)($actor['name'] ?? $actor['identifier'] ?? 'Klinik'), 0, 120);
        if (($b->action ?? '') === 'approve') {
            if (($b->verified ?? false) !== true) throw new RuntimeException('Tutarın hesabınıza geçtiğini işaretleyin.', 422);
            $this->apply($row, 'Havale/EFT', $by, $now);
        } elseif (($b->action ?? '') === 'reject') {
            $this->db->prepare("UPDATE owner_payment SET status='rejected',decided_by=? WHERE id=?")->execute([$by, $id]);
        } else throw new RuntimeException('Karar geçersiz.', 422);
        return $this->dealer($actor);
    }

    // ---------------- Ödeme talebi: hesapsız ödeme bağlantısı (/p/…) ----------------
    private const LINK_TTL = 1209600; // 14 gün

    private function linkTable(): void
    {
        $this->db->exec("CREATE TABLE IF NOT EXISTS owner_pay_link (
            token_hash char(64) CHARACTER SET ascii NOT NULL,
            partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            customer_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            branch_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
            amount int unsigned NOT NULL DEFAULT 0,
            created_by varchar(120) NOT NULL DEFAULT '',
            created_at int unsigned NOT NULL,
            expires_at int unsigned NOT NULL,
            PRIMARY KEY (token_hash),
            KEY owner_pay_link_customer (partner_id, customer_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public static function tl(int $cents): string
    {
        return number_format($cents / 100, 2, ',', '.').' TL';
    }

    /**
     * Klinik: seçilen borçlu hasta sahiplerine ödeme talebi. Her birine toplam borç, kısa ödeme bağlantısı, klinik adı ve telefonu
     * içeren SMS (kliniğin hattından) gider; hasta sahibinin uygulama/portal hesabı varsa aynı anda bildirim de düşer.
     */
    public function request(array $actor, object $b, int $now, string $origin): array
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'sales', true)) throw new RuntimeException('Ödeme talebi için satış yetkisi gerekli.', 403);
        $s = $this->settings($actor['partner_id']);
        if (!$s['card'] && !$s['bank']) throw new RuntimeException('Önce Ayarlar › Hasta sahibi ödemeleri bölümünden kartla ödeme (PayTR) veya havale/EFT IBAN bilgisini açın.', 422);
        $ids = array_values(array_unique(array_filter(is_array($b->clients ?? null) ? $b->clients : [], 'is_string')));
        if (!$ids || count($ids) > 200) throw new RuntimeException('En az bir, en çok 200 hasta sahibi seçin.', 422);
        $clinic = $this->db->prepare('SELECT name,phone FROM partner_account WHERE id=?');
        $clinic->execute([$actor['partner_id']]);
        $partner = $clinic->fetch(PDO::FETCH_ASSOC) ?: ['name' => 'Kliniğiniz', 'phone' => ''];
        $gateway = new PhoneGateway($this->db);
        $sms = (bool)$gateway->route($actor['partner_id'], 'sms');
        $hub = new AppHub($this->db);
        $results = [];
        foreach ($ids as $id) {
            $state = $this->ownerState($actor['partner_id'], $id);
            $client = null;
            foreach ($state->clients ?? [] as $c) if (($c->id ?? '') === $id) { $client = $c; break; }
            if (!$client) { $results[] = ['client' => $id, 'status' => 'skipped', 'reason' => 'Kayıt bulunamadı']; continue; }
            $branch = ClinicAccess::branch($state, (string)($client->branch ?? ''));
            if (($actor['role'] ?? '') !== 'dealer') {
                $own = ClinicAccess::branch($state, (string)($actor['branch_id'] ?? ''));
                if (!$own || (($own->sharedWith ?? '') ?: $own->id) !== ($client->branch ?? '')) { $results[] = ['client' => $id, 'name' => $client->name ?? '', 'status' => 'skipped', 'reason' => 'Başka şubenin kaydı']; continue; }
            }
            $debt = array_sum(array_column($this->debts($state, $id), 'left'));
            if ($debt <= 0) { $results[] = ['client' => $id, 'name' => $client->name ?? '', 'status' => 'skipped', 'reason' => 'Borcu yok']; continue; }
            $token = ClientPermit::shortToken();
            $store = fn() => $this->db->prepare('INSERT INTO owner_pay_link(token_hash,partner_id,customer_id,branch_id,amount,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([hash('sha256', $token), $actor['partner_id'], $id, (string)($client->branch ?? ''), $debt, mb_substr((string)($actor['name'] ?? ''), 0, 120), $now, $now + self::LINK_TTL]);
            try { $store(); } catch (\PDOException $e) { if ($e->getCode() !== '42S02') throw $e; $this->linkTable(); $store(); }
            $url = rtrim($origin, '/').'/p/'.$token;
            $short = preg_replace('~\Ahttps://~', '', $url);
            $clinicName = (string)($branch->name ?? '') !== '' && ($branch->name ?? '') !== 'Merkez' ? $partner['name'].' '.$branch->name : $partner['name'];
            $phone = (string)(($branch->phone ?? '') ?: ($state->preferences->phone ?? '') ?: $partner['phone']);
            $name = trim((string)($client->name ?? ''));
            $text = $clinicName.': Sayın '.$name.', toplam '.self::tl($debt).' ödemeniz bulunmaktadır. Güvenli ödeme: '.$short.($phone !== '' ? ' Bilgi: '.$phone : '');
            $result = ['client' => $id, 'name' => $name, 'amount' => $debt, 'url' => $url, 'text' => $text, 'sms' => 'none', 'app' => false];
            $to = DealerLogin::normalizePhone((string)($client->phone ?? ''));
            if ($to !== '' && $sms) {
                try { $gateway->enqueue($actor['partner_id'], 'sms', $to, $text, 'manual', 'payreq:'.$id.':'.$now, 0, $now, $now + 3 * 86400, (string)($actor['name'] ?? '')); $result['sms'] = 'queued'; }
                catch (\Throwable $e) { $result['sms'] = 'failed'; $result['reason'] = $e->getMessage(); }
            } elseif ($to !== '') {
                $result['sms'] = 'manual';
                $result['whatsappLink'] = PhoneGateway::waLink($to, $text);
            }
            // Uygulama ve hasta sahibi portalı bildirimi (hesabı olan hasta sahibine).
            $m = $this->db->prepare("SELECT id,account_id FROM identity_membership WHERE partner_id=? AND role='customer' AND customer_id=? AND status='active'");
            $m->execute([$actor['partner_id'], $id]);
            foreach ($m->fetchAll(PDO::FETCH_ASSOC) as $mem) {
                if ($hub->notify($mem['account_id'], $mem['id'], 'customer', 'payments', $clinicName.' · ödeme talebi', 'Toplam '.self::tl($debt).' ödemeniz bulunuyor. Kartla veya havale ile ödeyebilirsiniz.', '/p/'.$token, 'payreq:'.$id.':'.$now, $now)) $result['app'] = true;
            }
            (new DeliveryNotice($this->db))->add($actor['partner_id'], (string)($client->branch ?? ''), $id, 'payments', 'payreq:'.$id.':'.$now, 'Ödeme talebi: '.self::tl($debt), '/p/'.$token);
            $result['status'] = 'sent';
            $results[] = $result;
        }
        return ['results' => $results, 'sms' => $sms];
    }

    /** Bağlantı → hasta sahibi kimliği (giriş gerekmez; bağlantı 14 gün geçerli). */
    private function linkActor(string $token, int $now): array
    {
        if (!preg_match('/\A[A-Za-z0-9]{10}\z/', $token)) throw new RuntimeException('Bağlantı geçersiz.', 404);
        try {
            $q = $this->db->prepare('SELECT * FROM owner_pay_link WHERE token_hash=?');
            $q->execute([hash('sha256', $token)]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
        } catch (\PDOException) { $row = false; }
        if (!$row) throw new RuntimeException('Ödeme bağlantısı geçersiz.', 404);
        if ((int)$row['expires_at'] < $now) throw new RuntimeException('Ödeme bağlantısının süresi doldu. Kliniğinizden yeni bağlantı isteyin.', 410);
        return ['role' => 'customer', 'partner_id' => $row['partner_id'], 'customer_id' => $row['customer_id'], 'branch_id' => $row['branch_id'], 'membership_id' => 'link', 'name' => ''];
    }

    /** Ödeme sayfası verisi: klinik, hasta sahibi adı, güncel borç ve açık yöntemler. */
    public function linkInfo(string $token, int $now): array
    {
        $actor = $this->linkActor($token, $now);
        $info = $this->owner($actor);
        $state = $this->ownerState($actor['partner_id'], $actor['customer_id']);
        $client = null;
        foreach ($state->clients ?? [] as $c) if (($c->id ?? '') === $actor['customer_id']) { $client = $c; break; }
        $q = $this->db->prepare('SELECT name,phone FROM partner_account WHERE id=?');
        $q->execute([$actor['partner_id']]);
        $p = $q->fetch(PDO::FETCH_ASSOC) ?: ['name' => '', 'phone' => ''];
        $branch = ClinicAccess::branch($state, (string)($client->branch ?? ''));
        return $info + ['clinic' => $p['name'], 'phone' => (string)(($branch->phone ?? '') ?: ($state->preferences->phone ?? '') ?: $p['phone']), 'name' => (string)($client->name ?? '')];
    }

    /** Ödeme sayfası işlemleri: card (PayTR sayfası), bank (ödeme kodu + IBAN), notify (havale yaptım). */
    public function linkAction(string $token, object $b, string $ip, string $origin, int $now): array
    {
        $actor = $this->linkActor($token, $now);
        if (($b->op ?? '') === 'notify') { $this->notifyBank($actor, $b); return ['ok' => true]; }
        return $this->start($actor, $b, $ip, $origin, $now, rtrim($origin, '/').'/p/'.$token);
    }

    public static function linkPage(string $token): string
    {
        $t = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
        return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">'
            .'<title>Güvenli ödeme</title><link rel="stylesheet" href="/permit-sign.css?v=4"><link rel="stylesheet" href="/owner-pay-link.css?v=1"></head><body><main class="pm" id="payRoot" data-token="'.$t.'">'
            .'<section class="pm-card"><p>Yükleniyor…</p></section></main><script src="/owner-pay-link.js?v=1" type="module"></script></body></html>';
    }

    /** Tutarı en eski borçlu satıştan başlayarak tahsilat olarak kasaya işler. Fazla kalan kısım işlenmez (borç kadar). */
    private function apply(array $row, string $method, string $by, int $now): void
    {
        $repo = new WorkspaceRepository($this->db);
        for ($try = 0; $try < 3; $try++) {
            $data = $repo->load('partner:'.$row['partner_id']);
            $state = $data['state'];
            if (!$state) throw new RuntimeException('Klinik verisi bulunamadı.', 404);
            $old = unserialize(serialize($state));
            $left = (int)$row['amount'];
            $date = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
            foreach ($this->debts($state, $row['customer_id']) as $d) {
                if ($left <= 0) break;
                $part = min($left, $d['left']);
                $state->collections[] = (object)['id' => bin2hex(random_bytes(16)), 'branch' => $d['sale']->branch, 'sale' => $d['sale']->id, 'date' => $date,
                    'amount' => intdiv($part, 100).'.'.sprintf('%02d', $part % 100), 'method' => $method, 'notes' => 'Hasta sahibi online ödeme · '.strtoupper(substr($row['id'], 0, 8))];
                $left -= $part;
            }
            Finance::validate($old, $state);
            if ($repo->save('partner:'.$row['partner_id'], $data['revision'], $state) !== null) {
                $this->db->prepare("UPDATE owner_payment SET status='paid',paid_at=?,decided_by=? WHERE id=?")->execute([$now, $by, $row['id']]);
                return;
            }
        }
        throw new RuntimeException('Kasa güncellendi. Tekrar deneyin.', 409);
    }
}
