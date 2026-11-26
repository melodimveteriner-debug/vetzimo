<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;

/**
 * Bayi abonelik hatırlatmaları: dönem bitimine 3 ay, 1 ay ve son 48 saat kala, yenilenmemişse bayi yöneticisine
 * e-posta, SMS ve WhatsApp (merkez hattından). Demo/deneme veya hiç paket almamış bayiye son 48 saatte verilerinin
 * silineceği bildirilir. Yenileme (ödeme) yapılınca dönem uzadığı için sonraki hatırlatmalar kendiliğinden durur.
 * Bir aşama, dönem o aşamanın penceresinden önce başlamışsa gönderilir (14 günlük demoya "3 ay kaldı" gitmez).
 * Çalıştırma: php bin/subscription-reminders.php (günde bir kez yeterli; saatlik çalıştırmak 48 saati kaçırmaz).
 */
final class SubscriptionReminders
{
    private const STAGES = ['90d' => 90 * 86400, '30d' => 30 * 86400, '48h' => 2 * 86400];

    public function __construct(private readonly PDO $db, private readonly string $key, private readonly string $origin) {}

    public function run(int $now, bool $dry = false): array
    {
        $tz = new \DateTimeZone('Europe/Istanbul');
        $today = (new \DateTimeImmutable('@'.$now))->setTimezone($tz)->format('Y-m-d');
        // Her bayinin en son biten dönemi (gelecekteki yenilemeler dahil) ve o dönemin türü.
        $rows = $this->db->prepare("SELECT s.partner_id,s.kind,s.starts_on,s.ends_on,s.plan_name,p.name,p.email,p.phone,
                (SELECT MIN(x.starts_on) FROM clinic_subscription x WHERE x.partner_id=s.partner_id AND x.ends_on>=?) AS chain_start,
                (SELECT COUNT(*) FROM clinic_subscription y WHERE y.partner_id=s.partner_id AND y.kind IN ('paid','assigned')) AS paid_terms
            FROM clinic_subscription s JOIN partner_account p ON p.id=s.partner_id AND p.active=1
            WHERE s.kind<>'upgrade' AND s.ends_on>=? AND s.ends_on=(SELECT MAX(z.ends_on) FROM clinic_subscription z WHERE z.partner_id=s.partner_id AND z.kind<>'upgrade')");
        $rows->execute([$today, $today]);
        $contact = new CenterContact($this->db, $this->key);
        $sent = [];
        foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $end = (new \DateTimeImmutable($r['ends_on'].' 23:59:59', $tz))->getTimestamp();
            $start = (new \DateTimeImmutable(($r['chain_start'] ?: $r['starts_on']).' 00:00:00', $tz))->getTimestamp();
            $left = $end - $now;
            if ($left < 0) continue;
            $stage = null;
            foreach (self::STAGES as $name => $window) {
                if ($left <= $window && $end - $window >= $start) $stage = $name; // en dar uygun pencere
            }
            if ($stage === null) continue;
            $done = $this->db->prepare('SELECT 1 FROM subscription_reminder WHERE partner_id=? AND ends_on=? AND stage=?');
            $done->execute([$r['partner_id'], $r['ends_on'], $stage]);
            if ($done->fetchColumn()) continue;
            [$subject, $text] = $this->message($r, $stage, $left);
            $channels = [];
            if (!$dry) {
                $channels = $contact->send((string)$r['phone'], $text, 'renew:'.$r['partner_id'].':'.$r['ends_on'].':'.$stage, $now);
                if ($contact->mail((string)$r['email'], $subject, $text)) $channels[] = 'email';
                $this->db->prepare('INSERT IGNORE INTO subscription_reminder(partner_id,ends_on,stage,sent_at,channels) VALUES (?,?,?,?,?)')
                    ->execute([$r['partner_id'], $r['ends_on'], $stage, $now, implode(',', $channels)]);
            }
            $sent[] = ['partner' => $r['partner_id'], 'name' => $r['name'], 'stage' => $stage, 'kind' => $r['kind'], 'channels' => $channels, 'text' => $text];
        }
        return $sent;
    }

    /** [konu, metin] — demo/deneme veya hiç ücretli dönemi olmayan bayiye son 48 saatte veri silme uyarısı. */
    public function message(array $r, string $stage, int $left): array
    {
        $date = (new \DateTimeImmutable($r['ends_on']))->format('d.m.Y');
        $link = rtrim($this->origin, '/').'/clinic#kredi-magazasi';
        $trial = $r['kind'] === 'trial' || (int)($r['paid_terms'] ?? 0) === 0;
        $when = $stage === '48h' ? 'son 48 saat' : ($stage === '30d' ? max(1, (int)ceil($left / 86400)).' gün' : 'yaklaşık 3 ay');
        if ($trial && $stage === '48h') {
            return ['VetZimo demonuz 48 saat içinde bitiyor',
                "Sayın {$r['name']}, VetZimo demo süreniz {$date} tarihinde sona eriyor ({$when} kaldı). Süre bitiminde giriş kapanır. Verileriniz için endişelenmeyin: 30 gün daha sistemimizde güvenle saklanır, bu sürede paket alırsanız kaldığınız yerden devam edersiniz; 30 günün sonunda kalıcı olarak silinir. Yedeğinizi almayı unutmayın (Ayarlar › Şube yedeği). Paketinizi şimdi seçin: {$link}"];
        }
        if ($trial) {
            return ['VetZimo demo süreniz bitiyor',
                "Sayın {$r['name']}, VetZimo demo süreniz {$date} tarihinde sona eriyor ({$when} kaldı). Kesintisiz devam etmek ve verilerinizi korumak için size uygun paketi seçin: {$link}"];
        }
        if ($stage === '48h') {
            return ['VetZimo aboneliğiniz 48 saat içinde bitiyor',
                "Sayın {$r['name']}, VetZimo {$r['plan_name']} aboneliğiniz {$date} tarihinde sona eriyor. Yenilenmezse süre bitiminde giriş kapanır. Verileriniz için endişelenmeyin: 30 gün daha sistemimizde güvenle saklanır; 30 günün sonunda kalıcı olarak silinir. Yedeğinizi almayı unutmayın (Ayarlar › Şube yedeği). Kartla hemen yenileyebilir veya havale yapabilirsiniz: {$link}"];
        }
        return ['VetZimo abonelik yenileme hatırlatması',
            "Sayın {$r['name']}, VetZimo {$r['plan_name']} aboneliğinizin bitmesine {$when} var ({$date}). Kesintisiz kullanım için yenilemenizi kartla anında ya da havale ile yapabilirsiniz: {$link}"];
    }
}
