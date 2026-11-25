<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Otomatik demo: demo başvurusundaki cep telefonuna tek kullanımlık kod gider. Başvuran kişi telefonunda kodu girip
 * VetZimo Kullanım Sözleşmesini okuyup imzalarsa bayi hesabı ve (varsayılan) 14 günlük demo kendiliğinden açılır;
 * şifresini belirleyerek hemen giriş yapar. Kod gönderimi merkezin seçtiği bayinin telefon hattından (Telefon Bağlantısı)
 * yapılır. Hat tanımlı değilse ya da otomatik demo kapalıysa başvuru eskisi gibi yönetici onayına düşer.
 */
final class DemoAuto
{
    private const SETTINGS_ID = '00000000000000000000000000000007';
    private const TTL = 900;            // kod 15 dakika geçerli
    private const MAX_ATTEMPTS = 5;
    private const MAX_SENDS = 3;

    public function __construct(private readonly PDO $db, private readonly string $secret) {}

    public function settings(): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='demo_auto'");
        $q->execute([self::SETTINGS_ID]);
        $s = json_decode((string)$q->fetchColumn(), true) ?: [];
        return ['enabled' => ($s['enabled'] ?? true) === true, 'days' => (int)($s['days'] ?? 14), 'plan' => (string)($s['plan'] ?? ''),
            'linePartner' => (string)($s['linePartner'] ?? '')];
    }

    public function saveSettings(object $body, Commerce $commerce): array
    {
        $days = filter_var($body->days ?? 14, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 90]]);
        if (!$days) throw new RuntimeException('Demo süresi 1–90 gün olmalıdır.', 422);
        $plan = is_string($body->plan ?? null) ? $body->plan : '';
        if ($plan !== '' && !isset($commerce->catalog()[$plan])) throw new RuntimeException('Paket bulunamadı.', 422);
        $line = is_string($body->linePartner ?? null) ? $body->linePartner : '';
        if ($line !== '') {
            $q = $this->db->prepare('SELECT 1 FROM partner_account WHERE id=? AND active=1');
            $q->execute([$line]);
            if (!$q->fetchColumn()) throw new RuntimeException('Kod gönderecek bayi bulunamadı.', 422);
        }
        $payload = ['enabled' => ($body->enabled ?? false) === true, 'days' => $days, 'plan' => $plan, 'linePartner' => $line];
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'demo_auto',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::SETTINGS_ID, json_encode($payload, JSON_THROW_ON_ERROR)]);
        return $this->overview();
    }

    /** Merkez paneli: ayarlar, seçilebilir paketler ve hat bayileri, son otomatik demolar. */
    public function overview(): array
    {
        $s = $this->settings();
        $lines = $this->db->query("SELECT p.id,p.name,COUNT(d.id) phones,MAX(d.last_seen) seen FROM partner_account p
            JOIN phone_device d ON d.partner_id=p.id AND d.token_hash IS NOT NULL AND d.revoked_at IS NULL WHERE p.active=1 GROUP BY p.id,p.name ORDER BY p.name LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        $recent = $this->db->query('SELECT v.lead_id,l.clinic,l.name,v.sent_at,v.verified_at,v.attempts,v.partner_id FROM demo_verification v
            JOIN clinic_lead l ON l.id=v.lead_id ORDER BY v.sent_at DESC LIMIT 20')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($recent as &$r) { $r['sent_at'] = (int)$r['sent_at']; $r['verified_at'] = $r['verified_at'] === null ? null : (int)$r['verified_at']; $r['attempts'] = (int)$r['attempts']; }
        unset($r);
        $ready = $s['enabled'] && $s['linePartner'] !== '';
        $lineName = '';
        if ($s['linePartner'] !== '') { $n = $this->db->prepare('SELECT name FROM partner_account WHERE id=?'); $n->execute([$s['linePartner']]); $lineName = (string)$n->fetchColumn(); }
        return ['settings' => $s + ['lineName' => $lineName], 'ready' => $ready, 'lines' => array_map(static fn($l) => ['id' => $l['id'], 'name' => $l['name'], 'phones' => (int)$l['phones'], 'seen' => (int)$l['seen']], $lines), 'recent' => $recent];
    }

    private function code(string $lead, string $code): string { return hash_hmac('sha256', $lead.'|'.$code, $this->secret.'|demo-auto'); }

    /** Başvuru kaydedildikten sonra: otomatik demo açıksa koda gönder. Dönen 'verify' true ise sayfa doğrulama adımına geçer. */
    public function start(string $leadId, PhoneGateway $gateway, int $now, bool $resend = false): array
    {
        $s = $this->settings();
        if (!$s['enabled'] || $s['linePartner'] === '') return ['verify' => false];
        $q = $this->db->prepare("SELECT id,kind,phone,email,stage FROM clinic_lead WHERE id=?");
        $q->execute([$leadId]);
        $lead = $q->fetch(PDO::FETCH_ASSOC);
        if (!$lead || !in_array($lead['kind'], ['demo', 'trial'], true) || $lead['stage'] === 'lost') return ['verify' => false];
        $phone = DealerLogin::normalizePhone((string)$lead['phone']);
        if ($phone === '') return ['verify' => false];
        // Aynı telefon için zaten açılmış bir bayi varsa ikinci demo açılmaz; başvuru yönetici incelemesine kalır.
        $exists = $this->db->prepare("SELECT 1 FROM identity_account a JOIN identity_membership m ON m.account_id=a.id AND m.role='dealer' WHERE a.kind='phone' AND a.identifier=? LIMIT 1");
        $exists->execute([$phone]);
        if ($exists->fetchColumn()) return ['verify' => false, 'reason' => 'existing'];
        $mail = $this->db->prepare('SELECT 1 FROM partner_account WHERE email=? LIMIT 1');
        $mail->execute([strtolower(trim((string)$lead['email']))]);
        if ($mail->fetchColumn()) return ['verify' => false, 'reason' => 'existing'];
        $recent = $this->db->prepare('SELECT COUNT(*) FROM demo_verification WHERE phone=? AND sent_at>?');
        $recent->execute([$phone, $now - 86400]);
        $row = $this->db->prepare('SELECT * FROM demo_verification WHERE lead_id=?');
        $row->execute([$leadId]);
        $current = $row->fetch(PDO::FETCH_ASSOC);
        if ($current && $current['verified_at'] !== null) throw new RuntimeException('Bu başvuru için demo zaten açıldı.', 409);
        if (!$current && (int)$recent->fetchColumn() >= 3) return ['verify' => false, 'reason' => 'limit'];
        if ($current && !$resend) return ['verify' => true, 'phone' => self::mask($phone), 'expires' => (int)$current['expires']];
        if ($current && ((int)$current['sends'] >= self::MAX_SENDS || $now - (int)$current['sent_at'] < 60)) throw new RuntimeException('Yeni kod için biraz bekleyin.', 429);
        $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $this->db->prepare('INSERT INTO demo_verification(lead_id,phone,code_hash,expires,attempts,sends,sent_at) VALUES (?,?,?,?,0,1,?)
            ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires=VALUES(expires),attempts=0,sends=sends+1,sent_at=VALUES(sent_at)')
            ->execute([$leadId, $phone, $this->code($leadId, $code), $now + self::TTL, $now]);
        $gateway->enqueue($s['linePartner'], 'sms', $phone, 'VetZimo demo doğrulama kodunuz: '.$code.' (15 dakika geçerlidir). Bu kodu kimseyle paylaşmayın.',
            'manual', 'demo:'.$leadId.':'.$now, 1, $now, $now + self::TTL, 'Otomatik demo');
        return ['verify' => true, 'phone' => self::mask($phone), 'expires' => $now + self::TTL];
    }

    public static function mask(string $phone): string
    {
        $d = preg_replace('/\D/', '', $phone) ?? '';
        return '0'.substr($d, -10, 3).' *** ** '.substr($d, -2);
    }

    /**
     * Kod + imzalı sözleşme → bayi hesabı, sözleşme kaydı ve demo dönemi tek işlemde açılır.
     * Dönen bağlantı şifre belirleme sayfasıdır (sözleşme imzalı olduğundan tekrar sorulmaz).
     */
    public function verify(object $body, Center $center, Commerce $commerce, string $ip, string $agent, int $now): array
    {
        $lead = is_string($body->reference ?? null) ? $body->reference : '';
        $code = is_string($body->code ?? null) ? preg_replace('/\D/', '', $body->code) : '';
        if (!preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/', $lead) || strlen((string)$code) !== 6) throw new RuntimeException('Doğrulama kodunu kontrol edin.', 422);
        $s = $this->settings();
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare('SELECT * FROM demo_verification WHERE lead_id=? FOR UPDATE');
            $q->execute([$lead]);
            $v = $q->fetch(PDO::FETCH_ASSOC);
            if (!$v) throw new RuntimeException('Doğrulama bulunamadı. Başvuruyu yeniden gönderin.', 404);
            if ($v['verified_at'] !== null) throw new RuntimeException('Bu başvuru için demo zaten açıldı.', 409);
            if ((int)$v['attempts'] >= self::MAX_ATTEMPTS) throw new RuntimeException('Çok fazla hatalı deneme. Yeni kod isteyin.', 429);
            if ((int)$v['expires'] < $now) throw new RuntimeException('Kodun süresi doldu. Yeni kod isteyin.', 410);
            if (!hash_equals((string)$v['code_hash'], $this->code($lead, (string)$code))) {
                $this->db->prepare('UPDATE demo_verification SET attempts=attempts+1 WHERE lead_id=?')->execute([$lead]);
                $this->db->commit();
                throw new RuntimeException('Doğrulama kodu hatalı.', 422);
            }
            $l = $this->db->prepare('SELECT * FROM clinic_lead WHERE id=? FOR UPDATE');
            $l->execute([$lead]);
            $row = $l->fetch(PDO::FETCH_ASSOC);
            if (!$row || $row['stage'] === 'lost') throw new RuntimeException('Başvuru bulunamadı.', 404);
            $prior = $this->db->prepare('SELECT 1 FROM clinic_lead_review WHERE lead_id=? AND trial_partner IS NOT NULL LIMIT 1');
            $prior->execute([$lead]);
            if ($prior->fetchColumn()) throw new RuntimeException('Bu başvuru için demo zaten açıldı.', 409);
            $actor = ['account_id' => 'otomatik-demo', 'identifier' => 'Otomatik demo (telefon + imza)'];
            $created = $center->create($actor, (object)['name' => $row['clinic'], 'phone' => $row['phone'], 'email' => $row['email']], $now, false);
            $m = $this->db->prepare("SELECT account_id FROM identity_membership WHERE partner_id=? AND role='dealer' LIMIT 1");
            $m->execute([$created['id']]);
            $account = (string)$m->fetchColumn();
            (new DealerAgreement($this->db))->sign($created['id'], $account, $body->agreement ?? null, $ip, $agent, $now);
            // Telefon kodla doğrulandı: hesap telefonu doğrulanmış sayılır.
            $this->db->prepare('UPDATE identity_account SET verified_at=? WHERE id=? AND (verified_at IS NULL OR verified_at=0)')->execute([$now, $account]);
            $plan = $s['plan'] !== '' && isset($commerce->catalog()[$s['plan']]) ? $s['plan'] : ($row['plan_id'] !== '' ? $row['plan_id'] : (string)array_key_first($commerce->publishedCatalog()));
            $start = new \DateTimeImmutable('@'.$now);
            $start = $start->setTimezone(new \DateTimeZone('Europe/Istanbul'))->setTime(0, 0);
            $commerce->assign((object)['partnerId' => $created['id'], 'plan' => $plan, 'kind' => 'trial',
                'starts_on' => $start->format('Y-m-d'), 'ends_on' => $start->modify('+'.($s['days'] - 1).' days')->format('Y-m-d')]);
            $this->db->prepare("UPDATE clinic_lead SET stage='won' WHERE id=?")->execute([$lead]);
            $this->db->prepare('INSERT INTO clinic_lead_review(lead_id,actor,stage,note,trial_partner) VALUES (?,?,?,?,?)')
                ->execute([$lead, $actor['identifier'], 'won', 'Telefon kodla doğrulandı, Kullanım Sözleşmesi telefondan imzalandı; '.$s['days'].' günlük demo otomatik açıldı.', $created['id']]);
            $this->db->prepare('UPDATE demo_verification SET verified_at=?,partner_id=? WHERE lead_id=?')->execute([$now, $created['id'], $lead]);
            $this->db->commit();
            return ['activation' => $created['link'], 'days' => $s['days'], 'clinic' => $row['clinic'], 'email' => $row['email']];
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }
}
