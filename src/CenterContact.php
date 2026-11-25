<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Merkez (VetZimo yönetimi) iletişimi.
 * - Yöneticinin cep telefonu ve e-postası; merkez mesajlarını gönderen telefon hattı (Telefon Bağlantısı'nda Android
 *   telefonu bağlı, VetZimo'ya ait bir bayi hesabı). Bu hattan giden merkez mesajları o bayinin kuyruğunda görünmez ve
 *   paket sınırına sayılmaz.
 * - Bayi ödemeleri (havale bildirimi, kartla ödeme) yalnız merkez paneline uyarı olarak düşer ve yöneticiye SMS, WhatsApp
 *   ve e-posta ile gider; hiçbir bayiye gitmez.
 * - Bayilere giden abonelik hatırlatmaları da bu hattan gönderilir.
 */
final class CenterContact
{
    private const ID = '00000000000000000000000000000008';
    private const DEFAULTS = ['phone' => '', 'email' => '', 'linePartner' => '', 'sms' => true, 'whatsapp' => true, 'mail' => true];

    public function __construct(private readonly PDO $db, private readonly string $key) {}

    public function settings(): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='center_contact'");
        $q->execute([self::ID]);
        $s = (json_decode((string)$q->fetchColumn(), true) ?: []) + self::DEFAULTS;
        if ($s['linePartner'] === '') {
            // Önceki sürümde otomatik demo için seçilen hat geçerli sayılır.
            $d = $this->db->query("SELECT payload FROM center_management WHERE id='00000000000000000000000000000007'")->fetchColumn();
            $s['linePartner'] = (string)((json_decode((string)$d, true) ?: [])['linePartner'] ?? '');
        }
        return $s;
    }

    public function overview(): array
    {
        $s = $this->settings();
        $lines = $this->db->query("SELECT p.id,p.name,COUNT(d.id) phones FROM partner_account p
            JOIN phone_device d ON d.partner_id=p.id AND d.token_hash IS NOT NULL AND d.revoked_at IS NULL WHERE p.active=1 GROUP BY p.id,p.name ORDER BY p.name LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        $name = '';
        if ($s['linePartner'] !== '') { $n = $this->db->prepare('SELECT name FROM partner_account WHERE id=?'); $n->execute([$s['linePartner']]); $name = (string)$n->fetchColumn(); }
        $log = $this->db->prepare("SELECT channel,phone,status,created_at,LEFT(body,120) body FROM phone_outbox WHERE source='center' ORDER BY id DESC LIMIT 15");
        $log->execute();
        return ['settings' => $s + ['lineName' => $name], 'lines' => array_map(static fn($l) => ['id' => $l['id'], 'name' => $l['name'], 'phones' => (int)$l['phones']], $lines),
            'log' => array_map(static fn($r) => ['created_at' => (int)$r['created_at']] + $r, $log->fetchAll(PDO::FETCH_ASSOC))];
    }

    public function save(object $b): array
    {
        $phone = is_string($b->phone ?? null) ? trim($b->phone) : '';
        if ($phone !== '' && DealerLogin::normalizePhone($phone) === '') throw new RuntimeException('Cep telefonu geçersiz (Türkiye cep numarası).', 422);
        $email = is_string($b->email ?? null) ? strtolower(trim($b->email)) : '';
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('E-posta adresi geçersiz.', 422);
        $line = is_string($b->linePartner ?? null) ? $b->linePartner : '';
        if ($line !== '') {
            $q = $this->db->prepare('SELECT 1 FROM partner_account WHERE id=? AND active=1');
            $q->execute([$line]);
            if (!$q->fetchColumn()) throw new RuntimeException('Mesaj hattı bayisi bulunamadı.', 422);
        }
        $s = ['phone' => $phone === '' ? '' : DealerLogin::normalizePhone($phone), 'email' => $email, 'linePartner' => $line,
            'sms' => ($b->sms ?? false) === true, 'whatsapp' => ($b->whatsapp ?? false) === true, 'mail' => ($b->mail ?? false) === true];
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'center_contact',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::ID, json_encode($s, JSON_THROW_ON_ERROR)]);
        return $this->overview();
    }

    /** Merkez hattından SMS/WhatsApp kuyruğa alır (hat yoksa sessizce atlar). Dönen: kuyruğa alınan kanallar. */
    public function send(string $phone, string $text, string $ref, int $now, array $channels = ['sms', 'whatsapp']): array
    {
        $s = $this->settings();
        if ($s['linePartner'] === '' || DealerLogin::normalizePhone($phone) === '') return [];
        $gw = new PhoneGateway($this->db);
        $done = [];
        foreach ($channels as $ch) {
            try { $gw->enqueue($s['linePartner'], $ch, $phone, $text, 'center', $ch.':'.$ref, 0, $now, $now + 3 * 86400, 'VetZimo merkez'); $done[] = $ch; }
            catch (\Throwable $e) { error_log('VetZimo center message: '.get_class($e)); }
        }
        return $done;
    }

    public function mail(string $to, string $subject, string $text): bool
    {
        try {
            $n = new Notifications($this->db, $this->key);
            if (!$n->settings()['smtpEnabled'] || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
            $n->send('smtp', $to, $subject, $text);
            return true;
        } catch (\Throwable $e) { error_log('VetZimo center mail: '.get_class($e)); return false; }
    }

    /**
     * Yöneticiye uyarı: merkez paneli (uygulama bildirimi, ilgili departmanlar) + SMS + WhatsApp + e-posta.
     * $departments: uyarıyı panelde görecek merkez departmanları (owner her zaman görür).
     */
    public function alert(string $title, string $body, string $href, string $key, int $now, array $departments = ['dealer']): void
    {
        try {
            $hub = new AppHub($this->db);
            $policies = $hub->policies();
            $q = $this->db->query("SELECT a.id,c.is_owner,COALESCE(c.department,'') dep FROM identity_account a JOIN identity_center c ON c.account_id=a.id WHERE a.kind='center' AND a.blocked=0");
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (!(int)$r['is_owner'] && !in_array($r['dep'], $departments, true)) continue;
                $hub->notify($r['id'], '', 'center', 'payments', $title, $body, $href, $key, $now, $policies);
            }
        } catch (\Throwable $e) { error_log('VetZimo center alert: '.get_class($e)); }
        $s = $this->settings();
        $channels = array_values(array_filter(['sms', 'whatsapp'], static fn($c) => $s[$c]));
        if ($s['phone'] !== '' && $channels) $this->send($s['phone'], 'VetZimo · '.$title."\n".$body, 'alert:'.$key, $now, $channels);
        $email = $s['email'] !== '' ? $s['email'] : (string)((new Notifications($this->db, $this->key))->settings()['admin'] ?? '');
        if ($s['mail'] && $email !== '') $this->mail($email, 'VetZimo · '.$title, $body);
    }
}
