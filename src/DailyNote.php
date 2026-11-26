<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

/**
 * Günlük ekip notu (gün sonu kontrol listesi): her gün kliniğin belirlediği saatte (varsayılan 16:00) tüm klinik
 * personeline tek bir bildirim olarak gider. Klinikte sağ üst uyarı olarak düşer, uygulamada anlık bildirim olarak gelir;
 * kişi okuduğunda yalnız onda kaybolur. Metni ve saati bayi yöneticisi düzenler; her soru ayrı satırda gösterilir.
 */
final class DailyNote
{
    public const DEFAULT_TIME = '16:00';
    public const DEFAULT_TEXT = "Bugün yapılması gerekenler yapıldı mı?\nAranacak randevu, check-up, ameliyat, tıraş vb. durum var mı?\nSiparişler tam olarak girildi mi?\nİzinli personelin işleri paylaşıldı mı?\nArayanlar ve aranacaklar not alındı mı?\nStoklardan aşı ve ilaçlar düşüldü mü?\nYatan hastaların tedavileri ve bakımları yapıldı mı?\nHastaların çıkmadan önce kontrolü ve temizliği yapıldı mı?\nHepimiz bir ekibiz; ekip ruhuyla özverili davrandığınız için şimdiden teşekkür ederim.\n{klinik}";

    public function __construct(private readonly PDO $db) {}

    private function ensure(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_daily_note (
            partner_id VARCHAR(80) NOT NULL PRIMARY KEY, enabled TINYINT(1) NOT NULL DEFAULT 1, at_time CHAR(5) NOT NULL DEFAULT \'16:00\',
            body TEXT NOT NULL, updated_by VARCHAR(120) NOT NULL DEFAULT \'\', updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_daily_note_sent (
            partner_id VARCHAR(80) NOT NULL, day DATE NOT NULL, sent_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    /** Her soru işaretinden sonra yeni satır; boş satırlar ve fazla boşluklar temizlenir. */
    public static function normalize(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = preg_replace('/\?[ \t]+(?=\S)/u', "?\n", $text) ?? $text;
        $lines = array_values(array_filter(array_map(static fn($l) => trim(preg_replace('/[ \t]+/u', ' ', $l) ?? $l), explode("\n", $text)), static fn($l) => $l !== ''));
        return implode("\n", $lines);
    }

    public function settings(string $partner): array
    {
        $row = false;
        try {
            $q = $this->db->prepare('SELECT enabled,at_time,body,updated_by,updated_at FROM clinic_daily_note WHERE partner_id=?');
            $q->execute([$partner]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
        } catch (\PDOException) {}
        return ['enabled' => $row ? (bool)$row['enabled'] : true, 'time' => $row['at_time'] ?? self::DEFAULT_TIME,
            'body' => $row ? (string)$row['body'] : self::DEFAULT_TEXT, 'default' => self::DEFAULT_TEXT,
            'updatedBy' => $row['updated_by'] ?? '', 'updatedAt' => (int)($row['updated_at'] ?? 0)];
    }

    public function save(array $actor, object $input, int $now): array
    {
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Günlük ekip notunu yalnızca klinik yöneticisi düzenleyebilir.', 403);
        $time = (string)($input->time ?? '');
        if (!preg_match('/\A([01]\d|2[0-3]):[0-5]\d\z/', $time)) throw new RuntimeException('Saati SS:DD biçiminde seçin.', 422);
        $body = !empty($input->reset) ? self::DEFAULT_TEXT : self::normalize((string)($input->body ?? ''));
        if ($body === '' || mb_strlen($body) > 2000) throw new RuntimeException('Not metni 1-2000 karakter olmalı.', 422);
        $this->ensure();
        $this->db->prepare('INSERT INTO clinic_daily_note(partner_id,enabled,at_time,body,updated_by,updated_at) VALUES (?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),at_time=VALUES(at_time),body=VALUES(body),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)')
            ->execute([$actor['partner_id'], empty($input->enabled) ? 0 : 1, $time, $body, mb_substr((string)($actor['name'] ?? ''), 0, 120), $now]);
        return $this->settings($actor['partner_id']);
    }

    private function clinicName(string $partner): string
    {
        $q = $this->db->prepare('SELECT name FROM partner_account WHERE id=?');
        $q->execute([$partner]);
        return (string)$q->fetchColumn();
    }

    public function text(string $partner, ?array $settings = null): string
    {
        $settings ??= $this->settings($partner);
        return self::normalize(str_replace('{klinik}', $this->clinicName($partner), $settings['body']));
    }

    private static function moment(int $now, string $time): array
    {
        $local = (new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('Europe/Istanbul'));
        return [$local->format('Y-m-d'), $local->format('H:i') >= $time];
    }

    /** Sağ üst klinik uyarısı: bugünün saati geldiyse tüm personele aynı not; kişi okuyunca (ack) onda kaybolur. */
    public function alert(array $actor, int $now): ?array
    {
        $s = $this->settings($actor['partner_id']);
        if (!$s['enabled']) return null;
        [$day, $due] = self::moment($now, $s['time']);
        if (!$due) return null;
        $at = (new DateTimeImmutable($day.' '.$s['time'], new DateTimeZone('Europe/Istanbul')))->getTimestamp();
        return ['key' => 'daily:'.$day, 'kind' => 'daily', 'tone' => 'info', 'title' => 'Gün sonu kontrol listesi',
            'body' => $this->text($actor['partner_id'], $s), 'href' => '', 'time' => $at, 'auto' => false, 'sticky' => true,
            'editable' => ($actor['role'] ?? '') === 'dealer'];
    }

    /** Zamanlanmış görev: saati gelen kliniklerde tüm personelin cihazlarına tek seferlik anlık bildirim. */
    public function fanout(int $now): int
    {
        $this->ensure();
        $sent = 0;
        $partners = $this->db->query('SELECT p.id FROM partner_account p WHERE p.active=1')->fetchAll(PDO::FETCH_COLUMN);
        $mark = $this->db->prepare('INSERT IGNORE INTO clinic_daily_note_sent(partner_id,day,sent_at) VALUES (?,?,?)');
        $members = $this->db->prepare("SELECT m.id,m.account_id,m.role FROM identity_membership m JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            WHERE m.partner_id=? AND m.status='active' AND m.role IN ('dealer','branch','staff')");
        $hub = class_exists(AppHub::class) ? new AppHub($this->db, []) : null;
        foreach ($partners as $partner) {
            $s = $this->settings((string)$partner);
            if (!$s['enabled']) continue;
            [$day, $due] = self::moment($now, $s['time']);
            if (!$due) continue;
            $mark->execute([$partner, $day, $now]);
            if ($mark->rowCount() === 0) continue;
            if (!$hub) continue;
            $members->execute([$partner]);
            $text = $this->text((string)$partner, $s);
            foreach ($members->fetchAll(PDO::FETCH_ASSOC) as $m) {
                if ($hub->notify($m['account_id'], $m['id'], $m['role'], 'announcements', 'Gün sonu kontrol listesi', $text, '/clinic', 'daily:'.$partner.':'.$day, $now)) $sent++;
            }
        }
        return $sent;
    }
}
