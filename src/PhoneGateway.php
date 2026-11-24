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
    public const DEFAULTS = ['sms' => false, 'simSlot' => '', 'smsPerMinute' => 4, 'smsPerDay' => 200,
        'whatsapp' => 'off', 'waRiskAccepted' => false, 'waPerHour' => 30, 'waPerDay' => 150, 'quietStart' => '21:30', 'quietEnd' => '08:30'];
    private const STALE = 900; // sonuç bildirilmeyen işler 15 dakika sonra "belirsiz" olur, tekrar gönderilmez
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
        return false;
    }

    /** @return array<string,array{sms:bool,whatsapp:string|bool}> telefonla gönderimi açık klinikler */
    public function routesAll(): array
    {
        try { $rows = $this->db->query('SELECT partner_id FROM phone_gateway')->fetchAll(PDO::FETCH_COLUMN); } catch (\PDOException) { return []; }
        $out = [];
        foreach ($rows as $partner) {
            $r = ['sms' => $this->route($partner, 'sms'), 'whatsapp' => $this->route($partner, 'whatsapp')];
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
        $s['simSlot'] = in_array($input->simSlot ?? '', ['', '0', '1'], true) ? $input->simSlot : '';
        $s['smsPerMinute'] = $int($input->smsPerMinute ?? $s['smsPerMinute'], 1, 20, 'Dakikalık SMS sınırı');
        $s['smsPerDay'] = $int($input->smsPerDay ?? $s['smsPerDay'], 1, 2000, 'Günlük SMS sınırı');
        $mode = $input->whatsapp ?? 'off';
        if (!in_array($mode, ['off', 'assist', 'auto'], true)) throw new RuntimeException('WhatsApp modu geçersiz.', 422);
        $s['waRiskAccepted'] = !empty($input->waRiskAccepted);
        if ($mode === 'auto' && !$s['waRiskAccepted']) throw new RuntimeException('Otomatik WhatsApp için risk bilgilendirmesini onaylayın.', 422);
        $s['whatsapp'] = $mode;
        $s['waPerHour'] = $int($input->waPerHour ?? $s['waPerHour'], 1, 60, 'Saatlik WhatsApp sınırı');
        $s['waPerDay'] = $int($input->waPerDay ?? $s['waPerDay'], 1, 400, 'Günlük WhatsApp sınırı');
        foreach (['quietStart', 'quietEnd'] as $k) {
            $v = $input->$k ?? $s[$k];
            if (!is_string($v) || !preg_match('/\A([01][0-9]|2[0-3]):[0-5][0-9]\z/', $v)) throw new RuntimeException('Sessiz saatler SS:DD biçiminde olmalı.', 422);
            $s[$k] = $v;
        }
        $this->db->prepare('INSERT INTO phone_gateway (partner_id,settings,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE settings=VALUES(settings),updated_at=VALUES(updated_at)')
            ->execute([$actor['partner_id'], json_encode($s, JSON_UNESCAPED_UNICODE), $now]);
        if ($s['sms']) $this->channel($actor['partner_id'], 'sms', $now);
        if ($s['whatsapp'] === 'auto') $this->channel($actor['partner_id'], 'whatsapp', $now);
        return $this->status($actor, $now);
    }

    /** Gelen kutusunda telefon kanalı (SMS: Android ajanı, WhatsApp: bilgisayardaki WhatsApp Web). */
    public function channel(string $partner, string $kind, int $now): array
    {
        $provider = $kind === 'sms' ? 'phone' : 'device';
        $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE partner_id=? AND kind=? AND JSON_VALUE(config,'$.provider')=?");
        $q->execute([$partner, $kind, $provider]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            if ($row['status'] === 'removed') $this->db->prepare("UPDATE inbox_channel SET status='active' WHERE id=?")->execute([$row['id']]);
            return $row;
        }
        $id = bin2hex(random_bytes(16));
        $this->db->prepare('INSERT INTO inbox_channel (id,partner_id,kind,label,status,hook_key,external_id,config,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $partner, $kind, $kind === 'sms' ? 'SMS (klinik telefonu)' : 'WhatsApp (klinik numarası)', 'active', bin2hex(random_bytes(20)), $provider,
                json_encode(['provider' => $provider]), $now]);
        $q->execute([$partner, $kind, $provider]);
        return $q->fetch(PDO::FETCH_ASSOC);
    }

    // ───────────────────────────── kuyruk ─────────────────────────────
    /** Mesajı gönderim kuyruğuna ekler; aynı kaynak+referans ikinci kez eklenmez. Kuyruk kimliğini döndürür. */
    public function enqueue(string $partner, string $channel, string $phone, string $body, string $source, string $ref, int $priority, int $now, ?int $expires = null, string $by = ''): int
    {
        $phone = DealerLogin::normalizePhone($phone);
        if ($phone === '') throw new RuntimeException('Telefon numarası geçersiz (Türkiye cep numarası gerekli).', 422);
        $body = trim($body);
        if ($body === '' || mb_strlen($body) > 4000) throw new RuntimeException('Mesaj 1-4000 karakter olmalı.', 422);
        if (!in_array($channel, ['sms', 'whatsapp'], true) || !in_array($source, ['reminder', 'bulk', 'inbox', 'test', 'manual'], true)) throw new RuntimeException('Kuyruk isteği geçersiz.', 422);
        $this->db->prepare('INSERT IGNORE INTO phone_outbox (partner_id,channel,phone,body,source,source_ref,priority,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$partner, $channel, $phone, $body, $source, mb_substr($ref, 0, 190), $priority, $expires, mb_substr($by, 0, 120), $now]);
        $q = $this->db->prepare('SELECT id FROM phone_outbox WHERE source=? AND source_ref=?');
        $q->execute([$source, mb_substr($ref, 0, 190)]);
        return (int)$q->fetchColumn();
    }

    public static function quiet(array $s, int $now): bool
    {
        $local = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('H:i');
        [$a, $b] = [$s['quietStart'], $s['quietEnd']];
        if ($a === $b) return false;
        return $a < $b ? ($local >= $a && $local < $b) : ($local >= $a || $local < $b);
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

    /** Sınırlara ve sessiz saatlere uyan işleri bu cihaza ayırır. */
    private function claim(string $partner, string $channel, string $device, int $limit, bool $quiet, int $now): array
    {
        if ($limit <= 0) return [];
        $q = $this->db->prepare("SELECT * FROM phone_outbox WHERE partner_id=? AND channel=? AND status='queued' AND not_before<=?".($quiet ? ' AND priority=0' : '').' ORDER BY priority,id LIMIT '.(int)$limit);
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
            $q = $this->db->prepare("SELECT * FROM phone_outbox WHERE id=? AND partner_id=? AND channel='whatsapp' AND status='queued'");
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
        $this->sweep($partner, $now);
        $s = $this->settings($partner);
        $jobs = [];
        if ($s['sms']) {
            $limit = min(5, $s['smsPerMinute'] - $this->sentSince($partner, 'sms', $now - 60), $s['smsPerDay'] - $this->sentSince($partner, 'sms', self::dayStart($now)));
            $jobs = $this->claim($partner, 'sms', $device['id'], $limit, self::quiet($s, $now), $now);
        }
        $assist = [];
        if ($s['whatsapp'] === 'assist') {
            $q = $this->db->prepare("SELECT id,phone,body FROM phone_outbox WHERE partner_id=? AND channel='whatsapp' AND status='queued' ORDER BY priority,id LIMIT 10");
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $assist[] = ['id' => (int)$r['id'], 'phone' => $r['phone'], 'link' => self::waLink($r['phone'], $r['body']), 'preview' => mb_substr($r['body'], 0, 80, 'UTF-8')];
        }
        return ['jobs' => $jobs, 'assist' => $assist, 'simSlot' => $s['simSlot'], 'interval' => $jobs ? 5 : 15, 'received' => $inbound, 'mark' => (int)$this->db->query('SELECT inbound_mark FROM phone_device WHERE id='.$this->db->quote($device['id']))->fetchColumn()];
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
        if ($s['whatsapp'] === 'auto' && $state === 'ready') {
            $limit = min(3, $s['waPerHour'] - $this->sentSince($partner, 'whatsapp', $now - 3600), $s['waPerDay'] - $this->sentSince($partner, 'whatsapp', self::dayStart($now)));
            $jobs = $this->claim($partner, 'whatsapp', $device, $limit, self::quiet($s, $now), $now);
        }
        return ['mode' => $s['whatsapp'], 'jobs' => $jobs, 'readInbound' => $s['whatsapp'] === 'auto', 'received' => $received];
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
        $list = $this->db->prepare('SELECT id,channel,phone,body,source,status,error,created_at,done_at,created_by FROM phone_outbox WHERE partner_id=? ORDER BY id DESC LIMIT 80');
        $list->execute([$partner]);
        $outbox = array_map(static fn($r) => ['id' => (int)$r['id'], 'channel' => $r['channel'], 'phone' => $r['phone'], 'body' => $r['body'], 'source' => $r['source'], 'status' => $r['status'],
            'error' => $r['error'], 'at' => (int)$r['created_at'], 'doneAt' => $r['done_at'] === null ? null : (int)$r['done_at'], 'by' => $r['created_by'],
            'link' => $r['channel'] === 'whatsapp' && $r['status'] === 'queued' ? self::waLink($r['phone'], $r['body']) : null], $list->fetchAll(PDO::FETCH_ASSOC));
        $c = $this->db->prepare("SELECT channel,SUM(status='queued') q,SUM(status='sent' AND done_at>=?) s,SUM(status IN ('failed','unknown','expired') AND created_at>=?) f FROM phone_outbox WHERE partner_id=? GROUP BY channel");
        $day = self::dayStart($now);
        $c->execute([$day, $day, $partner]);
        $counts = [];
        foreach ($c->fetchAll(PDO::FETCH_ASSOC) as $r) $counts[$r['channel']] = ['queued' => (int)$r['q'], 'sentToday' => (int)$r['s'], 'failedToday' => (int)$r['f']];
        $s = $this->settings($partner);
        return ['settings' => $s, 'devices' => $devices, 'canManage' => ($actor['role'] ?? '') === 'dealer', 'quietNow' => self::quiet($s, $now),
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
            if (!$this->route($partner, $channel)) throw new RuntimeException($channel === 'sms' ? 'Önce SMS gönderimini açın ve bir Android telefon bağlayın.' : 'Önce WhatsApp modunu seçin.', 422);
            $this->enqueue($partner, $channel, (string)($input->phone ?? ''), (string)($input->text ?? ''), 'test', bin2hex(random_bytes(12)), 0, $now, null, (string)($actor['name'] ?? ''));
            return $this->status($actor, $now);
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
            if (!in_array($row['status'], ['failed', 'expired'], true) && !($row['status'] === 'unknown' && !empty($input->checked))) {
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
