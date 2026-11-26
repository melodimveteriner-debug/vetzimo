<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;

/**
 * Klinik uyarı akışı (sağ üstte açılan bildirimler ve zil paneli): tüm kanallardan okunmamış mesajlar, KVKK/ileti
 * izni kararları, belirsiz veya hatalı e-belge ve Bakanlık işleri, telefon hattı kopukluğu, web sitesi mesajları ve
 * abonelik bitişi. Kendiliğinden çözülen uyarılar (mesaj okundu, iş çözüldü) listeden düşer; diğerleri kişi bazında
 * "tamamlandı" işaretlenince kaybolur. Her uyarı yalnız ilgili özellik ve modül izni olan kullanıcıya gösterilir.
 */
final class ClinicAlerts
{
    private const KINDS = ['inbox', 'permit', 'job', 'phone', 'web', 'subscription', 'device', 'pregnancy', 'daily'];

    public function __construct(private readonly PDO $db) {}

    public function list(array $actor, int $now): array
    {
        $partner = $actor['partner_id'];
        $me = (string)($actor['membership_id'] ?? '');
        $items = [];
        $safe = function (callable $fn) { try { $fn(); } catch (\PDOException) {} }; // tablo kurulmamış özellikler sessizce atlanır
        if (ClinicAccess::feature($actor, 'inbox') && ClinicAccess::allowed($actor, 'clients')) $safe(function () use (&$items, $partner) {
            $q = $this->db->prepare("SELECT c.id,c.contact_name,c.contact_handle,c.last_preview,c.last_message_at,c.unread,ch.kind FROM inbox_conversation c JOIN inbox_channel ch ON ch.id=c.channel_id
                WHERE c.partner_id=? AND c.unread>0 AND c.status<>'closed' AND c.last_direction='in' ORDER BY c.last_message_at DESC LIMIT 20");
            $q->execute([$partner]);
            $names = ['whatsapp' => 'WhatsApp', 'sms' => 'SMS', 'instagram' => 'Instagram', 'facebook' => 'Facebook', 'telegram' => 'Telegram', 'email' => 'E-posta', 'web' => 'Web formu', 'phone' => 'SMS', 'device' => 'WhatsApp'];
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $items[] = ['key' => 'inbox:'.$r['id'].':'.$r['last_message_at'], 'kind' => 'inbox', 'tone' => 'info',
                'title' => 'Yeni mesaj · '.($names[$r['kind']] ?? $r['kind']).((int)$r['unread'] > 1 ? ' ('.(int)$r['unread'].')' : ''),
                'body' => trim(($r['contact_name'] ?: $r['contact_handle']).' · '.$r['last_preview']), 'href' => '#gelen-kutusu', 'time' => (int)$r['last_message_at'], 'auto' => true];
        });
        if (ClinicAccess::feature($actor, 'permits') && ClinicAccess::allowed($actor, 'clients')) $safe(function () use (&$items, $partner, $now) {
            $q = $this->db->prepare("SELECT id,client_id,client_name,status,decided_at FROM clinic_client_permit WHERE partner_id=? AND status IN ('signed','declined') AND decided_at>=? ORDER BY decided_at DESC LIMIT 20");
            $q->execute([$partner, $now - 7 * 86400]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $items[] = ['key' => 'permit:'.$r['id'], 'kind' => 'permit', 'tone' => $r['status'] === 'signed' ? 'ok' : 'warn',
                'title' => $r['status'] === 'signed' ? 'KVKK ve ileti izni onaylandı' : 'KVKK onay formu reddedildi', 'body' => $r['client_name'].($r['status'] === 'signed' ? ' formu imzaladı; izinler kartına işlendi.' : ' formu onaylamadı; ileti göndermeyin.'),
                'href' => '#owner/'.rawurlencode($r['client_id']), 'time' => (int)$r['decided_at'], 'auto' => false];
        });
        $edocs = ClinicAccess::feature($actor, 'edocs') && ClinicAccess::allowed($actor, 'sales');
        $bridge = ClinicAccess::feature($actor, 'bridge') && ClinicAccess::allowed($actor, 'patients');
        if ($edocs || $bridge) $safe(function () use (&$items, $partner, $edocs, $bridge) {
            $q = $this->db->prepare("SELECT id,kind,status,payload,error,updated_at FROM clinic_bridge_job WHERE partner_id=? AND status IN ('uncertain','error') ORDER BY updated_at DESC LIMIT 20");
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $doc = in_array($r['kind'], ['earsiv', 'efatura', 'esmm'], true);
                if ($doc ? !$edocs : !$bridge) continue;
                $summary = (string)(json_decode((string)$r['payload'], true)['summary'] ?? '');
                $items[] = ['key' => 'job:'.$r['id'].':'.$r['status'], 'kind' => 'job', 'tone' => 'danger',
                    'title' => ($r['status'] === 'uncertain' ? 'Kontrol gerekli · ' : 'Gönderilemedi · ').($doc ? 'e-Belge' : 'Bakanlık köprüsü'),
                    'body' => trim($summary.($r['error'] ? ' · '.$r['error'] : '')), 'href' => $doc ? '#e-belgeler' : '#bakanlik-koprusu', 'time' => (int)$r['updated_at'], 'auto' => true];
            }
        });
        if (ClinicAccess::feature($actor, 'phoneGateway') && ClinicAccess::allowed($actor, 'clients')) $safe(function () use (&$items, $partner, $now) {
            $q = $this->db->prepare("SELECT COUNT(*) FROM phone_outbox WHERE partner_id=? AND status='queued' AND created_at<?");
            $q->execute([$partner, $now - 1800]);
            $waiting = (int)$q->fetchColumn();
            if (!$waiting) return;
            $d = $this->db->prepare('SELECT MAX(last_seen) FROM phone_device WHERE partner_id=? AND revoked_at IS NULL');
            $d->execute([$partner]);
            $seen = (int)$d->fetchColumn();
            if ($seen > $now - 1800) return;
            $items[] = ['key' => 'phone:'.intdiv($now, 21600), 'kind' => 'phone', 'tone' => 'warn', 'title' => 'Telefon hattı bağlantısı yok',
                'body' => $waiting.' mesaj gönderilmeyi bekliyor. Klinik telefonunda VetZimo uygulamasının açık ve internete bağlı olduğunu kontrol edin.',
                'href' => '#telefon-baglantisi', 'time' => $seen ?: $now, 'auto' => true];
        });
        if (ClinicAccess::feature($actor, 'webSite') && ClinicAccess::allowed($actor, 'clients')) $safe(function () use (&$items, $partner) {
            $q = $this->db->prepare('SELECT id,message,UNIX_TIMESTAMP(created_at) t FROM clinic_web_inbox WHERE partner_id=? AND handled_at IS NULL ORDER BY id DESC LIMIT 10');
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $m = json_decode((string)$r['message'], true) ?: [];
                $items[] = ['key' => 'web:'.$r['id'], 'kind' => 'web', 'tone' => 'info', 'title' => 'Web sitesi mesajı',
                    'body' => trim((string)($m['name'] ?? '').' · '.mb_substr((string)($m['body'] ?? ''), 0, 120)), 'href' => '#web-mesajlari', 'time' => (int)$r['t'], 'auto' => true];
            }
        });
        if (ClinicAccess::feature($actor, 'devices') && ClinicAccess::allowed($actor, 'labs')) $safe(function () use (&$items, $partner) {
            $q = $this->db->prepare("SELECT COUNT(*) n,MAX(received_at) t FROM clinic_device_result WHERE partner_id=? AND status='pending'");
            $q->execute([$partner]);
            $r = $q->fetch(PDO::FETCH_ASSOC);
            if ((int)$r['n'] > 0) $items[] = ['key' => 'device:'.$r['t'].':'.$r['n'], 'kind' => 'device', 'tone' => 'warn', 'title' => 'Eşleşmeyen cihaz sonucu',
                'body' => $r['n'].' tetkik sonucu hastaya bağlanmayı bekliyor. Aynı adlı hastalardan doğru olanı seçin.', 'href' => '#cihaz-entegrasyonu', 'time' => (int)$r['t'], 'auto' => true];
        });
        if (ClinicAccess::allowed($actor, 'patients') && class_exists(Pregnancy::class)) $safe(function () use (&$items, $partner, $now) {
            $today = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
            foreach ((new Pregnancy($this->db))->alerts($partner, $today) as $item) $items[] = $item;
        });
        if (($actor['role'] ?? '') === 'dealer') $safe(function () use (&$items, $partner, $now) {
            $day = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'));
            $q = $this->db->prepare('SELECT MAX(ends_on) FROM clinic_subscription WHERE partner_id=? AND starts_on<=?');
            $q->execute([$partner, $day->format('Y-m-d')]);
            $end = (string)$q->fetchColumn();
            if ($end === '' || $end < $day->format('Y-m-d') || $end > $day->modify('+7 days')->format('Y-m-d')) return;
            $items[] = ['key' => 'subscription:'.$end, 'kind' => 'subscription', 'tone' => 'warn', 'title' => 'Abonelik bitiyor',
                'body' => 'VetZimo aboneliğiniz '.(new \DateTimeImmutable($end))->format('d.m.Y').' tarihinde bitiyor. Kesinti olmaması için yenileyin.', 'href' => '#kredi-magazasi', 'time' => $now, 'auto' => false];
        });
        if (class_exists(DailyNote::class)) $safe(function () use (&$items, $actor, $now) {
            $item = (new DailyNote($this->db))->alert($actor, $now);
            if ($item) $items[] = $item;
        });
        // Kişinin "tamamlandı" dediği uyarılar gösterilmez.
        $acked = [];
        try {
            $q = $this->db->prepare('SELECT alert_key FROM clinic_alert_ack WHERE membership_id=? AND created_at>=?');
            $q->execute([$me, $now - 30 * 86400]);
            $acked = array_flip($q->fetchAll(PDO::FETCH_COLUMN));
        } catch (\PDOException) {}
        $items = array_values(array_filter($items, static fn($i) => !isset($acked[$i['key']])));
        usort($items, static fn($a, $b) => ['danger' => 0, 'warn' => 1, 'info' => 2, 'ok' => 3][$a['tone']] <=> ['danger' => 0, 'warn' => 1, 'info' => 2, 'ok' => 3][$b['tone']] ?: $b['time'] <=> $a['time']);
        return ['items' => array_slice($items, 0, 40), 'count' => count($items), 'dailyEditable' => ($actor['role'] ?? '') === 'dealer'];
    }

    public function ack(array $actor, mixed $keys, int $now): void
    {
        $keys = is_array($keys) ? $keys : [$keys];
        $me = (string)($actor['membership_id'] ?? '');
        $q = $this->db->prepare('INSERT IGNORE INTO clinic_alert_ack(membership_id,alert_key,created_at) VALUES (?,?,?)');
        foreach (array_slice($keys, 0, 100) as $key) {
            if (!is_string($key) || !preg_match('/\A('.implode('|', self::KINDS).'):[A-Za-z0-9:_-]{1,120}\z/', $key)) continue;
            $q->execute([$me, $key, $now]);
        }
        $this->db->prepare('DELETE FROM clinic_alert_ack WHERE membership_id=? AND created_at<?')->execute([$me, $now - 30 * 86400]);
    }
}
