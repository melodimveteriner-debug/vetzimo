<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Telefon Bağlantısı: kliniğin kendi hattından SMS (Android telefondaki ajan, SIM kartı) ve kendi WhatsApp numarasından
 * mesaj (bilgisayardaki ajanda WhatsApp Web ya da yarı otomatik "aç ve gönder"). Ücretli SMS/WhatsApp sağlayıcısı gerekmez.
 * Hatırlatmalar, toplu mesajlar ve gelen kutusu yanıtları aynı gönderim kuyruğundan (phone_outbox) geçer.
 */
final class PhoneGateway
{
    // Varsayılanlar araştırmaya dayanır: Android 30 dakikada 30'dan fazla SMS'te kullanıcı onayı ister (SMS arası ≥ 60 sn);
    // WhatsApp için resmi sınır yoktur, sabit değil rastgele aralık ve saatte 30'un altı önerilir (120 sn ±%20 ≈ saatte 30).
    public const DEFAULTS = ['sms' => false, 'simSlot' => '', 'smsInterval' => 75, 'smsPerDay' => 150,
        'whatsapp' => 'off', 'waRiskAccepted' => false, 'waInterval' => 120, 'waPerDay' => 100, 'sendStart' => '10:00', 'sendHours' => 9, 'both' => false, 'smsAscii' => true, 'apps' => false];
    private const STALE = 900; // sonuç bildirilmeyen işler 15 dakika sonra "belirsiz" olur, tekrar gönderilmez
    /** Telefondaki uygulama bildirimlerinden okunan kanallar (Instagram, Facebook Messenger, Telegram, WhatsApp). */
    public const APP_KINDS = ['whatsapp', 'instagram', 'messenger', 'telegram'];
    private const APP_LINKS = ['whatsapp' => 'whatsapp://', 'instagram' => 'instagram://direct-inbox', 'messenger' => 'fb-messenger://', 'telegram' => 'tg://'];
    private const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public function __construct(private readonly PDO $db) {}

    private static function hash(string $value): string { return hash('sha256', $value); }
    private static function text(mixed $value, int $max): string { return is_string($value) ? mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? ''), 0, $max, 'UTF-8') : ''; }

    private static function guard(array $actor, bool $manage = false): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'clients', false)) throw new RuntimeException('Telefon bağlantısı için müşteri yetkisi gerekir.', 403);
        if ($manage && ($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Telefon bağlantısını yalnızca klinik yöneticisi yönetebilir.', 403);
    }

    // ───────────────────────────── ayarlar ve yönlendirme ─────────────────────────────
    public function settings(string $partner): array
    {
        try {
            $q = $this->db->prepare('SELECT settings FROM phone_gateway WHERE partner_id=?');
            $q->execute([$partner]);
            $saved = json_decode((string)$q->fetchColumn(), true);
        } catch (\PDOException) { $saved = null; }
        return array_replace(self::DEFAULTS, is_array($saved) ? array_intersect_key($saved, self::DEFAULTS) : []);
    }

    private function hasDevice(string $partner): bool
    {
        $q = $this->db->prepare('SELECT 1 FROM phone_device WHERE partner_id=? AND token_hash IS NOT NULL AND revoked_at IS NULL LIMIT 1');
        $q->execute([$partner]);
        return (bool)$q->fetchColumn();
    }

    /** Kanal bu klinikte telefon üzerinden mi gider? sms: true/false, whatsapp: 'auto' | 'assist' | false */
    public function route(string $partner, string $channel): string|bool
    {
        try { $s = $this->settings($partner); } catch (\Throwable) { return false; }
        if ($channel === 'sms') return $s['sms'] && $this->hasDevice($partner);
        if ($channel === 'whatsapp') return in_array($s['whatsapp'], ['auto', 'assist'], true) ? $s['whatsapp'] : false;
        if ($channel === 'app') return $s['apps'] && $this->hasDevice($partner);
        return false;
    }

    /** @return array<string,array{sms:bool,whatsapp:string|bool}> telefonla gönderimi açık klinikler */
    public function routesAll(): array
    {
        try { $rows = $this->db->query('SELECT partner_id FROM phone_gateway')->fetchAll(PDO::FETCH_COLUMN); } catch (\PDOException) { return []; }
        $out = [];
        foreach ($rows as $partner) {
            $r = ['sms' => $this->route($partner, 'sms'), 'whatsapp' => $this->route($partner, 'whatsapp')];
            $r['both'] = $r['sms'] && $r['whatsapp'] && $this->settings($partner)['both'];
            if ($r['sms'] || $r['whatsapp']) $out[$partner] = $r;
        }
        return $out;
    }

    public function saveSettings(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $s = $this->settings($actor['partner_id']);
        $int = static function ($v, int $min, int $max, string $label) { if (!is_int($v) || $v < $min || $v > $max) throw new RuntimeException($label.' '.$min.'-'.$max.' arasında olmalı.', 422); return $v; };
        $s['sms'] = !empty($input->sms);
        $s['simSlot'] = in_array($input->simSlot ?? '', ['', '0', '1'], true) ? ($input->simSlot ?? '') : '';
        $s['smsInterval'] = $int($input->smsInterval ?? $s['smsInterval'], 60, 3600, 'SMS arası bekleme (saniye)');
        $s['smsPerDay'] = $int($input->smsPerDay ?? $s['smsPerDay'], 1, 1000, 'Günlük SMS sınırı');
        $mode = $input->whatsapp ?? 'off';
        if (!in_array($mode, ['off', 'assist', 'auto'], true)) throw new RuntimeException('WhatsApp modu geçersiz.', 422);
        $s['waRiskAccepted'] = !empty($input->waRiskAccepted);
        if ($mode === 'auto' && !$s['waRiskAccepted']) throw new RuntimeException('Otomatik WhatsApp için risk bilgilendirmesini onaylayın.', 422);
        $s['whatsapp'] = $mode;
        $s['waInterval'] = $int($input->waInterval ?? $s['waInterval'], 30, 3600, 'WhatsApp arası bekleme (saniye)');
        $s['waPerDay'] = $int($input->waPerDay ?? $s['waPerDay'], 1, 400, 'Günlük WhatsApp sınırı');
        $start = $input->sendStart ?? $s['sendStart'];
        if (!is_string($start) || !preg_match('/\A([01][0-9]|2[0-3]):[0-5][0-9]\z/', $start)) throw new RuntimeException('Başlangıç saati SS:DD biçiminde olmalı.', 422);
        $s['sendStart'] = $start;
        $s['sendHours'] = $int($input->sendHours ?? $s['sendHours'], 1, 16, 'Gönderim süresi (saat)');
        $s['both'] = !empty($input->both);
        $s['smsAscii'] = !empty($input->smsAscii);
        $s['apps'] = !empty($input->apps);
        $this->db->prepare('INSERT INTO phone_gateway (partner_id,settings,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE settings=VALUES(settings),updated_at=VALUES(updated_at)')
            ->execute([$actor['partner_id'], json_encode($s, JSON_UNESCAPED_UNICODE), $now]);
        if ($s['sms']) $this->channel($actor['partner_id'], 'sms', $now);
        if ($s['whatsapp'] === 'auto') $this->channel($actor['partner_id'], 'whatsapp', $now);
        return $this->status($actor, $now);
    }

    /** Sohbette telefon kanalı (SMS: Android ajanı, WhatsApp: bilgisayardaki WhatsApp Web). */
    public function channel(string $partner, string $kind, int $now, string $provider = ''): array
    {
        $provider = $provider !== '' ? $provider : ($kind === 'sms' ? 'phone' : 'device');
        $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE partner_id=? AND kind=? AND JSON_VALUE(config,'$.provider')=?");
        $q->execute([$partner, $kind, $provider]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            if ($row['status'] === 'removed') $this->db->prepare("UPDATE inbox_channel SET status='active' WHERE id=?")->execute([$row['id']]);
            return $row;
        }
        $id = bin2hex(random_bytes(16));
        $this->db->prepare('INSERT INTO inbox_channel (id,partner_id,kind,label,status,hook_key,external_id,config,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $partner, $kind, $provider === 'notify' ? (OmniInbox::KINDS[$kind] ?? $kind).' (klinik telefonu)' : ($kind === 'sms' ? 'SMS (klinik telefonu)' : 'WhatsApp (klinik numarası)'), 'active', bin2hex(random_bytes(20)), $provider,
                json_encode(['provider' => $provider]), $now]);
        $q->execute([$partner, $kind, $provider]);
        return $q->fetch(PDO::FETCH_ASSOC);
    }

    // ───────────────────────────── kuyruk ─────────────────────────────
    /** Mesajı gönderim kuyruğuna ekler; aynı kaynak+referans ikinci kez eklenmez. Kuyruk kimliğini döndürür. */
    public function enqueue(string $partner, string $channel, string $phone, string $body, string $source, string $ref, int $priority, int $now, ?int $expires = null, string $by = ''): int
    {
        // Uygulama yanıtında (Instagram/Facebook/Telegram) numara yerine uygulama adı tutulur.
        $phone = $channel === 'app' ? (in_array($phone, self::APP_KINDS, true) ? $phone : '') : DealerLogin::normalizePhone($phone);
        if ($phone === '') throw new RuntimeException('Telefon numarası geçersiz (Türkiye cep numarası gerekli).', 422);
        $body = trim($body);
        if ($body === '' || mb_strlen($body) > 4000) throw new RuntimeException('Mesaj 1-4000 karakter olmalı.', 422);
        if (!in_array($channel, ['sms', 'whatsapp', 'app'], true) || !in_array($source, ['reminder', 'bulk', 'inbox', 'test', 'manual', 'center'], true)) throw new RuntimeException('Kuyruk isteği geçersiz.', 422);
        // Çift gönderim koruması: aynı kayıt (kaynak + referans) zaten kuyruktaysa yeni mesaj açılmaz.
        $q = $this->db->prepare('SELECT id FROM phone_outbox WHERE source=? AND source_ref=?');
        $q->execute([$source, mb_substr($ref, 0, 190)]);
        if ($existing = (int)$q->fetchColumn()) return $existing;
        if ($source !== 'test' && $channel !== 'app') {
            // Aynı alıcıya aynı metin son 24 saatte gönderildiyse/kuyruktaysa ikinci kez gönderilmez (çift tıklama, yeniden kaydetme, döngü).
            $same = $this->db->prepare("SELECT id FROM phone_outbox WHERE partner_id=? AND channel=? AND phone=? AND body=? AND created_at>?
                AND status IN ('queued','claimed','sent','unknown') ORDER BY id DESC LIMIT 1");
            $same->execute([$partner, $channel, $phone, $body, $now - 86400]);
            if ($dup = (int)$same->fetchColumn()) return $dup;
            // Bağlantılı tek kişilik mesajlar (davet, onay formu, onam, ödeme talebi, hoş geldin): kişi başına 10 dakikada 1, 24 saatte en çok 3.
            $kind = $source === 'manual' ? explode(':', $ref)[0] : '';
            if (in_array($kind, ['invite', 'permit', 'consent', 'payreq', 'welcome'], true)) {
                $c = $this->db->prepare("SELECT COUNT(*),COALESCE(MAX(created_at),0) FROM phone_outbox WHERE partner_id=? AND channel=? AND phone=? AND source='manual' AND source_ref LIKE ? AND created_at>?
                    AND status IN ('queued','claimed','sent','unknown')");
                $c->execute([$partner, $channel, $phone, $kind.':%', $now - 86400]);
                [$count, $last] = array_map('intval', $c->fetch(PDO::FETCH_NUM));
                if ($now - $last < 600) throw new RuntimeException('Bu kişiye az önce aynı türde mesaj gönderildi. Tekrar göndermek için 10 dakika bekleyin.', 429);
                if ($count >= 3) throw new RuntimeException('Bu kişiye son 24 saatte bu türde 3 mesaj gönderildi; tekrar göndermek için yarını bekleyin veya bağlantıyı kopyalayıp iletin.', 429);
            }
        }
        $this->checkMonthlyLimit($partner, $channel, $source, $ref, $now);
        $this->db->prepare('INSERT IGNORE INTO phone_outbox (partner_id,channel,phone,body,source,source_ref,priority,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$partner, $channel, $phone, $body, $source, mb_substr($ref, 0, 190), $priority, $expires, mb_substr($by, 0, 120), $now]);
        $q = $this->db->prepare('SELECT id FROM phone_outbox WHERE source=? AND source_ref=?');
        $q->execute([$source, mb_substr($ref, 0, 190)]);
        return (int)$q->fetchColumn();
    }

    /** Paketteki aylık SMS/WhatsApp sınırı (boş = sınırsız) ve bu ayki kullanım. Aynı kaynak kaydının yeniden kuyruğa alınması sayılmaz. */
    public function monthlyUsage(string $partner, int $now): array
    {
        $limits = (new Commerce($this->db))->packageActor(['partner_id' => $partner])['packageLimits'] ?? ['sms' => null, 'whatsapp' => null];
        $start = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->modify('first day of this month')->setTime(0, 0)->getTimestamp();
        $used = $this->usedSince($partner, $start);
        return ['sms' => ['used' => $used['sms'], 'limit' => $limits['sms'] ?? null], 'whatsapp' => ['used' => $used['whatsapp'], 'limit' => $limits['whatsapp'] ?? null]];
    }

    /**
     * Verilen andan bu yana gönderilen SMS/WhatsApp sayısı: telefon hattından giden tüm mesajlar (hatırlatma, davet,
     * gelen kutusu yanıtı, deneme, toplu) + sağlayıcıyla giden toplu gönderimlerin kredisi (telefondan gidenin kredisi 0 yazılır);
     * VetZimo merkez hattının mesajları kliniğin hakkından düşmez.
     */
    public function usedSince(string $partner, int $since): array
    {
        $q = $this->db->prepare("SELECT channel,COUNT(*) FROM phone_outbox WHERE partner_id=? AND created_at>=? AND channel IN ('sms','whatsapp')
            AND status NOT IN ('failed','cancelled','expired') AND source<>'center' GROUP BY channel");
        $q->execute([$partner, $since]);
        $used = $q->fetchAll(PDO::FETCH_KEY_PAIR);
        $b = $this->db->prepare("SELECT channel,COALESCE(SUM(units),0) FROM clinic_bulk_message WHERE partner_id=? AND status<>'rejected' AND created_at>=? GROUP BY channel");
        $b->execute([$partner, gmdate('Y-m-d H:i:s', $since)]);
        foreach ($b->fetchAll(PDO::FETCH_KEY_PAIR) as $channel => $units) $used[$channel] = (int)($used[$channel] ?? 0) + (int)$units;
        return ['sms' => (int)($used['sms'] ?? 0), 'whatsapp' => (int)($used['whatsapp'] ?? 0)];
    }

    private function checkMonthlyLimit(string $partner, string $channel, string $source, string $ref, int $now): void
    {
        // Merkez mesajları (VetZimo hattı) sınıra sayılmaz; toplu gönderimin hakkı gönderim başlatılırken ayrılır; deneme mesajı sayılır ama engellenmez.
        if (in_array($source, ['test', 'center', 'bulk'], true) || $channel === 'app') return;
        $q = $this->db->prepare('SELECT 1 FROM phone_outbox WHERE source=? AND source_ref=?');
        $q->execute([$source, mb_substr($ref, 0, 190)]);
        if ($q->fetchColumn()) return;
        $usage = $this->monthlyUsage($partner, $now)[$channel];
        if ($usage['limit'] !== null && $usage['used'] >= $usage['limit']) {
            // Aylık hak bitti: satın alınmış ek krediden bir adet düşülür; o da yoksa gönderim durur.
            if ((new AddonPackages($this->db))->consume($partner, $channel, $source.':'.mb_substr($ref, 0, 150), $now)) return;
            $name = $channel === 'sms' ? 'SMS' : 'WhatsApp';
            throw new RuntimeException($name.' hakkınız bitmiştir. Bu ayki '.$usage['limit'].' '.$name.' hakkınızın tamamı kullanıldı ve ek krediniz yok. Gönderime devam etmek için Muhasebe › Abonelik mağazası › Ek paketler bölümünden '.$name.' paketi alın.', 429);
        }
    }

    /**
     * Gönderim geçmişi: telefon hattından giden mesajlar (bayi yöneticisi görür): alıcı telefonu, mesaj metni, gönderen, tarih-saat.
     * $channel boşsa SMS ve WhatsApp birlikte.
     */
    public function history(string $partner, string $channel, int $limit = 200): array
    {
        $q = $this->db->prepare("SELECT id,channel,phone,body,status,source,source_ref,error,created_by,created_at,done_at FROM phone_outbox
            WHERE partner_id=? AND ".($channel === '' ? "channel IN ('sms','whatsapp')" : 'channel=?')." AND source<>'center' ORDER BY created_at DESC,id DESC LIMIT ".max(1, min(500, $limit)));
        $q->execute($channel === '' ? [$partner] : [$partner, $channel]);
        $map = ['queued' => 'queued', 'claimed' => 'sending', 'sent' => 'sent', 'unknown' => 'unknown', 'failed' => 'failed', 'expired' => 'expired', 'cancelled' => 'cancelled'];
        $out = [];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $kind = $r['source'] === 'manual' ? explode(':', $r['source_ref'])[0] : $r['source'];
            $digits = preg_replace('/\D+/', '', $r['phone']);
            $out[] = ['id' => 'gw'.$r['id'], 'channel' => $r['channel'], 'phone' => $r['phone'], 'masked_phone' => '+90 ••• ••• •• '.substr($digits, -2),
                'body' => $r['body'], 'error' => $r['error'],
                'status' => $map[$r['status']] ?? 'unknown', 'units' => in_array($r['status'], ['failed', 'cancelled', 'expired'], true) ? 0 : 1,
                'kind' => $kind, 'by' => $r['created_by'], 'created_at' => gmdate('Y-m-d H:i:s', (int)$r['created_at']),
                'sent_at' => $r['done_at'] ? gmdate('Y-m-d H:i:s', (int)$r['done_at']) : null];
        }
        return $out;
    }

    /** Günlük gönderim penceresi dışında mı? (Türkiye saati; başlangıç + süre, gece yarısını aşabilir.) */
    public static function quiet(array $s, int $now): bool
    {
        return self::untilWindow($s, $now) > 0;
    }

    /** Pencere açıksa 0, değilse açılmasına kalan saniye. */
    public static function untilWindow(array $s, int $now): int
    {
        $local = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'));
        $t = (int)$local->format('G') * 60 + (int)$local->format('i');
        [$h, $m] = array_map('intval', explode(':', $s['sendStart']));
        $start = $h * 60 + $m;
        $end = $start + (int)$s['sendHours'] * 60;
        $inside = $end <= 1440 ? ($t >= $start && $t < $end) : ($t >= $start || $t < $end - 1440);
        if ($inside) return 0;
        $wait = ($start - $t + 1440) % 1440;
        return max(60, $wait * 60 - (int)$local->format('s'));
    }

    /** Ayarlarla bir günde gönderilebilecek yaklaşık en çok mesaj. */
    public static function capacity(array $s, string $channel): int
    {
        $interval = $channel === 'sms' ? $s['smsInterval'] : $s['waInterval'];
        $perDay = $channel === 'sms' ? $s['smsPerDay'] : $s['waPerDay'];
        $byWindow = intdiv((int)$s['sendHours'] * 3600, (int)$interval);
        if ($channel === 'sms') $byWindow = min($byWindow, (int)$s['sendHours'] * 58); // Android: 30 dakikada en çok 29
        return min($perDay, $byWindow);
    }

    private function sweep(string $partner, int $now): void
    {
        $stale = $this->db->prepare("SELECT * FROM phone_outbox WHERE partner_id=? AND status='claimed' AND claimed_at<?");
        $stale->execute([$partner, $now - self::STALE]);
        foreach ($stale->fetchAll(PDO::FETCH_ASSOC) as $row) $this->finish($row, 'unknown', 'Cihaz sonuç bildirmedi; çift gönderimi önlemek için yeniden denenmedi.', $now);
        $old = $this->db->prepare("SELECT * FROM phone_outbox WHERE partner_id=? AND status='queued' AND expires_at IS NOT NULL AND expires_at<=?");
        $old->execute([$partner, $now]);
        foreach ($old->fetchAll(PDO::FETCH_ASSOC) as $row) $this->finish($row, 'expired', 'Zamanında gönderilemedi (cihaz kapalı veya sessiz saat).', $now);
    }

    private function sentSince(string $partner, string $channel, int $since): int
    {
        $q = $this->db->prepare("SELECT COUNT(*) FROM phone_outbox WHERE partner_id=? AND channel=? AND status IN ('claimed','sent','unknown') AND COALESCE(claimed_at,done_at)>=?");
        $q->execute([$partner, $channel, $since]);
        return (int)$q->fetchColumn();
    }

    private static function dayStart(int $now): int
    {
        return (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->setTime(0, 0)->getTimestamp();
    }

    /**
     * Zamanlama: öncelikli işler (gelen kutusu yanıtı, deneme, onay bağlantısı) beklemeden en az 8 sn arayla gider;
     * hatırlatma ve toplu mesajlar yalnız günlük pencerede, ayarlanan saniye aralığıyla (±%20 rastgele) tek tek verilir.
     * @return array{0:list<array>,1:int} işler ve bir sonraki denemeye kadar önerilen bekleme (sn)
     */
    private function schedule(string $partner, string $channel, string $device, array $s, int $now): array
    {
        $perDay = $channel === 'sms' ? $s['smsPerDay'] : $s['waPerDay'];
        if ($this->sentSince($partner, $channel, self::dayStart($now)) >= $perDay) return [[], 900];
        if ($channel === 'sms' && $this->sentSince($partner, 'sms', $now - 1800) >= 29) return [[], 60];
        $q = $this->db->prepare("SELECT COALESCE(MAX(claimed_at),0) FROM phone_outbox WHERE partner_id=? AND channel=? AND claimed_at IS NOT NULL");
        $q->execute([$partner, $channel]);
        $last = (int)$q->fetchColumn();
        $gap = $now - $last;
        if ($gap >= 8) {
            $jobs = $this->claim($partner, $channel, $device, 1, true, $now);
            if ($jobs) return [$jobs, 8];
        }
        $until = self::untilWindow($s, $now);
        if ($until > 0) return [[], min(900, $until)];
        $interval = $channel === 'sms' ? $s['smsInterval'] : $s['waInterval'];
        $need = (int)round($interval * (0.8 + (crc32($partner.':'.$last) % 41) / 100));
        if ($gap < $need) return [[], max(3, $need - $gap)];
        return [$this->claim($partner, $channel, $device, 1, false, $now), $need];
    }

    private function claim(string $partner, string $channel, string $device, int $limit, bool $priorityOnly, int $now): array
    {
        if ($limit <= 0) return [];
        $q = $this->db->prepare("SELECT * FROM phone_outbox WHERE partner_id=? AND channel=? AND status='queued' AND not_before<=?".($priorityOnly ? ' AND priority=0' : '').' ORDER BY priority,id LIMIT '.(int)$limit);
        $q->execute([$partner, $channel, $now]);
        $jobs = [];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $u = $this->db->prepare("UPDATE phone_outbox SET status='claimed',device_id=?,claimed_at=? WHERE id=? AND status='queued'");
            $u->execute([$device, $now, $row['id']]);
            if ($u->rowCount() === 1) $jobs[] = ['id' => (int)$row['id'], 'phone' => $row['phone'], 'body' => $row['body']];
        }
        return $jobs;
    }

    /** İş sonucunu kaydeder ve kaynağına (gelen kutusu, hatırlatma, toplu mesaj) yansıtır. */
    private function finish(array $row, string $status, string $error, int $now): void
    {
        $this->db->prepare('UPDATE phone_outbox SET status=?,error=?,done_at=? WHERE id=?')->execute([$status, mb_substr($error, 0, 300, 'UTF-8'), $now, $row['id']]);
        $mapped = ['sent' => 'accepted', 'failed' => 'rejected', 'expired' => 'rejected', 'cancelled' => 'rejected'][$status] ?? 'unknown';
        if (in_array($status, ['failed', 'expired', 'cancelled'], true) && in_array($row['channel'], ['sms', 'whatsapp'], true)) {
            (new AddonPackages($this->db))->refund($row['partner_id'], $row['channel'], $row['source'].':'.mb_substr((string)$row['source_ref'], 0, 150), $now);
        }
        try {
            if ($row['source'] === 'inbox') {
                $this->db->prepare('UPDATE inbox_message SET status=?,error=? WHERE partner_id=? AND external_id=?')
                    ->execute([$status === 'sent' ? 'sent' : ($status === 'unknown' ? 'sent' : 'failed'), $status === 'sent' ? '' : mb_substr($error, 0, 300, 'UTF-8'), $row['partner_id'], 'gw:'.$row['id']]);
            } elseif ($row['source'] === 'reminder') {
                $this->db->prepare('UPDATE clinic_appointment_reminder SET status=? WHERE dispatch_key=?')->execute([$mapped, $row['source_ref']]);
            } elseif ($row['source'] === 'bulk') {
                $this->db->prepare('UPDATE clinic_bulk_message SET status=? WHERE id=? AND partner_id=?')->execute([$mapped, $row['source_ref'], $row['partner_id']]);
            }
        } catch (\PDOException) { /* kaynak tablo yoksa kuyruk kaydı yine güncellenir */ }
    }

    private function results(string $partner, string $device, mixed $results, int $now): void
    {
        foreach (is_array($results) ? array_slice($results, 0, 50) : [] as $r) {
            if (!is_object($r) || !is_int($r->id ?? null) || !in_array($r->status ?? '', ['sent', 'failed'], true)) continue;
            $q = $this->db->prepare("SELECT * FROM phone_outbox WHERE id=? AND partner_id=? AND device_id=? AND status='claimed'");
            $q->execute([$r->id, $partner, $device]);
            if ($row = $q->fetch(PDO::FETCH_ASSOC)) $this->finish($row, $r->status, self::text($r->error ?? '', 300), $now);
        }
    }

    // ───────────────────────────── Android ajanı ─────────────────────────────
    public function pair(array $actor, int $now): array
    {
        self::guard($actor, true);
        $count = $this->db->prepare('SELECT COUNT(*) FROM phone_device WHERE partner_id=? AND revoked_at IS NULL');
        $count->execute([$actor['partner_id']]);
        if ((int)$count->fetchColumn() >= 10) throw new RuntimeException('En fazla 10 telefon bağlanabilir.', 422);
        $this->db->prepare('DELETE FROM phone_device WHERE partner_id=? AND token_hash IS NULL')->execute([$actor['partner_id']]);
        $code = '';
        for ($i = 0; $i < 10; $i++) $code .= self::PAIR_ALPHABET[random_int(0, strlen(self::PAIR_ALPHABET) - 1)];
        $this->db->prepare('INSERT INTO phone_device (id,partner_id,name,pair_hash,pair_expires,created_at) VALUES (?,?,?,?,?,?)')
            ->execute([bin2hex(random_bytes(16)), $actor['partner_id'], 'Yeni telefon', self::hash($code), $now + 1800, $now]);
        return ['code' => substr($code, 0, 5).'-'.substr($code, 5), 'expires' => $now + 1800];
    }

    public function revoke(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $id = $input->id ?? '';
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new RuntimeException('Cihaz bulunamadı.', 404);
        $this->db->prepare('UPDATE phone_device SET revoked_at=?,token_hash=NULL WHERE partner_id=? AND id=?')->execute([$now, $actor['partner_id'], $id]);
        return $this->status($actor, $now);
    }

    /** Kurulum betiği indirmesi için: süresi dolmamış, henüz kullanılmamış eşleştirme kodu mu? */
    public function pendingCode(mixed $code, int $now): bool
    {
        $code = is_string($code) ? strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '') : '';
        if (!preg_match('/\A[A-Z0-9]{10}\z/', $code)) return false;
        $q = $this->db->prepare('SELECT pair_expires FROM phone_device WHERE pair_hash=? AND token_hash IS NULL AND revoked_at IS NULL');
        $q->execute([self::hash($code)]);
        $exp = $q->fetchColumn();
        return $exp !== false && (int)$exp >= $now;
    }

    public function agentPair(mixed $code, mixed $name, mixed $version, mixed $info, int $now): array
    {
        $code = is_string($code) ? strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '') : '';
        if (!preg_match('/\A[A-Z0-9]{10}\z/', $code)) throw new RuntimeException('Eşleştirme kodu geçersiz.', 422);
        $q = $this->db->prepare('SELECT * FROM phone_device WHERE pair_hash=? AND token_hash IS NULL AND revoked_at IS NULL');
        $q->execute([self::hash($code)]);
        $device = $q->fetch(PDO::FETCH_ASSOC);
        if (!$device || (int)$device['pair_expires'] < $now) throw new RuntimeException('Kod bulunamadı veya süresi doldu. Klinik panelinden yeni kod alın.', 404);
        $token = bin2hex(random_bytes(32));
        $this->db->prepare('UPDATE phone_device SET token_hash=?,pair_hash=NULL,pair_expires=NULL,name=?,version=?,info=?,last_seen=? WHERE id=?')
            ->execute([self::hash($token), self::text($name, 80) ?: 'Android telefon', self::text($version, 20), self::text($info, 300), $now, $device['id']]);
        $this->channel($device['partner_id'], 'sms', $now);
        return ['token' => $token];
    }

    public function agentAuth(string $header): array
    {
        if (!preg_match('/\ABearer ([a-f0-9]{64})\z/', $header, $m)) throw new RuntimeException('Telefon kimliği gerekli.', 401);
        $q = $this->db->prepare('SELECT * FROM phone_device WHERE token_hash=? AND revoked_at IS NULL');
        $q->execute([self::hash($m[1])]);
        $device = $q->fetch(PDO::FETCH_ASSOC);
        if (!$device) throw new RuntimeException('Bu telefonun bağlantısı kaldırılmış. Klinik panelinden yeniden eşleştirin.', 401);
        return $device;
    }

    /** Android ajanı her 10-20 saniyede bir çağırır: durum, gelen SMS'ler, gönderim sonuçları → yeni işler. */
    public function sync(array $device, object $input, int $now, ?OmniInbox $inbox = null): array
    {
        $partner = $device['partner_id'];
        $battery = is_int($input->battery ?? null) && $input->battery >= 0 && $input->battery <= 100 ? $input->battery : null;
        $this->db->prepare('UPDATE phone_device SET last_seen=?,battery=COALESCE(?,battery),version=?,info=?,last_error=? WHERE id=?')
            ->execute([$now, $battery, self::text($input->version ?? $device['version'], 20), self::text($input->info ?? $device['info'], 300), self::text($input->error ?? '', 300), $device['id']]);
        $this->results($partner, $device['id'], $input->results ?? null, $now);
        // Yarı otomatik WhatsApp: personel bildirimdeki mesajı açtıysa gönderildi sayılır.
        foreach (is_array($input->opened ?? null) ? array_slice($input->opened, 0, 50) : [] as $id) {
            if (!is_int($id)) continue;
            $q = $this->db->prepare("SELECT * FROM phone_outbox WHERE id=? AND partner_id=? AND channel IN ('whatsapp','app') AND status='queued'");
            $q->execute([$id, $partner]);
            if ($row = $q->fetch(PDO::FETCH_ASSOC)) $this->finish($row, 'sent', '', $now);
        }
        $inbound = 0;
        if ($inbox && is_array($input->inbound ?? null)) {
            $channel = $this->channel($partner, 'sms', $now);
            $mark = (int)$device['inbound_mark'];
            foreach (array_slice($input->inbound, 0, 100) as $sms) {
                if (!is_object($sms) || !is_int($sms->id ?? null) || !is_string($sms->number ?? null) || !is_string($sms->body ?? null)) continue;
                $from = OmniInbox::phone($sms->number);
                if ($from === '' || strlen(preg_replace('/\D/', '', $from) ?? '') < 7) continue; // kısa numaralı operatör/kampanya mesajları alınmaz
                $at = is_int($sms->at ?? null) && $sms->at > 0 ? min($sms->at, $now) : $now;
                if ($inbox->ingest($channel, $from, '', $from, $sms->body, 'psms:'.$device['id'].':'.$sms->id, $at)) $inbound++;
                $mark = max($mark, $sms->id);
            }
            $this->db->prepare('UPDATE phone_device SET inbound_mark=? WHERE id=?')->execute([$mark, $device['id']]);
        }
        $s = $this->settings($partner);
        // Uygulama bildirimleri: Instagram, Facebook, Telegram ve WhatsApp'a gelen mesajlar telefonun bildiriminden okunur.
        if ($inbox && $s['apps'] && is_array($input->apps ?? null)) {
            foreach (array_slice($input->apps, 0, 100) as $m) {
                if (!is_object($m) || !in_array($m->app ?? '', self::APP_KINDS, true) || !is_string($m->key ?? null) || !is_string($m->name ?? null) || !is_string($m->text ?? null)) continue;
                $name = self::text($m->name, 120);
                if ($name === '' || !preg_match('/\A[A-Za-z0-9:_-]{6,80}\z/', $m->key)) continue;
                $at = is_int($m->at ?? null) && $m->at > 0 ? min($m->at, $now) : $now;
                $phone = $m->app === 'whatsapp' ? OmniInbox::phone($name) : '';
                $contact = $phone !== '' && strlen(preg_replace('/\D/', '', $phone) ?? '') >= 10 ? $phone : $name;
                if ($inbox->ingest($this->channel($partner, $m->app, $now, 'notify'), $contact, $name, $contact, mb_substr($m->text, 0, 4000, 'UTF-8'), 'pn:'.$device['id'].':'.$m->key, $at)) $inbound++;
            }
        }
        $this->sweep($partner, $now);
        $jobs = [];
        $wait = 15;
        if ($s['sms']) {
            [$jobs, $wait] = $this->schedule($partner, 'sms', $device['id'], $s, $now);
            if ($s['smsAscii']) foreach ($jobs as &$job) $job['body'] = self::gsm($job['body']);
            unset($job);
        }
        $assist = [];
        if ($s['whatsapp'] === 'assist') {
            $q = $this->db->prepare("SELECT id,phone,body FROM phone_outbox WHERE partner_id=? AND channel='whatsapp' AND status='queued' ORDER BY priority,id LIMIT 10");
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $assist[] = ['id' => (int)$r['id'], 'phone' => $r['phone'], 'link' => self::waLink($r['phone'], $r['body']), 'preview' => mb_substr($r['body'], 0, 80, 'UTF-8')];
        }
        $replies = [];
        if ($s['apps']) {
            $q = $this->db->prepare("SELECT o.id,o.phone app,o.body,c.contact_name name FROM phone_outbox o LEFT JOIN inbox_message m ON m.partner_id=o.partner_id AND m.external_id=CONCAT('gw:',o.id)
                LEFT JOIN inbox_conversation c ON c.id=m.conversation_id WHERE o.partner_id=? AND o.channel='app' AND o.status='queued' ORDER BY o.priority,o.id LIMIT 10");
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) if (isset(self::APP_LINKS[$r['app']])) $replies[] = ['id' => (int)$r['id'], 'app' => $r['app'], 'name' => (string)$r['name'], 'body' => $r['body'], 'link' => self::APP_LINKS[$r['app']]];
        }
        return ['jobs' => $jobs, 'assist' => $assist, 'replies' => $replies, 'apps' => $s['apps'], 'simSlot' => $s['simSlot'], 'interval' => max(3, min(30, $wait)), 'received' => $inbound, 'mark' => (int)$this->db->query('SELECT inbound_mark FROM phone_device WHERE id='.$this->db->quote($device['id']))->fetchColumn()];
    }

    /**
     * Türkçe karakterleri sadeleştirir: GSM-7 alfabesinde SMS 160 karakter (parçalıda 153), Türkçe karakterli (UCS-2) SMS 70 (67).
     * Böylece hoş geldin mesajı gibi kısa metinler tek SMS'e sığar.
     */
    public static function gsm(string $text): string
    {
        return strtr($text, ['ç' => 'c', 'Ç' => 'C', 'ğ' => 'g', 'Ğ' => 'G', 'ı' => 'i', 'İ' => 'I', 'ö' => 'o', 'Ö' => 'O', 'ş' => 's', 'Ş' => 'S', 'ü' => 'u', 'Ü' => 'U',
            'â' => 'a', 'Â' => 'A', 'î' => 'i', 'û' => 'u', '’' => "'", '‘' => "'", '“' => '"', '”' => '"', '–' => '-', '—' => '-', '…' => '...', '•' => '-', '₺' => 'TL']);
    }

    /** SMS parça sayısı (GSM-7 160/153, UCS-2 70/67). */
    public static function segments(string $text): int
    {
        $ucs = preg_match('/[^\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà§¿¡]/u', $text) === 1;
        $len = mb_strlen($text, 'UTF-8');
        if ($ucs) return $len <= 70 ? 1 : (int)ceil($len / 67);
        return $len <= 160 ? 1 : (int)ceil($len / 153);
    }

    public static function waLink(string $phone, string $body): string
    {
        return 'https://wa.me/'.ltrim($phone, '+').'?text='.rawurlencode($body);
    }

    // ───────────────────────────── bilgisayar ajanı (WhatsApp Web) ─────────────────────────────
    /** Bakanlık köprüsü ajanı (klinik bilgisayarı) WhatsApp Web durumunu bildirir, gelen mesajları iletir, otomatik işleri alır. */
    public function waSync(array $agent, object $input, int $now, ?OmniInbox $inbox = null): array
    {
        $partner = $agent['partner_id'];
        $device = 'pc:'.$agent['id'];
        $state = in_array($input->state ?? '', ['off', 'qr', 'ready', 'closed', 'error'], true) ? $input->state : 'off';
        $this->db->prepare('INSERT INTO phone_gateway (partner_id,settings,wa_state,wa_seen,wa_agent,wa_error,updated_at) VALUES (?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE wa_state=VALUES(wa_state),wa_seen=VALUES(wa_seen),wa_agent=VALUES(wa_agent),wa_error=VALUES(wa_error)')
            ->execute([$partner, json_encode(self::DEFAULTS), $state, $now, $agent['id'], self::text($input->error ?? '', 300), $now]);
        $this->results($partner, $device, $input->results ?? null, $now);
        $received = 0;
        if ($inbox && is_array($input->inbound ?? null)) {
            $channel = $this->channel($partner, 'whatsapp', $now);
            foreach (array_slice($input->inbound, 0, 100) as $m) {
                if (!is_object($m) || !is_string($m->id ?? null) || !is_string($m->phone ?? null) || !is_string($m->body ?? null)) continue;
                $from = OmniInbox::phone($m->phone);
                if ($from === '') continue;
                $at = is_int($m->at ?? null) && $m->at > 0 ? min($m->at, $now) : $now;
                if ($inbox->ingest($channel, $from, self::text($m->name ?? '', 120), $from, $m->body, 'wweb:'.mb_substr($m->id, 0, 170), $at)) $received++;
            }
        }
        $this->sweep($partner, $now);
        $s = $this->settings($partner);
        $jobs = [];
        $wait = 20;
        if ($s['whatsapp'] === 'auto' && $state === 'ready') {
            [$jobs, $wait] = $this->schedule($partner, 'whatsapp', $device, $s, $now);
        }
        return ['mode' => $s['whatsapp'], 'jobs' => $jobs, 'wait' => $wait, 'readInbound' => $s['whatsapp'] === 'auto', 'received' => $received];
    }

    // ───────────────────────────── klinik ekranı ─────────────────────────────
    public function status(array $actor, int $now): array
    {
        self::guard($actor);
        $partner = $actor['partner_id'];
        $this->sweep($partner, $now);
        $dev = $this->db->prepare('SELECT id,name,version,battery,info,last_error,created_at,last_seen,token_hash IS NOT NULL AS paired FROM phone_device WHERE partner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL ORDER BY created_at');
        $dev->execute([$partner]);
        $devices = array_map(static fn($d) => ['id' => $d['id'], 'name' => $d['name'], 'version' => $d['version'], 'battery' => $d['battery'] === null ? null : (int)$d['battery'],
            'info' => $d['info'], 'error' => $d['last_error'], 'lastSeen' => $d['last_seen'] === null ? null : (int)$d['last_seen'], 'online' => $d['last_seen'] !== null && $now - (int)$d['last_seen'] < 90], $dev->fetchAll(PDO::FETCH_ASSOC));
        $g = $this->db->prepare('SELECT wa_state,wa_seen,wa_error FROM phone_gateway WHERE partner_id=?');
        $g->execute([$partner]);
        $wa = $g->fetch(PDO::FETCH_ASSOC) ?: ['wa_state' => '', 'wa_seen' => null, 'wa_error' => ''];
        $waOnline = $wa['wa_seen'] !== null && $now - (int)$wa['wa_seen'] < 120;
        $list = $this->db->prepare('SELECT id,channel,phone,body,source,status,error,created_at,done_at,created_by FROM phone_outbox WHERE partner_id=? AND source<>"center" ORDER BY id DESC LIMIT 80');
        $list->execute([$partner]);
        $outbox = array_map(static fn($r) => ['id' => (int)$r['id'], 'channel' => $r['channel'], 'phone' => $r['phone'], 'body' => $r['body'], 'source' => $r['source'], 'status' => $r['status'],
            'error' => $r['error'], 'at' => (int)$r['created_at'], 'doneAt' => $r['done_at'] === null ? null : (int)$r['done_at'], 'by' => $r['created_by'],
            'link' => $r['channel'] === 'whatsapp' && $r['status'] === 'queued' ? self::waLink($r['phone'], $r['body']) : null], $list->fetchAll(PDO::FETCH_ASSOC));
        $c = $this->db->prepare("SELECT channel,SUM(status='queued') q,SUM(status='sent' AND done_at>=?) s,SUM(status IN ('failed','unknown','expired') AND created_at>=?) f FROM phone_outbox WHERE partner_id=? AND source<>'center' GROUP BY channel");
        $day = self::dayStart($now);
        $c->execute([$day, $day, $partner]);
        $counts = [];
        foreach ($c->fetchAll(PDO::FETCH_ASSOC) as $r) $counts[$r['channel']] = ['queued' => (int)$r['q'], 'sentToday' => (int)$r['s'], 'failedToday' => (int)$r['f']];
        $s = $this->settings($partner);
        $own = DealerLogin::normalizePhone((string)($actor['identifier'] ?? ''));
        return ['ownPhone' => $own === '' ? '' : '0'.substr($own, 3, 3).' '.substr($own, 6, 3).' '.substr($own, 9, 2).' '.substr($own, 11, 2), 'settings' => $s, 'devices' => $devices, 'canManage' => ($actor['role'] ?? '') === 'dealer', 'quietNow' => self::quiet($s, $now),
            'capacity' => ['sms' => self::capacity($s, 'sms'), 'whatsapp' => self::capacity($s, 'whatsapp')],
            'whatsappAgent' => ['state' => $waOnline ? $wa['wa_state'] : ($wa['wa_seen'] ? 'offline' : ''), 'lastSeen' => $wa['wa_seen'] === null ? null : (int)$wa['wa_seen'], 'error' => $wa['wa_error']],
            'counts' => $counts, 'outbox' => $outbox];
    }

    public function act(array $actor, object $input, int $now): array
    {
        $action = (string)($input->action ?? '');
        if ($action === 'pair') return $this->pair($actor, $now);
        if ($action === 'revoke') return $this->revoke($actor, $input, $now);
        if ($action === 'settings') return $this->saveSettings($actor, $input, $now);
        self::guard($actor);
        if (!ClinicAccess::allowed($actor, 'clients', true)) throw new RuntimeException('Bu işlem için müşteri yazma yetkisi gerekir.', 403);
        $partner = $actor['partner_id'];
        if ($action === 'test') {
            $channel = $input->channel ?? '';
            if (!in_array($channel, ['sms', 'whatsapp'], true)) throw new RuntimeException('Kanal seçin.', 422);
            if ($channel === 'sms' && !$this->hasDevice($partner)) throw new RuntimeException('Henüz telefon bağlanmadı. Kurulum sekmesinde "Eşleştirme kodu oluştur"a basın ve çıkan komutu telefondaki Termux uygulamasına yapıştırın.', 422);
            if (!$this->route($partner, $channel)) throw new RuntimeException($channel === 'sms' ? 'SMS gönderimi kapalı. Ayarlar sekmesinde "SMS\'leri kliniğin telefonundan gönder" kutusunu işaretleyip Kaydet\'e basın.' : 'WhatsApp kapalı. Ayarlar sekmesinde WhatsApp için "Yarı otomatik" seçip Kaydet\'e basın.', 422);
            $digits = preg_replace('/\D/', '', (string)($input->phone ?? '')) ?? '';
            if (DealerLogin::normalizePhone((string)($input->phone ?? '')) === '') throw new RuntimeException('Telefon numarası geçersiz: başında 0 ile 11 hane (05XX XXX XX XX) olmalı; girilen '.strlen($digits).' hane.', 422);
            $this->enqueue($partner, $channel, (string)($input->phone ?? ''), (string)($input->text ?? ''), 'test', bin2hex(random_bytes(12)), 0, $now, null, (string)($actor['name'] ?? ''));
            return $this->status($actor, $now);
        }
        if ($action === 'remind') {
            // Klinik ekranından (Genel Bakış satır menüsü) hatırlatma: mesaj kliniğin ücretsiz SMS / WhatsApp kuyruğuna alınır.
            // Hangi cihazdan basılırsa basılsın sunucudaki kuyruğa düşer; kanal kapalıysa bekler, açılınca gönderilir.
            $channel = $input->channel ?? '';
            if (!in_array($channel, ['sms', 'whatsapp'], true)) throw new RuntimeException('Kanal seçin.', 422);
            $ref = (string)($input->ref ?? '');
            if (!preg_match('/\A[A-Za-z0-9:_.-]{3,150}\z/', $ref)) throw new RuntimeException('Kayıt geçersiz.', 422);
            $id = $this->enqueue($partner, $channel, (string)($input->phone ?? ''), (string)($input->text ?? ''), 'reminder', 'home:'.$ref.':'.$channel, 1, $now, null, (string)($actor['name'] ?? ''));
            return ['queued' => $id, 'device' => $this->hasDevice($partner), 'channel' => $channel, 'enabled' => (bool)$this->route($partner, $channel)];
        }
        $id = $input->id ?? null;
        if (!is_int($id)) throw new RuntimeException('Kayıt bulunamadı.', 404);
        $q = $this->db->prepare('SELECT * FROM phone_outbox WHERE id=? AND partner_id=?');
        $q->execute([$id, $partner]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Kayıt bulunamadı.', 404);
        if ($action === 'cancel') {
            if ($row['status'] !== 'queued') throw new RuntimeException('Yalnızca bekleyen mesaj iptal edilebilir.', 409);
            $this->finish($row, 'cancelled', 'İptal eden: '.($actor['name'] ?? ''), $now);
        } elseif ($action === 'retry') {
            // Başarısız görünen SMS de aslında çıkmış olabilir (telefon geç onaylar): yeniden gönderim yalnız kullanıcı kontrol ettiğini onaylarsa.
            if (!in_array($row['status'], ['failed', 'expired', 'unknown'], true) || ($row['status'] !== 'expired' && empty($input->checked))) {
                throw new RuntimeException($row['status'] === 'unknown' ? 'Önce alıcıya ulaşıp ulaşmadığını kontrol edip onaylayın.' : 'Bu mesaj yeniden denenemez.', 409);
            }
            $this->db->prepare("UPDATE phone_outbox SET status='queued',device_id='',error='',claimed_at=NULL,done_at=NULL,expires_at=NULL,not_before=0 WHERE id=?")->execute([$id]);
        } elseif ($action === 'opened') {
            // Yarı otomatik WhatsApp: personel "Aç ve gönder" ile WhatsApp'ı açtı.
            if ($row['channel'] !== 'whatsapp' || $row['status'] !== 'queued') throw new RuntimeException('Mesaj artık beklemiyor.', 409);
            $this->finish($row, 'sent', '', $now);
        } else {
            throw new RuntimeException('İşlem geçersiz.', 422);
        }
        return $this->status($actor, $now);
    }
}
