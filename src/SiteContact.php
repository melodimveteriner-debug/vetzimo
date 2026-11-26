<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Satış sitesi iletişim formu ve yönetim panelindeki İletişim Mesajları kutusu.
 * - Form, kolay bir toplama/çıkarma güvenlik sorusu ister (imzalı, 20 dakika geçerli, tek kullanımlık; cevap sayfaya yazılmaz),
 *   gizli tuzak alanı ve IP başına saatlik sınır vardır. Ücretli bir doğrulama (reCAPTCHA vb.) kullanılmaz.
 * - Gelen mesaj yöneticiye panel uyarısı + e-posta (+ açıksa SMS/WhatsApp) olarak gider; gönderene "mesajınızı aldık" e-postası.
 * - Yönetici panelden yanıt yazar; yanıt kişiye e-posta ile gider. Tüm e-postaların altına şirket bilgileri ve telefon
 *   (Yasal Metinler › Şirket bilgileri) kendiliğinden eklenir.
 * Tablolar ilk kullanımda oluşturulur; SQL çalıştırmak gerekmez.
 */
final class SiteContact
{
    private const TTL = 1200;
    private const HOURLY = 5;

    public function __construct(private readonly PDO $db, private readonly string $secret, private readonly string $key = '') {}

    public function ensure(): void
    {
        $this->db->exec("CREATE TABLE IF NOT EXISTS site_contact_message (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL, phone VARCHAR(24) NOT NULL DEFAULT '',
            company VARCHAR(160) NOT NULL DEFAULT '', subject VARCHAR(160) NOT NULL, message TEXT NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'new', nonce CHAR(32) NOT NULL, ip_hash CHAR(64) NOT NULL,
            created_at INT UNSIGNED NOT NULL, replied_at INT UNSIGNED NULL,
            UNIQUE KEY site_contact_nonce (nonce), KEY site_contact_list (status, created_at), KEY site_contact_ip (ip_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->db->exec("CREATE TABLE IF NOT EXISTS site_contact_reply (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, message_id BIGINT UNSIGNED NOT NULL,
            body TEXT NOT NULL, actor VARCHAR(254) NOT NULL, created_at INT UNSIGNED NOT NULL,
            KEY site_contact_reply_msg (message_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    // ───────────────────────────── güvenlik sorusu ─────────────────────────────
    public function challenge(int $now): array
    {
        $a = random_int(2, 12);
        $b = random_int(1, 9);
        $minus = random_int(0, 1) === 1 && $a > $b;
        $answer = $minus ? $a - $b : $a + $b;
        $nonce = bin2hex(random_bytes(16));
        $exp = $now + self::TTL;
        return ['question' => $a.' '.($minus ? '−' : '+').' '.$b.' = ?', 'token' => $exp.'.'.$nonce.'.'.$this->sign($answer, $exp, $nonce)];
    }

    private function sign(int $answer, int $exp, string $nonce): string
    {
        return hash_hmac('sha256', 'site-contact|'.$answer.'|'.$exp.'|'.$nonce, $this->secret);
    }

    /** Doğruysa tek kullanımlık nonce döner. */
    private function verify(mixed $token, mixed $answer, int $now): string
    {
        if (!is_string($token) || !preg_match('/\A(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})\z/', $token, $m)) throw new RuntimeException('Güvenlik sorusunu yenileyip tekrar deneyin.', 422);
        if ((int)$m[1] < $now) throw new RuntimeException('Güvenlik sorusunun süresi doldu; yeni soruyu yanıtlayın.', 422);
        $value = is_int($answer) ? (string)$answer : (is_string($answer) ? trim($answer) : '');
        if (!preg_match('/\A-?\d{1,3}\z/', $value) || !hash_equals($this->sign((int)$value, (int)$m[1], $m[2]), $m[3])) {
            throw new RuntimeException('Güvenlik sorusunun cevabı yanlış.', 422);
        }
        return $m[2];
    }

    // ───────────────────────────── ziyaretçi ─────────────────────────────
    public function submit(object $b, string $ip, int $now): array
    {
        $this->ensure();
        if (is_string($b->website ?? null) && trim($b->website) !== '') return ['ok' => true]; // tuzak alan: bot
        $nonce = $this->verify($b->token ?? null, $b->answer ?? null, $now);
        $name = self::text($b->name ?? '', 120, 'Ad soyad');
        $email = strtolower(self::text($b->email ?? '', 254, 'E-posta'));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('E-posta adresi geçersiz.', 422);
        $phone = self::text($b->phone ?? '', 24, 'Telefon', false);
        if ($phone !== '' && !preg_match('/\A[+0-9 ()\-]{7,24}\z/', $phone)) throw new RuntimeException('Telefon numarası geçersiz.', 422);
        $company = self::text($b->company ?? '', 160, 'Klinik', false);
        $subject = self::text($b->subject ?? '', 160, 'Konu');
        $message = self::text($b->message ?? '', 4000, 'Mesaj', true, true);
        if (mb_strlen($message) < 10) throw new RuntimeException('Mesajınız en az 10 karakter olmalıdır.', 422);
        if (($b->consent ?? false) !== true) throw new RuntimeException('Aydınlatma metnini okuduğunuzu onaylayın.', 422);
        $ipHash = hash_hmac('sha256', 'contact-ip|'.$ip, $this->secret);
        $q = $this->db->prepare('SELECT COUNT(*) FROM site_contact_message WHERE ip_hash=? AND created_at>?');
        $q->execute([$ipHash, $now - 3600]);
        if ((int)$q->fetchColumn() >= self::HOURLY) throw new RuntimeException('Çok sayıda mesaj gönderildi. Lütfen bir saat sonra tekrar deneyin.', 429);
        try {
            $this->db->prepare('INSERT INTO site_contact_message(name,email,phone,company,subject,message,nonce,ip_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$name, $email, $phone, $company, $subject, $message, $nonce, $ipHash, $now]);
        } catch (\PDOException $e) {
            if (($e->errorInfo[1] ?? 0) === 1062) throw new RuntimeException('Bu form zaten gönderildi. Yeni mesaj için sayfayı yenileyin.', 409);
            throw $e;
        }
        $id = (int)$this->db->lastInsertId();
        $contact = new CenterContact($this->db, $this->key);
        $contact->alert('Yeni iletişim mesajı', $name.($company !== '' ? ' · '.$company : '').' · '.$subject."\n".$email.($phone !== '' ? ' · '.$phone : '')."\n\n".mb_substr($message, 0, 1500),
            '/yonetim?tab=iletisim&mesaj='.$id, 'contact:'.$id, $now, ['support'], 'support');
        $c = (new SiteLegal($this->db))->company();
        $this->mail($email, $c['marka'].' · Mesajınızı aldık', 'Merhaba '.$name.",\n\n\"".$subject."\" konulu mesajınız bize ulaştı. Ekibimiz en kısa sürede bu e-posta adresine yanıt verecek.\n\nMesajınız:\n".$message);
        return ['ok' => true, 'reference' => $id];
    }

    // ───────────────────────────── yönetim ─────────────────────────────
    public function list(string $status, string $query, int $now): array
    {
        $this->ensure();
        $where = []; $args = [];
        if (in_array($status, ['new', 'read', 'replied', 'archived'], true)) { $where[] = 'status=?'; $args[] = $status; }
        else $where[] = "status<>'archived'";
        if ($query !== '') { $where[] = '(name LIKE ? OR email LIKE ? OR subject LIKE ? OR company LIKE ?)'; $like = '%'.addcslashes(mb_substr($query, 0, 80), '%_\\').'%'; array_push($args, $like, $like, $like, $like); }
        $q = $this->db->prepare('SELECT id,name,email,phone,company,subject,status,created_at,replied_at,LEFT(message,160) preview FROM site_contact_message WHERE '.implode(' AND ', $where).' ORDER BY id DESC LIMIT 500');
        $q->execute($args);
        $counts = [];
        foreach ($this->db->query('SELECT status,COUNT(*) n FROM site_contact_message GROUP BY status')->fetchAll(PDO::FETCH_ASSOC) as $r) $counts[$r['status']] = (int)$r['n'];
        $smtp = false;
        try { $smtp = (bool)(new Notifications($this->db, $this->key))->settings()['smtpEnabled']; } catch (\Throwable) {}
        return ['messages' => array_map(static fn($r) => ['id' => (int)$r['id'], 'created_at' => (int)$r['created_at'], 'replied_at' => $r['replied_at'] === null ? null : (int)$r['replied_at']] + $r, $q->fetchAll(PDO::FETCH_ASSOC)),
            'counts' => $counts, 'smtp' => $smtp, 'signature' => $this->signature()];
    }

    public function get(int $id): array
    {
        $this->ensure();
        $q = $this->db->prepare('SELECT id,name,email,phone,company,subject,message,status,created_at,replied_at FROM site_contact_message WHERE id=?');
        $q->execute([$id]);
        $m = $q->fetch(PDO::FETCH_ASSOC);
        if (!$m) throw new RuntimeException('Mesaj bulunamadı.', 404);
        if ($m['status'] === 'new') { $this->db->prepare("UPDATE site_contact_message SET status='read' WHERE id=?")->execute([$id]); $m['status'] = 'read'; }
        $r = $this->db->prepare('SELECT body,actor,created_at FROM site_contact_reply WHERE message_id=? ORDER BY id');
        $r->execute([$id]);
        return ['message' => ['id' => (int)$m['id'], 'created_at' => (int)$m['created_at']] + $m,
            'replies' => array_map(static fn($x) => ['created_at' => (int)$x['created_at']] + $x, $r->fetchAll(PDO::FETCH_ASSOC)), 'signature' => $this->signature()];
    }

    public function reply(int $id, object $b, string $actor, int $now): array
    {
        $msg = $this->get($id)['message'];
        $body = self::text($b->body ?? '', 8000, 'Yanıt', true, true);
        $subject = is_string($b->subject ?? null) && trim($b->subject) !== '' ? self::text($b->subject, 200, 'Konu') : 'Re: '.$msg['subject'];
        if (!$this->mail($msg['email'], $subject, $body, true)) {
            throw new RuntimeException('E-posta gönderilemedi. Yönetim › Bildirim Merkezi’nde SMTP (e-posta) ayarlarını kontrol edin.', 503);
        }
        $this->db->prepare('INSERT INTO site_contact_reply(message_id,body,actor,created_at) VALUES (?,?,?,?)')->execute([$id, $body, $actor, $now]);
        $this->db->prepare("UPDATE site_contact_message SET status='replied',replied_at=? WHERE id=?")->execute([$now, $id]);
        return $this->get($id);
    }

    public function setStatus(int $id, string $status): void
    {
        $this->ensure();
        if (!in_array($status, ['read', 'archived', 'new'], true)) throw new RuntimeException('Durum geçersiz.', 422);
        $this->db->prepare('UPDATE site_contact_message SET status=? WHERE id=?')->execute([$status, $id]);
    }

    public function delete(int $id): void
    {
        $this->ensure();
        $this->db->prepare('DELETE FROM site_contact_reply WHERE message_id=?')->execute([$id]);
        $this->db->prepare('DELETE FROM site_contact_message WHERE id=?')->execute([$id]);
    }

    /** E-postaların altına eklenen şirket imzası (Yasal Metinler › Şirket bilgileri). */
    public function signature(): string
    {
        $c = (new SiteLegal($this->db))->company();
        $lines = array_filter([$c['marka'], $c['unvan'], $c['adres'],
            $c['telefon'] !== '' ? 'Telefon: '.$c['telefon'] : '', $c['destek_eposta'] !== '' ? 'E-posta: '.$c['destek_eposta'] : '',
            $c['web'] !== '' ? $c['web'] : '', $c['mersis'] !== '' ? 'MERSİS: '.$c['mersis'] : ''], static fn($l) => trim($l) !== '');
        return "—\n".implode("\n", $lines);
    }

    private function mail(string $to, string $subject, string $text, bool $strict = false): bool
    {
        try {
            $n = new Notifications($this->db, $this->key);
            if (!$n->settings()['smtpEnabled']) return false;
            $n->send('smtp', $to, $subject, rtrim($text)."\n\n".$this->signature());
            return true;
        } catch (\Throwable $e) {
            error_log('VetZimo contact mail: '.get_class($e));
            return false;
        }
    }

    private static function text(mixed $v, int $max, string $label, bool $required = true, bool $multiline = false): string
    {
        if (!is_string($v)) $v = '';
        $v = trim(str_replace("\r\n", "\n", $v));
        if (!$multiline) $v = preg_replace('/\s+/u', ' ', $v) ?? '';
        $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
        if ($required && $v === '') throw new RuntimeException($label.' alanını doldurun.', 422);
        if (mb_strlen($v) > $max) throw new RuntimeException($label.' en fazla '.$max.' karakter olabilir.', 422);
        return $v;
    }
}
