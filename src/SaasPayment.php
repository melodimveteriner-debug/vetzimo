<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Abonelik mağazası: demo/denemeden pakete geçiş ve yenileme. Kredi kartı (PayTR iFrame) ya da EFT/havale.
 * Kart ödemesi PayTR'nin sunucudan sunucuya bildirimiyle (imza doğrulanarak) onaylanınca abonelik otomatik açılır;
 * havale bildirimi yönetici onayıyla açılır. PayTR mağaza bilgileri yönetici panelinden girilir, gizli anahtarlar şifreli saklanır.
 */
final class SaasPayment
{
    private const SETTINGS_ID = '00000000000000000000000000000002';
    private const ENDPOINT = 'https://www.paytr.com/odeme/api/get-token';

    public function __construct(private readonly PDO $db, private readonly string $key, private readonly array $config = []) {}

    // ---------------- Ayarlar ----------------
    public function settings(bool $withSecrets = false): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='paytr'");
        $q->execute([self::SETTINGS_ID]);
        $s = json_decode((string)$q->fetchColumn(), true) ?: [];
        $out = ['enabled' => ($s['enabled'] ?? false) === true, 'merchantId' => (string)($s['merchantId'] ?? ''), 'test' => ($s['test'] ?? true) === true,
            'hasKey' => ($s['key'] ?? '') !== '', 'hasSalt' => ($s['salt'] ?? '') !== ''];
        if ($withSecrets) {
            $out['key'] = ($s['key'] ?? '') !== '' ? Totp::decrypt($s['key'], $this->key) : '';
            $out['salt'] = ($s['salt'] ?? '') !== '' ? Totp::decrypt($s['salt'], $this->key) : '';
        }
        return $out;
    }

    public function saveSettings(object $b): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='paytr'");
        $q->execute([self::SETTINGS_ID]);
        $old = json_decode((string)$q->fetchColumn(), true) ?: [];
        $merchant = trim((string)($b->merchantId ?? ''));
        if ($merchant !== '' && !preg_match('/\A[0-9]{3,12}\z/', $merchant)) throw new RuntimeException('PayTR mağaza numarası yalnız rakamlardan oluşur.', 422);
        $new = ['enabled' => ($b->enabled ?? false) === true, 'merchantId' => $merchant, 'test' => ($b->test ?? true) === true,
            'key' => $old['key'] ?? '', 'salt' => $old['salt'] ?? ''];
        foreach (['key', 'salt'] as $f) {
            $v = trim((string)($b->$f ?? ''));
            if ($v === '') continue;
            if (!preg_match('/\A[A-Za-z0-9]{8,64}\z/', $v)) throw new RuntimeException('PayTR mağaza '.($f === 'key' ? 'parolası' : 'gizli anahtarı').' geçersiz.', 422);
            $new[$f] = Totp::encrypt($v, $this->key);
        }
        if ($new['enabled'] && ($new['merchantId'] === '' || $new['key'] === '' || $new['salt'] === '')) throw new RuntimeException('Kart ödemesini açmak için mağaza numarası, parola ve gizli anahtar gerekli.', 422);
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'paytr',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::SETTINGS_ID, json_encode($new, JSON_THROW_ON_ERROR)]);
        return $this->settings();
    }

    private function bank(): ?string
    {
        $q = $this->db->query("SELECT payload FROM center_management WHERE kind='shop_bank' ORDER BY updated_at DESC LIMIT 1");
        $s = json_decode((string)$q->fetchColumn(), true);
        return $s && ($s['enabled'] ?? '') === 'yes' ? $s['beneficiary'].' · '.$s['iban'] : null;
    }

    public function methods(): array
    {
        return ['card' => $this->settings()['enabled'], 'bank' => $this->bank() !== null];
    }

    // ---------------- Fiyat ----------------
    public static function amount(array $plan, string $period): ?int
    {
        $price = $plan[$period] ?? null;
        if (!is_int($price) || $price <= 0) return null;
        return ($plan['vat'] ?? 'included') === 'excluded' ? (int)round($price * 1.2) : $price;
    }

    // ---------------- Sipariş ----------------
    public function orders(string $partner): array
    {
        $q = $this->db->prepare('SELECT id,plan_id,plan_name,period,amount,method,status,reference,instruction,starts_on,ends_on,created_at,paid_at FROM saas_order WHERE partner_id=? ORDER BY created_at DESC LIMIT 100');
        $q->execute([$partner]);
        return array_map(static fn($r) => ['amount' => (int)$r['amount'], 'created_at' => (int)$r['created_at'], 'paid_at' => $r['paid_at'] === null ? null : (int)$r['paid_at']] + $r, $q->fetchAll(PDO::FETCH_ASSOC));
    }

    /** Kart: PayTR ödeme sayfası jetonu döner; havale: talimat döner. Aynı istek kimliği tekrar gönderilirse aynı sipariş döner. */
    public function order(array $actor, object $b, string $ip, string $origin, int $now): array
    {
        $request = (string)($b->requestId ?? '');
        $method = (string)($b->method ?? '');
        $period = (string)($b->period ?? '');
        if (!preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/', $request) || !in_array($method, ['card', 'bank'], true) || !in_array($period, ['monthly', 'yearly'], true)) {
            throw new RuntimeException('Sipariş bilgilerini kontrol edin.', 422);
        }
        $plan = (new Commerce($this->db))->publishedCatalog()[(string)($b->planId ?? '')] ?? null;
        $amount = $plan ? self::amount($plan, $period) : null;
        if (!$plan || $amount === null) throw new RuntimeException('Bu paket çevrim içi satışta değil; teklif için destek talebi açın.', 422);
        $id = substr(hash('sha256', 'saas:'.$actor['partner_id'].':'.$request), 0, 32);
        $q = $this->db->prepare('SELECT * FROM saas_order WHERE id=?');
        $q->execute([$id]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $bank = $this->bank();
            if ($method === 'bank' && !$bank) throw new RuntimeException('Havale ile ödeme şu anda kapalı.', 422);
            if ($method === 'card' && !$this->settings()['enabled']) throw new RuntimeException('Kartla ödeme şu anda kapalı.', 422);
            $this->db->prepare('INSERT INTO saas_order(id,partner_id,plan_id,plan_name,period,amount,method,status,instruction,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $actor['partner_id'], $plan['id'], mb_substr($plan['name'], 0, 120), $period, $amount, $method, 'pending',
                    $method === 'bank' ? 'Açıklamaya sipariş numarasını yazın: '.strtoupper(substr($id, 0, 10)).' · '.$bank : '', mb_substr((string)($actor['name'] ?? ''), 0, 120), $now]);
            $q->execute([$id]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
        }
        if ($row['plan_id'] !== $plan['id'] || $row['period'] !== $period) throw new RuntimeException('Sipariş anahtarı başka bir paket için kullanılmış.', 409);
        if ($row['method'] === 'card' && $row['status'] === 'pending') return ['id' => $id, 'method' => 'card', 'iframe' => $this->token($row, $actor, $ip, $origin)];
        return ['id' => $id, 'method' => $row['method'], 'status' => $row['status'], 'instruction' => $row['instruction']];
    }

    private function token(array $row, array $actor, string $ip, string $origin): string
    {
        $s = $this->settings(true);
        $q = $this->db->prepare('SELECT name,email,phone FROM partner_account WHERE id=?');
        $q->execute([$row['partner_id']]);
        $p = $q->fetch(PDO::FETCH_ASSOC) ?: ['name' => '', 'email' => '', 'phone' => ''];
        $email = filter_var($p['email'], FILTER_VALIDATE_EMAIL) ? $p['email'] : 'odeme@vetzimo.com';
        $amount = (string)$row['amount'];
        $basket = base64_encode(json_encode([[$row['plan_name'].' · '.($row['period'] === 'yearly' ? 'Yıllık' : 'Aylık'), number_format($row['amount'] / 100, 2, '.', ''), 1]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $test = $s['test'] ? '1' : '0';
        $hash = $s['merchantId'].$ip.$row['id'].$email.$amount.$basket.'0'.'0'.'TL'.$test;
        $fields = ['merchant_id' => $s['merchantId'], 'user_ip' => $ip, 'merchant_oid' => $row['id'], 'email' => $email, 'payment_amount' => $amount,
            'paytr_token' => base64_encode(hash_hmac('sha256', $hash.$s['salt'], $s['key'], true)), 'user_basket' => $basket, 'debug_on' => $s['test'] ? '1' : '0',
            'no_installment' => '0', 'max_installment' => '0', 'user_name' => mb_substr($p['name'] ?: 'VetZimo bayi', 0, 60), 'user_address' => 'Türkiye',
            'user_phone' => preg_replace('/\D/', '', $p['phone']) ?: '05000000000', 'merchant_ok_url' => $origin.'/clinic#kredi-magazasi/odeme-tamam',
            'merchant_fail_url' => $origin.'/clinic#kredi-magazasi/odeme-hata', 'timeout_limit' => '30', 'currency' => 'TL', 'test_mode' => $test, 'lang' => 'tr'];
        $endpoint = (string)($this->config['paytrEndpoint'] ?? self::ENDPOINT);
        if ($endpoint !== self::ENDPOINT && !preg_match('~\Ahttp://127\.0\.0\.1:\d+/~', $endpoint)) throw new RuntimeException('Ödeme adresi geçersiz.', 503);
        $c = curl_init($endpoint);
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($fields), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => false]);
        $raw = curl_exec($c);
        curl_close($c);
        $res = is_string($raw) ? json_decode($raw, true) : null;
        if (($res['status'] ?? '') !== 'success' || !is_string($res['token'] ?? null) || !preg_match('/\A[A-Za-z0-9]{8,128}\z/', $res['token'])) {
            throw new RuntimeException('Ödeme sayfası açılamadı'.(isset($res['reason']) ? ': '.mb_substr((string)$res['reason'], 0, 160) : '.'), 502);
        }
        return 'https://www.paytr.com/odeme/guvenli/'.$res['token'];
    }

    public function reference(array $actor, object $b): void
    {
        $id = (string)($b->id ?? '');
        $ref = trim((string)($b->reference ?? ''));
        if (!preg_match('/\A[a-f0-9]{32}\z/', $id) || !preg_match('/\A[^\p{Cc}]{1,100}\z/u', $ref)) throw new RuntimeException('Geçerli banka işlem referansını girin.', 422);
        $q = $this->db->prepare("UPDATE saas_order SET reference=?,status='review' WHERE id=? AND partner_id=? AND method='bank' AND status='pending'");
        $q->execute([$ref, $id, $actor['partner_id']]);
        if (!$q->rowCount()) throw new RuntimeException('Ödeme bildirimi bekleyen sipariş bulunamadı.', 409);
        $this->alert($id, 'Havale bildirimi', 'havale bildirdi · referans: '.$ref.'. Bankada doğrulayıp Ödeme Kanalları’ndan onaylayın.', 'bank:'.$id);
    }

    /** Bayi ödeme olayı → yalnız merkez: panel uyarısı + yöneticiye SMS, WhatsApp ve e-posta (bayiye hiçbir şey gitmez). */
    private function alert(string $orderId, string $title, string $text, string $key): void
    {
        try {
            $q = $this->db->prepare('SELECT o.plan_name,o.period,o.amount,p.name FROM saas_order o LEFT JOIN partner_account p ON p.id=o.partner_id WHERE o.id=?');
            $q->execute([$orderId]);
            $r = $q->fetch(PDO::FETCH_ASSOC);
            if (!$r) return;
            $money = number_format(((int)$r['amount']) / 100, 2, ',', '.').' TL';
            $body = ($r['name'] ?: 'Bayi').' · '.$r['plan_name'].' ('.($r['period'] === 'yearly' ? 'yıllık' : 'aylık').') · '.$money.' · '.$text;
            (new CenterContact($this->db, $this->key))->alert($title, $body, '/yonetim?tab=odeme-kanallari', 'saas:'.$key, time(), ['dealer']);
        } catch (\Throwable $e) { error_log('VetZimo payment alert: '.get_class($e)); }
    }

    /** PayTR sunucu bildirimi. İmza doğrulanmazsa hiçbir şey değişmez. Her durumda PayTR'ye "OK" dönülmesi gerekir (geçerli imzada). */
    public function callback(array $post, int $now): string
    {
        $s = $this->settings(true);
        if ($s['key'] === '' || $s['salt'] === '') throw new RuntimeException('Ödeme ayarı yok.', 503);
        $oid = (string)($post['merchant_oid'] ?? '');
        $status = (string)($post['status'] ?? '');
        $total = (string)($post['total_amount'] ?? '');
        $expected = base64_encode(hash_hmac('sha256', $oid.$s['salt'].$status.$total, $s['key'], true));
        if (!hash_equals($expected, (string)($post['hash'] ?? ''))) throw new RuntimeException('Ödeme bildirimi imzası geçersiz.', 400);
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare("SELECT * FROM saas_order WHERE id=? AND method='card' FOR UPDATE");
            $q->execute([$oid]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
            if ($row && $row['status'] === 'pending') {
                if ($status === 'success' && ctype_digit($total) && (int)$total >= (int)$row['amount']) {
                    $this->activate($row, $now);
                    $paidNow = true;
                } else {
                    $this->db->prepare("UPDATE saas_order SET status='failed',reference=? WHERE id=?")->execute([mb_substr((string)($post['failed_reason_msg'] ?? 'Ödeme tamamlanmadı'), 0, 100), $oid]);
                }
            }
            $this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        if (isset($paidNow)) $this->alert($oid, 'Kartla ödeme alındı', 'PayTR ile ödendi; abonelik otomatik yenilendi.', 'card:'.$oid);
        return 'OK';
    }

    /** Yönetici: havale siparişi onay/ret (onayda abonelik açılır). */
    public function review(object $b, int $now): void
    {
        $id = (string)($b->id ?? '');
        $action = (string)($b->action ?? '');
        if (!preg_match('/\A[a-f0-9]{32}\z/', $id) || !in_array($action, ['approved', 'rejected'], true)) throw new RuntimeException('Karar geçersiz.', 422);
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare("SELECT * FROM saas_order WHERE id=? FOR UPDATE");
            $q->execute([$id]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
            if (!$row || !in_array($row['status'], ['review', 'pending'], true) || $row['method'] !== 'bank') throw new RuntimeException('Onay bekleyen havale siparişi bulunamadı.', 409);
            if ($action === 'approved') {
                if (($b->verified ?? false) !== true) throw new RuntimeException('Tutarın bankada doğrulandığını işaretleyin.', 422);
                $this->activate($row, $now);
            } else {
                $this->db->prepare("UPDATE saas_order SET status='rejected' WHERE id=?")->execute([$id]);
            }
            $this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function adminOrders(): array
    {
        return array_map(static fn($r) => ['amount' => (int)$r['amount'], 'created_at' => (int)$r['created_at']] + $r,
            $this->db->query('SELECT o.*,p.name AS partner_name FROM saas_order o LEFT JOIN partner_account p ON p.id=o.partner_id ORDER BY o.created_at DESC LIMIT 300')->fetchAll(PDO::FETCH_ASSOC));
    }

    /** Paket sırası: pakette "rank" varsa o, yoksa yıllık (yoksa aylık×12) fiyat. Büyük olan üst pakettir. */
    public static function rank(?array $plan): int
    {
        if (!$plan) return 0;
        if (isset($plan['rank']) && is_int($plan['rank'])) return $plan['rank'] * 1000000000;
        return (int)($plan['yearly'] ?? (isset($plan['monthly']) ? $plan['monthly'] * 12 : 0));
    }

    /** Bir paketin günlük bedeli (kuruş): yıllık/365, yoksa aylık/30. */
    private static function daily(?array $plan): float
    {
        if (!$plan) return 0.0;
        if (is_int($plan['yearly'] ?? null) && $plan['yearly'] > 0) return $plan['yearly'] / 365;
        if (is_int($plan['monthly'] ?? null) && $plan['monthly'] > 0) return $plan['monthly'] / 30;
        return 0.0;
    }

    /**
     * Ödenen dönemi açar (kartla ödemede otomatik, havalede yönetici/bayi departmanı onayıyla).
     * - Deneme (demo) sürüyorsa bugün biter, ücretli dönem bugün başlar.
     * - Aynı veya alt paket: yeni dönem mevcut ücretli/atanmış dönemin bitiminden sonra başlar (yenileme).
     * - Üst paket: bugün başlar; eski paketin kalan günleri bedel oranında yeni pakete gün olarak eklenir.
     */
    private function activate(array $row, int $now): void
    {
        $tz = new \DateTimeZone('Europe/Istanbul');
        $today = (new \DateTimeImmutable('@'.$now))->setTimezone($tz)->setTime(0, 0);
        $todayS = $today->format('Y-m-d');
        $yesterday = $today->modify('-1 day')->format('Y-m-d');
        $catalog = (new Commerce($this->db))->catalog();
        $newPlan = $catalog[$row['plan_id']] ?? null;
        $q = $this->db->prepare('SELECT id,plan_id,kind,starts_on,ends_on FROM clinic_subscription WHERE partner_id=? AND ends_on>=? ORDER BY starts_on FOR UPDATE');
        $q->execute([$row['partner_id'], $todayS]);
        $terms = $q->fetchAll(PDO::FETCH_ASSOC);
        $current = null;
        foreach ($terms as $t) if ($t['kind'] !== 'trial' && $t['starts_on'] <= $todayS && $t['ends_on'] >= $todayS) $current = $t;
        $upgrade = $current && $current['plan_id'] !== $row['plan_id'] && self::rank($newPlan) > self::rank($catalog[$current['plan_id']] ?? null);
        $start = $today;
        $bonus = 0;
        foreach ($terms as $t) {
            if ($t['kind'] === 'trial') {
                if ($t['starts_on'] > $yesterday) $this->db->prepare('DELETE FROM clinic_subscription WHERE id=?')->execute([$t['id']]);
                else $this->db->prepare('UPDATE clinic_subscription SET ends_on=? WHERE id=?')->execute([$yesterday, $t['id']]);
                continue;
            }
            if ($upgrade) {
                // Kalan (bugün dahil) günlerin bedeli yeni paketin günlük bedeline bölünerek eklenir.
                $from = max($todayS, $t['starts_on']);
                $days = (int)(new \DateTimeImmutable($from, $tz))->diff((new \DateTimeImmutable($t['ends_on'], $tz))->modify('+1 day'))->days;
                $newDaily = self::daily($newPlan);
                if ($newDaily > 0) $bonus += (int)floor($days * self::daily($catalog[$t['plan_id']] ?? null) / $newDaily);
                if ($t['starts_on'] > $yesterday) $this->db->prepare('DELETE FROM clinic_subscription WHERE id=?')->execute([$t['id']]);
                else $this->db->prepare('UPDATE clinic_subscription SET ends_on=? WHERE id=?')->execute([$yesterday, $t['id']]);
                continue;
            }
            $after = (new \DateTimeImmutable($t['ends_on'], $tz))->modify('+1 day');
            if ($after > $start) $start = $after;
        }
        $end = $start->modify($row['period'] === 'yearly' ? '+1 year' : '+1 month')->modify('-1 day');
        if ($bonus > 0) $end = $end->modify('+'.$bonus.' days');
        $this->db->prepare('INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,?,?,?)')
            ->execute([$row['partner_id'], $row['plan_id'], $row['plan_name'], 'paid', $start->format('Y-m-d'), $end->format('Y-m-d')]);
        $this->db->prepare("UPDATE saas_order SET status='paid',paid_at=?,starts_on=?,ends_on=? WHERE id=?")
            ->execute([$now, $start->format('Y-m-d'), $end->format('Y-m-d'), $row['id']]);
    }
}
