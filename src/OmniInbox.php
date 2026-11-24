<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Çok kanallı gelen kutusu: WhatsApp Business (Cloud API), Facebook Messenger, Instagram, Telegram, SMS, e-posta ve
 * web sitesi formu tek listede. Mesajlar resmi API webhook'larıyla gelir, yanıtlar aynı kanaldan gider.
 * Yanıt yazan personel konuşmayı kendi adıyla üstlenir; başkası yazarsa devraldığı kayda geçer.
 */
final class OmniInbox
{
    public const KINDS = ['whatsapp' => 'WhatsApp', 'messenger' => 'Facebook', 'instagram' => 'Instagram', 'telegram' => 'Telegram', 'sms' => 'SMS', 'email' => 'E-posta', 'web' => 'Web sitesi'];
    private const SECRET_FIELDS = ['accessToken', 'appSecret', 'pageToken', 'botToken', 'password'];
    private const FIELDS = [
        'whatsapp' => ['phoneNumberId' => '/\A[0-9]{5,30}\z/', 'displayPhone' => '/\A[0-9 +()-]{0,24}\z/', 'accessToken' => '/\A[\x21-\x7e]{20,600}\z/', 'appSecret' => '/\A[a-f0-9]{32}\z/', 'apiVersion' => '/\Av[0-9]{2}\.0\z/'],
        'messenger' => ['pageId' => '/\A[0-9]{5,30}\z/', 'pageName' => '/\A.{0,80}\z/u', 'pageToken' => '/\A[\x21-\x7e]{20,600}\z/', 'appSecret' => '/\A[a-f0-9]{32}\z/', 'apiVersion' => '/\Av[0-9]{2}\.0\z/'],
        'instagram' => ['igId' => '/\A[0-9]{5,30}\z/', 'username' => '/\A@?[A-Za-z0-9._]{0,40}\z/', 'pageToken' => '/\A[\x21-\x7e]{20,600}\z/', 'appSecret' => '/\A[a-f0-9]{32}\z/', 'apiVersion' => '/\Av[0-9]{2}\.0\z/'],
        'telegram' => ['botToken' => '/\A[0-9]{5,15}:[A-Za-z0-9_-]{30,60}\z/'],
        'sms' => ['account' => '/\A[1-9][0-9]{9}\z/', 'password' => '/\A.{1,120}\z/u', 'sender' => "/\A[A-Za-z0-9ÇĞİÖŞÜçğıöşü .&'()-]{3,11}\z/u", 'number' => '/\A[0-9 +()-]{0,24}\z/'],
        'email' => ['address' => 'email', 'imapHost' => '/\A[a-z0-9.-]{3,190}\z/i', 'imapPort' => '/\A[0-9]{2,5}\z/', 'smtpHost' => '/\A[a-z0-9.-]{3,190}\z/i', 'smtpPort' => '/\A[0-9]{2,5}\z/', 'username' => '/\A.{1,190}\z/u', 'password' => '/\A.{1,190}\z/u'],
    ];
    private const REQUIRED = [
        'whatsapp' => ['phoneNumberId', 'accessToken', 'appSecret'], 'messenger' => ['pageId', 'pageToken', 'appSecret'],
        'instagram' => ['igId', 'pageToken', 'appSecret'], 'telegram' => ['botToken'], 'sms' => ['account', 'password', 'sender'],
        'email' => ['address', 'smtpHost', 'smtpPort', 'username', 'password'],
    ];

    /** @param array{graph?:string,telegram?:string,netgsm?:string} $endpoints testte sahte sunuculara yönlendirmek için */
    public function __construct(private readonly PDO $db, private readonly string $key, private readonly string $origin = '', private readonly array $endpoints = []) {}

    private function endpoint(string $name): string
    {
        return rtrim($this->endpoints[$name] ?? ['graph' => 'https://graph.facebook.com', 'telegram' => 'https://api.telegram.org', 'netgsm' => 'https://api.netgsm.com.tr'][$name], '/');
    }

    // ───────────────────────────── yetki ─────────────────────────────
    private static function guard(array $actor, bool $write): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'clients', $write)) {
            throw new RuntimeException('Gelen kutusu için müşteri yetkisi gerekir.', 403);
        }
    }

    private static function owner(array $actor): void
    {
        if (($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Kanal bağlantılarını yalnızca klinik yöneticisi düzenleyebilir.', 403);
    }

    private static function name(array $actor): string
    {
        $name = trim((string)($actor['name'] ?? ''));
        return mb_substr($name !== '' ? $name : 'Klinik ekibi', 0, 120, 'UTF-8');
    }

    private function verifyToken(string $hook): string
    {
        return substr(hash_hmac('sha256', 'verify:'.$hook, $this->key), 0, 32);
    }

    private function hookSecret(string $hook): string
    {
        return substr(hash_hmac('sha256', 'hook:'.$hook, $this->key), 0, 40);
    }

    // ───────────────────────────── kanallar ─────────────────────────────
    private function channelRow(string $partner, string $id): array
    {
        $q = $this->db->prepare('SELECT * FROM inbox_channel WHERE partner_id=? AND id=?');
        $q->execute([$partner, $id]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Kanal bulunamadı.', 404);
        return $row;
    }

    private function config(array $row): array
    {
        $config = json_decode((string)$row['config'], true) ?: [];
        foreach (self::SECRET_FIELDS as $field) {
            if (!empty($config[$field])) {
                try { $config[$field] = Totp::decrypt($config[$field], $this->key); } catch (\Throwable) { $config[$field] = ''; }
            }
        }
        return $config;
    }

    private function publicChannel(array $row): array
    {
        $config = json_decode((string)$row['config'], true) ?: [];
        $visible = [];
        foreach ($config as $field => $value) $visible[$field] = in_array($field, self::SECRET_FIELDS, true) ? ($value !== '' ? 'saved' : '') : $value;
        $hook = $this->origin.'/api/inbox/hook/'.$row['hook_key'];
        if (in_array($config['provider'] ?? '', ['phone', 'device'], true)) {
            return ['id' => $row['id'], 'kind' => $row['kind'], 'kindLabel' => self::KINDS[$row['kind']] ?? $row['kind'], 'label' => $row['label'], 'status' => $row['status'],
                'externalId' => '', 'lastError' => $row['last_error'], 'lastEventAt' => $row['last_event_at'] === null ? null : (int)$row['last_event_at'], 'config' => [], 'managed' => 'phone'];
        }
        $out = ['id' => $row['id'], 'kind' => $row['kind'], 'kindLabel' => self::KINDS[$row['kind']] ?? $row['kind'], 'label' => $row['label'], 'status' => $row['status'],
            'externalId' => $row['external_id'], 'lastError' => $row['last_error'], 'lastEventAt' => $row['last_event_at'] === null ? null : (int)$row['last_event_at'], 'config' => $visible];
        if (in_array($row['kind'], ['whatsapp', 'messenger', 'instagram'], true)) { $out['webhookUrl'] = $hook; $out['verifyToken'] = $this->verifyToken($row['hook_key']); }
        if (in_array($row['kind'], ['sms', 'email'], true)) $out['webhookUrl'] = $hook.'?k='.$this->hookSecret($row['hook_key']);
        if ($row['kind'] === 'telegram') $out['webhookUrl'] = $hook;
        return $out;
    }

    public function channels(array $actor): array
    {
        self::guard($actor, false);
        $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE partner_id=? AND kind<>'web' ORDER BY created_at");
        $q->execute([$actor['partner_id']]);
        $rows = array_map(fn($row) => $this->publicChannel($row), $q->fetchAll(PDO::FETCH_ASSOC));
        if (($actor['role'] ?? '') !== 'dealer') foreach ($rows as &$row) { unset($row['config'], $row['verifyToken'], $row['webhookUrl']); }
        return ['channels' => $rows, 'canManage' => ($actor['role'] ?? '') === 'dealer', 'kinds' => self::KINDS];
    }

    public function saveChannel(array $actor, object $input, int $now): array
    {
        self::guard($actor, true); self::owner($actor);
        $kind = $input->kind ?? '';
        if (!isset(self::FIELDS[$kind])) throw new RuntimeException('Kanal türü geçersiz.', 422);
        $id = $input->id ?? '';
        $existing = null;
        if ($id !== '') {
            if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new RuntimeException('Kanal bulunamadı.', 404);
            $existing = $this->channelRow($actor['partner_id'], $id);
            if ($existing['kind'] !== $kind) throw new RuntimeException('Kanal türü değiştirilemez.', 422);
            if (isset((json_decode((string)$existing['config'], true) ?: [])['provider'])) throw new RuntimeException('Bu kanal Telefon Bağlantısı sayfasından yönetilir.', 422);
        }
        $old = $existing ? (json_decode((string)$existing['config'], true) ?: []) : [];
        $raw = is_object($input->config ?? null) ? (array)$input->config : [];
        $config = [];
        foreach (self::FIELDS[$kind] as $field => $rule) {
            $value = $raw[$field] ?? '';
            if (!is_string($value)) throw new RuntimeException('Alan geçersiz: '.$field, 422);
            $value = trim($value);
            if (in_array($field, self::SECRET_FIELDS, true)) {
                if ($value === '' || $value === 'saved') { $config[$field] = $old[$field] ?? ''; continue; }
            }
            if ($field === 'apiVersion' && $value === '') $value = 'v21.0';
            if ($field === 'imapPort' && $value === '') $value = '993';
            if ($field === 'smtpPort' && $value === '') $value = '465';
            if ($value !== '') {
                $valid = $rule === 'email' ? filter_var($value, FILTER_VALIDATE_EMAIL) !== false : preg_match($rule, $value) === 1;
                if (!$valid) throw new RuntimeException(self::fieldLabel($field).' geçersiz.', 422);
            }
            $config[$field] = in_array($field, self::SECRET_FIELDS, true) && $value !== '' ? Totp::encrypt($value, $this->key) : $value;
        }
        foreach (self::REQUIRED[$kind] as $field) if (($config[$field] ?? '') === '') throw new RuntimeException(self::fieldLabel($field).' gerekli.', 422);
        if ($kind === 'email' && ($config['imapHost'] ?? '') !== '' && ($config['imapPort'] ?? '') === '') $config['imapPort'] = '993';
        $external = match ($kind) {
            'whatsapp' => $config['phoneNumberId'], 'messenger' => $config['pageId'], 'instagram' => $config['igId'],
            'telegram' => explode(':', $existing && ($raw['botToken'] ?? '') === '' ? (string)$existing['external_id'].':' : (string)$raw['botToken'])[0],
            'sms' => $config['account'], 'email' => strtolower($config['address']), default => '',
        };
        $label = is_string($input->label ?? null) ? mb_substr(trim($input->label), 0, 80, 'UTF-8') : '';
        if ($label === '') $label = self::KINDS[$kind];
        $json = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if ($existing) {
            $this->db->prepare('UPDATE inbox_channel SET label=?,external_id=?,config=?,status=?,last_error=? WHERE partner_id=? AND id=?')
                ->execute([$label, $external, $json, 'active', '', $actor['partner_id'], $id]);
        } else {
            $count = $this->db->prepare("SELECT COUNT(*) FROM inbox_channel WHERE partner_id=? AND kind<>'web'");
            $count->execute([$actor['partner_id']]);
            if ((int)$count->fetchColumn() >= 20) throw new RuntimeException('En fazla 20 kanal bağlanabilir.', 422);
            $id = bin2hex(random_bytes(16));
            $this->db->prepare('INSERT INTO inbox_channel (id,partner_id,kind,label,status,hook_key,external_id,config,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $actor['partner_id'], $kind, $label, 'active', bin2hex(random_bytes(20)), $external, $json, $now]);
        }
        $row = $this->channelRow($actor['partner_id'], $id);
        if ($kind === 'telegram') $this->telegramWebhook($row);
        return ['channel' => $this->publicChannel($this->channelRow($actor['partner_id'], $id))];
    }

    private static function fieldLabel(string $field): string
    {
        return ['phoneNumberId' => 'Telefon numarası kimliği', 'displayPhone' => 'Görünen numara', 'accessToken' => 'Erişim anahtarı', 'appSecret' => 'Uygulama gizli anahtarı',
            'apiVersion' => 'API sürümü', 'pageId' => 'Sayfa kimliği', 'pageName' => 'Sayfa adı', 'pageToken' => 'Sayfa erişim anahtarı', 'igId' => 'Instagram hesap kimliği',
            'username' => 'Kullanıcı adı', 'botToken' => 'Bot anahtarı', 'account' => 'SMS hesap numarası', 'password' => 'Şifre', 'sender' => 'SMS başlığı',
            'number' => 'Numara', 'address' => 'E-posta adresi', 'imapHost' => 'IMAP sunucusu', 'imapPort' => 'IMAP portu', 'smtpHost' => 'SMTP sunucusu', 'smtpPort' => 'SMTP portu'][$field] ?? $field;
    }

    public function deleteChannel(array $actor, object $input): array
    {
        self::guard($actor, true); self::owner($actor);
        $row = $this->channelRow($actor['partner_id'], (string)($input->id ?? ''));
        if ($row['kind'] === 'telegram') {
            $config = $this->config($row);
            try { $this->http('POST', $this->endpoint('telegram').'/bot'.$config['botToken'].'/deleteWebhook', []); } catch (\Throwable) {}
        }
        // Geçmiş yazışmalar silinmez; kanal pasifleşir ve yeni mesaj alınmaz. Klinik isterse "Konuşmaları da sil" ile siler.
        if (!empty($input->purge)) {
            $this->db->prepare('DELETE m FROM inbox_message m WHERE m.partner_id=? AND m.channel_id=?')->execute([$actor['partner_id'], $row['id']]);
            $this->db->prepare('DELETE FROM inbox_conversation WHERE partner_id=? AND channel_id=?')->execute([$actor['partner_id'], $row['id']]);
            $this->db->prepare('DELETE FROM inbox_channel WHERE partner_id=? AND id=?')->execute([$actor['partner_id'], $row['id']]);
        } else {
            $this->db->prepare("UPDATE inbox_channel SET status='removed',config='{}',hook_key=? WHERE partner_id=? AND id=?")->execute([bin2hex(random_bytes(20)), $actor['partner_id'], $row['id']]);
        }
        return ['ok' => true];
    }

    public function testChannel(array $actor, object $input): array
    {
        self::guard($actor, true); self::owner($actor);
        $row = $this->channelRow($actor['partner_id'], (string)($input->id ?? ''));
        $c = $this->config($row);
        if (isset($c['provider'])) return ['ok' => true, 'message' => 'Bu kanal Telefon Bağlantısı üzerinden çalışır; durumunu o sayfadan izleyin.'];
        try {
            $result = match ($row['kind']) {
                'whatsapp' => $this->http('GET', $this->endpoint('graph').'/'.$c['apiVersion'].'/'.$c['phoneNumberId'].'?fields=display_phone_number,verified_name', null, $c['accessToken']),
                'messenger' => $this->http('GET', $this->endpoint('graph').'/'.$c['apiVersion'].'/'.$c['pageId'].'?fields=name', null, $c['pageToken']),
                'instagram' => $this->http('GET', $this->endpoint('graph').'/'.$c['apiVersion'].'/'.$c['igId'].'?fields=username', null, $c['pageToken']),
                'telegram' => $this->http('GET', $this->endpoint('telegram').'/bot'.$c['botToken'].'/getMe', null),
                'email' => ($c['imapHost'] ?? '') !== '' ? ($this->imapCommand($c, 'EXAMINE INBOX') !== null ? ['name' => 'IMAP gelen kutusu açıldı'] : []) : ['name' => 'IMAP girilmedi, gelen e-postalar yönlendirme adresiyle alınır'],
                default => ['ok' => true],
            };
            $name = $result['verified_name'] ?? $result['name'] ?? $result['username'] ?? ($result['result']['username'] ?? '');
            $this->db->prepare("UPDATE inbox_channel SET last_error='',status='active' WHERE id=?")->execute([$row['id']]);
            return ['ok' => true, 'message' => 'Bağlantı çalışıyor'.($name !== '' ? ': '.$name : '').'.'];
        } catch (RuntimeException $error) {
            $this->db->prepare("UPDATE inbox_channel SET last_error=?,status='error' WHERE id=?")->execute([mb_substr($error->getMessage(), 0, 300, 'UTF-8'), $row['id']]);
            throw new RuntimeException('Bağlantı denemesi başarısız: '.$error->getMessage(), 422);
        }
    }

    private function telegramWebhook(array $row): void
    {
        $c = $this->config($row);
        try {
            $this->http('POST', $this->endpoint('telegram').'/bot'.$c['botToken'].'/setWebhook', ['url' => $this->origin.'/api/inbox/hook/'.$row['hook_key'],
                'secret_token' => $this->hookSecret($row['hook_key']), 'allowed_updates' => ['message', 'edited_message']]);
            $this->db->prepare("UPDATE inbox_channel SET last_error='' WHERE id=?")->execute([$row['id']]);
        } catch (RuntimeException $error) {
            $this->db->prepare("UPDATE inbox_channel SET last_error=?,status='error' WHERE id=?")->execute(['Telegram webhook kurulamadı: '.mb_substr($error->getMessage(), 0, 240, 'UTF-8'), $row['id']]);
        }
    }

    // ───────────────────────────── HTTP ─────────────────────────────
    private function http(string $method, string $url, ?array $body, string $bearer = ''): array
    {
        if (!function_exists('curl_init')) throw new RuntimeException('PHP cURL uzantısı gerekli.', 503);
        $curl = curl_init($url);
        $headers = ['Accept: application/json'];
        if ($bearer !== '') $headers[] = 'Authorization: Bearer '.$bearer;
        $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | (isset($this->endpoints['graph']) || isset($this->endpoints['telegram']) || isset($this->endpoints['netgsm']) ? CURLPROTO_HTTP : 0)];
        if ($method === 'POST') {
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = json_encode($body ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }
        $options[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($curl, $options);
        $raw = curl_exec($curl);
        $code = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        unset($curl);
        if ($raw === false) throw new RuntimeException('Sağlayıcıya ulaşılamadı ('.$error.').', 502);
        $data = json_decode((string)$raw, true);
        if (!is_array($data)) $data = ['raw' => mb_substr((string)$raw, 0, 300, 'UTF-8')];
        if ($code < 200 || $code >= 300 || (isset($data['ok']) && $data['ok'] === false)) {
            $message = $data['error']['message'] ?? $data['description'] ?? $data['raw'] ?? ('HTTP '.$code);
            throw new RuntimeException(mb_substr((string)$message, 0, 240, 'UTF-8'), $code >= 400 && $code < 500 ? 422 : 502);
        }
        return $data;
    }

    // ───────────────────────────── webhook ─────────────────────────────
    /** @return array{0:int,1:string,2:string} durum, içerik türü, gövde */
    public function hook(string $hookKey, string $method, array $query, array $headers, string $raw, int $now): array
    {
        if (!preg_match('/\A[a-f0-9]{40}\z/', $hookKey)) return [404, 'text/plain', 'not found'];
        $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE hook_key=? AND status<>'removed'");
        $q->execute([$hookKey]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) return [404, 'text/plain', 'not found'];
        $kind = $row['kind'];
        $headers = array_change_key_case($headers, CASE_LOWER);
        if (in_array($kind, ['whatsapp', 'messenger', 'instagram'], true)) {
            if ($method === 'GET') {
                $mode = (string)($query['hub_mode'] ?? $query['hub.mode'] ?? '');
                $token = (string)($query['hub_verify_token'] ?? $query['hub.verify_token'] ?? '');
                $challenge = (string)($query['hub_challenge'] ?? $query['hub.challenge'] ?? '');
                if ($mode === 'subscribe' && hash_equals($this->verifyToken($hookKey), $token) && preg_match('/\A[A-Za-z0-9_-]{1,200}\z/', $challenge)) return [200, 'text/plain', $challenge];
                return [403, 'text/plain', 'forbidden'];
            }
            $config = $this->config($row);
            $signature = (string)($headers['x-hub-signature-256'] ?? '');
            if (($config['appSecret'] ?? '') === '' || !hash_equals('sha256='.hash_hmac('sha256', $raw, $config['appSecret']), $signature)) return [403, 'text/plain', 'bad signature'];
            $data = json_decode($raw, true);
            if (!is_array($data)) return [400, 'text/plain', 'bad json'];
            $kind === 'whatsapp' ? $this->metaWhatsapp($row, $data, $now) : $this->metaMessaging($row, $config, $data, $now);
            return [200, 'text/plain', 'EVENT_RECEIVED'];
        }
        if ($method !== 'POST' && $kind !== 'sms') return [405, 'text/plain', 'method'];
        if ($kind === 'telegram') {
            if (!hash_equals($this->hookSecret($hookKey), (string)($headers['x-telegram-bot-api-secret-token'] ?? ''))) return [403, 'text/plain', 'forbidden'];
            $data = json_decode($raw, true);
            if (is_array($data)) $this->telegramUpdate($row, $data, $now);
            return [200, 'application/json', '{"ok":true}'];
        }
        if (!hash_equals($this->hookSecret($hookKey), (string)($query['k'] ?? ''))) return [403, 'text/plain', 'forbidden'];
        $fields = $query;
        $json = json_decode($raw, true);
        if (is_array($json)) $fields = $json + $fields;
        else { parse_str($raw, $form); if (is_array($form)) $fields = $form + $fields; }
        $pick = static function (array $names) use ($fields): string { foreach ($names as $n) if (isset($fields[$n]) && is_scalar($fields[$n]) && trim((string)$fields[$n]) !== '') return trim((string)$fields[$n]); return ''; };
        if ($kind === 'sms') {
            $phone = self::phone($pick(['gsmno', 'gsm', 'phone', 'from', 'sender', 'msisdn', 'numara']));
            $text = $pick(['msg', 'message', 'text', 'mesaj', 'body', 'icerik']);
            if ($phone === '' || $text === '') return [422, 'text/plain', 'missing'];
            $ext = $pick(['id', 'msgid', 'messageid', 'message_id', 'jobid']) ?: 'h'.substr(hash('sha256', $phone.'|'.$text.'|'.intdiv($now, 120)), 0, 30);
            $this->ingest($row, $phone, '', $phone, $text, 'sms:'.$ext, $now);
            return [200, 'text/plain', 'OK'];
        }
        if ($kind === 'email') {
            [$name, $address] = self::mailbox($pick(['from', 'sender', 'From']));
            $text = $pick(['text', 'body-plain', 'stripped-text', 'plain', 'body', 'TextBody']);
            if ($address === '' || $text === '') return [422, 'text/plain', 'missing'];
            $subject = $pick(['subject', 'Subject']);
            $ext = $pick(['message-id', 'Message-Id', 'messageId', 'MessageID']) ?: 'h'.substr(hash('sha256', $address.'|'.$subject.'|'.$text), 0, 30);
            $this->ingest($row, $address, $name, $address, self::cleanMail($text), 'mail:'.mb_substr($ext, 0, 180), $now, $subject);
            return [200, 'text/plain', 'OK'];
        }
        return [404, 'text/plain', 'not found'];
    }

    private function metaWhatsapp(array $row, array $data, int $now): void
    {
        foreach ($data['entry'] ?? [] as $entry) foreach ($entry['changes'] ?? [] as $change) {
            $value = $change['value'] ?? [];
            if (($value['metadata']['phone_number_id'] ?? '') !== $row['external_id']) continue;
            $names = [];
            foreach ($value['contacts'] ?? [] as $contact) $names[(string)($contact['wa_id'] ?? '')] = (string)($contact['profile']['name'] ?? '');
            foreach ($value['messages'] ?? [] as $m) {
                $from = preg_replace('/\D/', '', (string)($m['from'] ?? '')) ?? '';
                if ($from === '') continue;
                $text = self::waText($m);
                $this->ingest($row, '+'.$from, $names[$from] ?? '', '+'.$from, $text, 'wa:'.(string)($m['id'] ?? uniqid()), (int)($m['timestamp'] ?? $now) ?: $now);
            }
            foreach ($value['statuses'] ?? [] as $s) {
                $status = (string)($s['status'] ?? '');
                if (!in_array($status, ['sent', 'delivered', 'read', 'failed'], true)) continue;
                $error = $status === 'failed' ? mb_substr((string)($s['errors'][0]['title'] ?? $s['errors'][0]['message'] ?? 'Gönderilemedi'), 0, 300, 'UTF-8') : '';
                $this->status($row['id'], 'wa:'.(string)($s['id'] ?? ''), $status, $error);
            }
        }
    }

    private static function waText(array $m): string
    {
        $type = (string)($m['type'] ?? 'text');
        $labels = ['image' => 'Fotoğraf', 'video' => 'Video', 'audio' => 'Ses kaydı', 'voice' => 'Sesli mesaj', 'document' => 'Belge', 'sticker' => 'Çıkartma', 'location' => 'Konum', 'contacts' => 'Kişi kartı'];
        return match ($type) {
            'text' => (string)($m['text']['body'] ?? ''),
            'button' => (string)($m['button']['text'] ?? ''),
            'interactive' => (string)($m['interactive']['button_reply']['title'] ?? $m['interactive']['list_reply']['title'] ?? ''),
            'reaction' => 'Tepki: '.(string)($m['reaction']['emoji'] ?? ''),
            'location' => '📍 Konum: '.(string)($m['location']['latitude'] ?? '').', '.(string)($m['location']['longitude'] ?? '').(isset($m['location']['name']) ? ' · '.$m['location']['name'] : ''),
            default => '['.($labels[$type] ?? 'Ek').']'.(isset($m[$type]['caption']) ? ' '.$m[$type]['caption'] : (isset($m[$type]['filename']) ? ' '.$m[$type]['filename'] : '')),
        };
    }

    private function metaMessaging(array $row, array $config, array $data, int $now): void
    {
        $self = $row['external_id'];
        foreach ($data['entry'] ?? [] as $entry) foreach ($entry['messaging'] ?? [] as $event) {
            $sender = (string)($event['sender']['id'] ?? '');
            $recipient = (string)($event['recipient']['id'] ?? '');
            $time = isset($event['timestamp']) ? intdiv((int)$event['timestamp'], 1000) : $now;
            if (isset($event['message'])) {
                $m = $event['message'];
                $text = (string)($m['text'] ?? '');
                foreach ($m['attachments'] ?? [] as $a) $text .= ($text !== '' ? "\n" : '').'['.(['image' => 'Fotoğraf', 'video' => 'Video', 'audio' => 'Ses kaydı', 'file' => 'Belge', 'story_mention' => 'Hikâyede bahsetme', 'share' => 'Paylaşım'][$a['type'] ?? ''] ?? 'Ek').']';
                if ($text === '' && isset($m['reply_to']['story'])) $text = '[Hikâye yanıtı]';
                $mid = 'm:'.(string)($m['mid'] ?? uniqid());
                $echo = !empty($m['is_echo']) || $sender === $self;
                if ($echo) {
                    // Meta Business Suite veya telefondan verilen yanıtlar da geçmişte görünsün.
                    if ($recipient === '') continue;
                    $this->ingestEcho($row, $recipient, $text, $mid, $time);
                } else {
                    if ($sender === '') continue;
                    $this->ingest($row, $sender, '', '', $text, $mid, $time, '', $config);
                }
            } elseif (isset($event['read']) && $sender !== '') {
                $c = $this->db->prepare('SELECT id FROM inbox_conversation WHERE channel_id=? AND contact_key=?');
                $c->execute([$row['id'], $sender]);
                if ($cid = $c->fetchColumn()) $this->db->prepare("UPDATE inbox_message SET status='read' WHERE conversation_id=? AND direction='out' AND status IN ('sent','delivered') AND created_at<=?")->execute([$cid, $time + 5]);
            }
        }
    }

    private function telegramUpdate(array $row, array $data, int $now): void
    {
        $m = $data['message'] ?? $data['edited_message'] ?? null;
        if (!is_array($m) || !isset($m['chat']['id'])) return;
        if (($m['chat']['type'] ?? 'private') !== 'private') return;
        $chat = (string)$m['chat']['id'];
        $name = trim((string)($m['from']['first_name'] ?? '').' '.(string)($m['from']['last_name'] ?? ''));
        $handle = isset($m['from']['username']) ? '@'.$m['from']['username'] : '';
        $text = (string)($m['text'] ?? '');
        if (isset($m['contact']['phone_number'])) $text = 'Telefon paylaştı: '.$m['contact']['phone_number'];
        foreach (['photo' => 'Fotoğraf', 'document' => 'Belge', 'voice' => 'Sesli mesaj', 'video' => 'Video', 'sticker' => 'Çıkartma', 'location' => 'Konum'] as $type => $label) {
            if (isset($m[$type])) $text = '['.$label.']'.(isset($m['caption']) ? ' '.$m['caption'] : '');
        }
        if ($text === '') return;
        if ($text === '/start') $text = 'Sohbeti başlattı.';
        $this->ingest($row, $chat, $name, $handle, $text, 'tg:'.$chat.':'.(int)($m['message_id'] ?? 0).(isset($data['edited_message']) ? ':e'.(int)($m['edit_date'] ?? 0) : ''), (int)($m['date'] ?? $now) ?: $now);
    }

    private function status(string $channel, string $external, string $status, string $error): void
    {
        $rank = "FIELD(status,'queued','sent','delivered','read')";
        $this->db->prepare("UPDATE inbox_message SET status=?,error=? WHERE channel_id=? AND external_id=? AND (? = 'failed' OR $rank < FIELD(?,'queued','sent','delivered','read'))")
            ->execute([$status, $error, $channel, $external, $status, $status]);
    }

    public static function phone(string $value): string
    {
        $digits = preg_replace('/\D/', '', $value) ?? '';
        if ($digits === '') return '';
        if (strlen($digits) === 10 && $digits[0] === '5') return '+90'.$digits;
        if (strlen($digits) === 11 && $digits[0] === '0') return '+90'.substr($digits, 1);
        return '+'.$digits;
    }

    private static function mailbox(string $value): array
    {
        if (preg_match('/\A\s*"?([^"<]*)"?\s*<([^>]+)>\s*\z/u', $value, $m)) return [trim(self::mimeHeader($m[1])), strtolower(trim($m[2]))];
        $value = strtolower(trim($value));
        return ['', filter_var($value, FILTER_VALIDATE_EMAIL) ? $value : ''];
    }

    private static function mimeHeader(string $value): string
    {
        $decoded = function_exists('iconv_mime_decode') ? @iconv_mime_decode($value, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8') : $value;
        return is_string($decoded) ? $decoded : $value;
    }

    /** Alıntılanan eski yazışmaları ve imza ayracından sonrasını atar. */
    public static function cleanMail(string $text): string
    {
        $out = [];
        foreach (preg_split('/\R/u', str_replace("\r", '', $text)) ?: [] as $line) {
            if (preg_match('/\A(On .+ wrote:|.+ tarihinde .+ yazdı:|-----Original Message-----|-----Özgün İleti-----|________________)/u', trim($line))) break;
            if ($line === '-- ') break;
            if (str_starts_with(ltrim($line), '>')) continue;
            $out[] = rtrim($line);
        }
        return mb_substr(trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $out)) ?? ''), 0, 8000, 'UTF-8');
    }

    // ───────────────────────────── kayıt ─────────────────────────────
    public function ingest(array $channel, string $contact, string $name, string $handle, string $text, string $external, int $time, string $subject = '', array $config = []): ?int
    {
        $text = mb_substr(trim($text), 0, 8000, 'UTF-8');
        if ($text === '' || $contact === '') return null;
        $contact = mb_substr($contact, 0, 190, 'UTF-8');
        $time = min($time, time() + 60);
        $dup = $this->db->prepare('SELECT 1 FROM inbox_message WHERE channel_id=? AND external_id=?');
        $dup->execute([$channel['id'], $external]);
        if ($dup->fetchColumn()) return null;
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare('SELECT id,contact_name,client_id FROM inbox_conversation WHERE channel_id=? AND contact_key=? FOR UPDATE');
            $q->execute([$channel['id'], $contact]);
            $conv = $q->fetch(PDO::FETCH_ASSOC);
            $preview = mb_substr(preg_replace('/\s+/u', ' ', $text) ?? $text, 0, 200, 'UTF-8');
            if (!$conv) {
                if ($name === '' && in_array($channel['kind'], ['messenger', 'instagram'], true) && $config) $name = $this->metaProfile($channel['kind'], $config, $contact);
                $client = $this->matchClient($channel['partner_id'], $channel['kind'], $contact, $handle);
                $this->db->prepare('INSERT INTO inbox_conversation (partner_id,channel_id,contact_key,contact_name,contact_handle,client_id,status,last_message_at,last_inbound_at,last_preview,last_direction,unread,subject,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$channel['partner_id'], $channel['id'], $contact, mb_substr($name, 0, 120, 'UTF-8'), mb_substr($handle, 0, 190, 'UTF-8'), $client, 'open', $time, $time, $preview, 'in', 1, mb_substr($subject, 0, 200, 'UTF-8'), $time]);
                $id = (int)$this->db->lastInsertId();
                if ($client !== '') $this->event($id, $channel, 'Otomatik müşteri eşleşmesi: '.$this->clientName($channel['partner_id'], $client), $time);
            } else {
                $id = (int)$conv['id'];
                $this->db->prepare("UPDATE inbox_conversation SET status=IF(status='closed' OR (status='snoozed'),'open',status),snooze_until=NULL,last_message_at=GREATEST(last_message_at,?),last_inbound_at=GREATEST(COALESCE(last_inbound_at,0),?),last_preview=?,last_direction='in',unread=unread+1,
                    contact_name=IF(contact_name='',?,contact_name),contact_handle=IF(contact_handle='',?,contact_handle),subject=IF(?<>'',?,subject) WHERE id=?")
                    ->execute([$time, $time, $preview, mb_substr($name, 0, 120, 'UTF-8'), mb_substr($handle, 0, 190, 'UTF-8'), $subject, mb_substr($subject, 0, 200, 'UTF-8'), $id]);
            }
            $this->db->prepare('INSERT INTO inbox_message (conversation_id,partner_id,channel_id,direction,body,external_id,author_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $channel['partner_id'], $channel['id'], 'in', $text, $external, mb_substr($name, 0, 120, 'UTF-8'), 'received', $time]);
            $this->db->prepare('UPDATE inbox_channel SET last_event_at=? WHERE id=?')->execute([time(), $channel['id']]);
            $this->db->commit();
            return $id;
        } catch (\PDOException $error) {
            $this->db->rollBack();
            if ($error->getCode() === '23000') return null; // eşzamanlı aynı mesaj
            throw $error;
        }
    }

    private function ingestEcho(array $channel, string $contact, string $text, string $external, int $time): void
    {
        if ($text === '') return;
        $dup = $this->db->prepare('SELECT 1 FROM inbox_message WHERE channel_id=? AND external_id=?');
        $dup->execute([$channel['id'], $external]);
        if ($dup->fetchColumn()) return;
        $q = $this->db->prepare('SELECT id FROM inbox_conversation WHERE channel_id=? AND contact_key=?');
        $q->execute([$channel['id'], $contact]);
        $id = $q->fetchColumn();
        if (!$id) return;
        $this->db->prepare('INSERT IGNORE INTO inbox_message (conversation_id,partner_id,channel_id,direction,body,external_id,author_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $channel['partner_id'], $channel['id'], 'out', mb_substr($text, 0, 8000, 'UTF-8'), $external, 'Meta Business Suite', 'sent', $time]);
        $this->db->prepare("UPDATE inbox_conversation SET last_message_at=GREATEST(last_message_at,?),last_preview=?,last_direction='out' WHERE id=?")->execute([$time, mb_substr($text, 0, 200, 'UTF-8'), $id]);
    }

    private function metaProfile(string $kind, array $config, string $id): string
    {
        if (!preg_match('/\A[0-9]{5,30}\z/', $id) || empty($config['pageToken'])) return '';
        try {
            $data = $this->http('GET', $this->endpoint('graph').'/'.($config['apiVersion'] ?? 'v21.0').'/'.$id.'?fields='.($kind === 'instagram' ? 'name,username' : 'first_name,last_name'), null, $config['pageToken']);
            return trim((string)($data['name'] ?? (($data['first_name'] ?? '').' '.($data['last_name'] ?? ''))) ?: (isset($data['username']) ? '@'.$data['username'] : ''));
        } catch (\Throwable) { return ''; }
    }

    private function event(int $conversation, array $channel, string $text, int $time): void
    {
        $this->db->prepare('INSERT INTO inbox_message (conversation_id,partner_id,channel_id,direction,body,status,created_at) VALUES (?,?,?,?,?,?,?)')
            ->execute([$conversation, $channel['partner_id'], $channel['id'], 'event', $text, '', $time]);
    }

    private function setId(string $partner): ?int
    {
        $q = $this->db->prepare('SELECT id FROM clinic_record_set WHERE workspace_id=?');
        $q->execute(['partner:'.$partner]);
        $id = $q->fetchColumn();
        return $id === false ? null : (int)$id;
    }

    /** Telefonun son 10 hanesi veya e-posta ile müşteri kartı arar; birden fazla eşleşmede bağlamaz. */
    public function matchClient(string $partner, string $kind, string $contact, string $handle): string
    {
        $set = $this->setId($partner);
        if ($set === null) return '';
        $email = filter_var($contact, FILTER_VALIDATE_EMAIL) ? strtolower($contact) : '';
        $digits = substr(preg_replace('/\D/', '', $contact) ?? '', -10);
        if ($email === '' && (strlen($digits) !== 10 || !in_array($kind, ['whatsapp', 'sms', 'web'], true))) return '';
        if ($email !== '') {
            $q = $this->db->prepare("SELECT record_data FROM clinic_record WHERE set_id=? AND collection='clients' AND record_data LIKE ? LIMIT 20");
            $q->execute([$set, '%'.str_replace(['%', '_'], ['\\%', '\\_'], $email).'%']);
        } else {
            // Kayıtlarda numara "0532 111 22 33" gibi biçimli olabilir: rakamlara indirgenip son 10 hane karşılaştırılır.
            $q = $this->db->prepare("SELECT record_data FROM clinic_record WHERE set_id=? AND collection='clients'
                AND (RIGHT(REGEXP_REPLACE(JSON_VALUE(record_data,'$.phone'),'[^0-9]',''),10)=? OR RIGHT(REGEXP_REPLACE(JSON_VALUE(record_data,'$.phone2'),'[^0-9]',''),10)=?) LIMIT 20");
            $q->execute([$set, $digits, $digits]);
        }
        $found = [];
        while (($json = $q->fetchColumn()) !== false) {
            $c = json_decode((string)$json, true);
            if (!is_array($c) || empty($c['id'])) continue;
            $ok = $email !== '' ? strtolower((string)($c['email'] ?? '')) === $email
                : in_array($digits, [substr(preg_replace('/\D/', '', (string)($c['phone'] ?? '')) ?? '', -10), substr(preg_replace('/\D/', '', (string)($c['phone2'] ?? '')) ?? '', -10)], true);
            if ($ok) $found[$c['id']] = true;
        }
        return count($found) === 1 ? (string)array_key_first($found) : '';
    }

    private function clientName(string $partner, string $client): string
    {
        $state = (new ClinicRecords($this->db))->slice('partner:'.$partner, ['clients' => [$client]]);
        return (string)($state->clients[0]->name ?? 'müşteri kartı');
    }

    // ───────────────────────────── klinik API ─────────────────────────────
    private function wake(string $partner, int $now): void
    {
        $this->db->prepare("UPDATE inbox_conversation SET status='open',snooze_until=NULL WHERE partner_id=? AND status='snoozed' AND snooze_until<=?")->execute([$partner, $now]);
    }

    public function cursor(array $actor): int
    {
        self::guard($actor, false);
        $q = $this->db->prepare('SELECT COALESCE(MAX(id),0) FROM inbox_message WHERE partner_id=?');
        $q->execute([$actor['partner_id']]);
        $u = $this->db->prepare('SELECT COALESCE(SUM(unread),0) FROM inbox_conversation WHERE partner_id=? AND status=\'open\'');
        $u->execute([$actor['partner_id']]);
        return (int)$q->fetchColumn() * 1000 + min(999, (int)$u->fetchColumn());
    }

    public function list(array $actor, array $filter, int $now): array
    {
        self::guard($actor, false);
        $partner = $actor['partner_id'];
        $this->wake($partner, $now);
        $me = (string)($actor['membership_id'] ?? '');
        $where = ['c.partner_id=?'];
        $params = [$partner];
        $box = (string)($filter['box'] ?? 'open');
        match ($box) {
            'mine' => [$where[] = "c.status='open' AND c.assignee_id=?", $params[] = $me],
            'unassigned' => $where[] = "c.status='open' AND c.assignee_id=''",
            'snoozed' => $where[] = "c.status='snoozed'",
            'closed' => $where[] = "c.status='closed'",
            'all' => null,
            default => $where[] = "c.status='open'",
        };
        $kind = (string)($filter['channel'] ?? '');
        if (isset(self::KINDS[$kind])) { $where[] = 'ch.kind=?'; $params[] = $kind; }
        $search = trim((string)($filter['q'] ?? ''));
        if ($search !== '') {
            $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_substr($search, 0, 80, 'UTF-8')).'%';
            $where[] = "(c.contact_name LIKE ? ESCAPE '!' OR c.contact_handle LIKE ? ESCAPE '!' OR c.contact_key LIKE ? ESCAPE '!' OR c.last_preview LIKE ? ESCAPE '!' OR c.subject LIKE ? ESCAPE '!')";
            array_push($params, $like, $like, $like, $like, $like);
        }
        $before = (int)($filter['before'] ?? 0);
        if ($before > 0) { $where[] = 'c.last_message_at<?'; $params[] = $before; }
        $sql = 'SELECT c.*,ch.kind,ch.label AS channel_label,ch.external_id AS channel_external FROM inbox_conversation c JOIN inbox_channel ch ON ch.id=c.channel_id WHERE '.implode(' AND ', $where).' ORDER BY c.last_message_at DESC,c.id DESC LIMIT 60';
        $q = $this->db->prepare($sql);
        $q->execute($params);
        $items = array_map(fn($r) => $this->conversationOut($r, $now), $q->fetchAll(PDO::FETCH_ASSOC));
        $counts = $this->db->prepare("SELECT
            SUM(c.status='open') AS open, SUM(c.status='open' AND c.assignee_id=?) AS mine, SUM(c.status='open' AND c.assignee_id='') AS unassigned,
            SUM(c.status='snoozed') AS snoozed, SUM(c.status='closed') AS closed, COUNT(*) AS total, SUM(IF(c.status='open',c.unread,0)) AS unread
            FROM inbox_conversation c WHERE c.partner_id=?");
        $counts->execute([$me, $partner]);
        $boxes = array_map('intval', $counts->fetch(PDO::FETCH_ASSOC) ?: []);
        $per = $this->db->prepare("SELECT ch.kind,COUNT(*) FROM inbox_conversation c JOIN inbox_channel ch ON ch.id=c.channel_id WHERE c.partner_id=? AND c.status='open' GROUP BY ch.kind");
        $per->execute([$partner]);
        return ['items' => $items, 'boxes' => $boxes, 'channels' => array_map('intval', $per->fetchAll(PDO::FETCH_KEY_PAIR)), 'cursor' => $this->cursor($actor), 'me' => $me];
    }

    private function conversationOut(array $r, int $now): array
    {
        $window = null;
        if (in_array($r['kind'], ['whatsapp', 'messenger', 'instagram'], true) && !in_array($r['channel_external'] ?? '', ['phone', 'device'], true)) $window = $r['last_inbound_at'] === null ? 0 : max(0, (int)$r['last_inbound_at'] + 86400 - $now);
        return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'channel' => $r['channel_label'], 'name' => $r['contact_name'], 'handle' => $r['contact_handle'] ?: $r['contact_key'],
            'client' => $r['client_id'], 'status' => $r['status'], 'snoozeUntil' => $r['snooze_until'] === null ? null : (int)$r['snooze_until'],
            'assignee' => $r['assignee_id'], 'assigneeName' => $r['assignee_name'], 'lastAt' => (int)$r['last_message_at'], 'preview' => $r['last_preview'],
            'direction' => $r['last_direction'], 'unread' => (int)$r['unread'], 'subject' => $r['subject'], 'tags' => array_values(array_filter(explode(',', (string)$r['tags']))),
            'window' => $window];
    }

    private function conversation(string $partner, int $id, bool $lock = false): array
    {
        $q = $this->db->prepare('SELECT c.*,ch.kind,ch.label AS channel_label,ch.external_id AS channel_external FROM inbox_conversation c JOIN inbox_channel ch ON ch.id=c.channel_id WHERE c.partner_id=? AND c.id=?'.($lock ? ' FOR UPDATE' : ''));
        $q->execute([$partner, $id]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Konuşma bulunamadı.', 404);
        return $row;
    }

    public function thread(array $actor, int $id, int $now): array
    {
        self::guard($actor, false);
        $row = $this->conversation($actor['partner_id'], $id);
        $q = $this->db->prepare('SELECT id,direction,body,author_name,author_id,status,error,created_at FROM inbox_message WHERE conversation_id=? ORDER BY id DESC LIMIT 300');
        $q->execute([$id]);
        $messages = array_reverse(array_map(static fn($m) => ['id' => (int)$m['id'], 'direction' => $m['direction'], 'body' => $m['body'], 'author' => $m['author_name'],
            'authorId' => $m['author_id'], 'status' => $m['status'], 'error' => $m['error'], 'at' => (int)$m['created_at']], $q->fetchAll(PDO::FETCH_ASSOC)));
        if ((int)$row['unread'] > 0 && ClinicAccess::allowed($actor, 'clients', true)) $this->db->prepare('UPDATE inbox_conversation SET unread=0 WHERE id=?')->execute([$id]);
        $row['unread'] = 0;
        return ['conversation' => $this->conversationOut($row, $now), 'messages' => $messages, 'card' => $this->card($actor['partner_id'], (string)$row['client_id']),
            'history' => $this->contactHistory($actor['partner_id'], $row)];
    }

    /** Aynı müşterinin diğer kanallardaki konuşmaları (müşteri kartına bağlıysa). */
    private function contactHistory(string $partner, array $row): array
    {
        if ($row['client_id'] === '') return [];
        $q = $this->db->prepare('SELECT c.id,ch.kind,c.last_message_at,c.status FROM inbox_conversation c JOIN inbox_channel ch ON ch.id=c.channel_id WHERE c.partner_id=? AND c.client_id=? AND c.id<>? ORDER BY c.last_message_at DESC LIMIT 10');
        $q->execute([$partner, $row['client_id'], $row['id']]);
        return array_map(static fn($r) => ['id' => (int)$r['id'], 'kind' => $r['kind'], 'lastAt' => (int)$r['last_message_at'], 'status' => $r['status']], $q->fetchAll(PDO::FETCH_ASSOC));
    }

    private function card(string $partner, string $client): ?array
    {
        if ($client === '') return null;
        $state = (new ClinicRecords($this->db))->slice('partner:'.$partner, ['clients' => [$client]]);
        $c = $state->clients[0] ?? null;
        if (!$c) return null;
        $pets = [];
        $set = $this->setId($partner);
        if ($set !== null) {
            $q = $this->db->prepare("SELECT record_data FROM clinic_record WHERE set_id=? AND collection='patients' AND owner_id=? LIMIT 12");
            $q->execute([$set, $client]);
            while (($json = $q->fetchColumn()) !== false) {
                $p = json_decode((string)$json, true);
                if (is_array($p)) $pets[] = ['id' => (string)($p['id'] ?? ''), 'name' => (string)($p['name'] ?? ''), 'species' => (string)($p['species'] ?? ''), 'breed' => (string)($p['breed'] ?? ''),
                    'birth' => (string)($p['birth'] ?? ''), 'weight' => (string)($p['weight'] ?? ''), 'chip' => (string)($p['chip'] ?? ''), 'warning' => (string)($p['warning'] ?? '')];
            }
        }
        return ['id' => $client, 'name' => (string)($c->name ?? ''), 'phone' => (string)($c->phone ?? ''), 'email' => (string)($c->email ?? ''), 'address' => trim((string)($c->district ?? '').' '.(string)($c->city ?? '')),
            'warning' => (string)($c->warning ?? ''), 'group' => (string)($c->group ?? ''), 'permissions' => ['sms' => (string)($c->sms ?? ''), 'whatsapp' => (string)($c->whatsapp ?? ''), 'email' => (string)($c->emailPermission ?? '')], 'pets' => $pets];
    }

    public function team(array $actor): array
    {
        self::guard($actor, false);
        $q = $this->db->prepare("SELECT id,name,role FROM identity_membership WHERE partner_id=? AND role IN ('dealer','branch','staff') AND status='active' ORDER BY name LIMIT 200");
        $q->execute([$actor['partner_id']]);
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        return ['team' => array_map(static fn($r) => ['id' => (string)$r['id'], 'name' => (string)($r['name'] ?: 'Ekip üyesi')], $rows)];
    }

    public function settings(string $partner): array
    {
        $q = $this->db->prepare('SELECT data FROM inbox_setting WHERE partner_id=?');
        $q->execute([$partner]);
        $data = json_decode((string)$q->fetchColumn(), true) ?: [];
        return ['signature' => (bool)($data['signature'] ?? false), 'autoReply' => (string)($data['autoReply'] ?? ''), 'autoReplyEnabled' => (bool)($data['autoReplyEnabled'] ?? false)];
    }

    /** İşlem: reply, note, assign, status, link, read, tag, settings, quick-save, quick-delete */
    public function act(array $actor, object $input, int $now): array
    {
        $action = (string)($input->action ?? '');
        self::guard($actor, true);
        $partner = $actor['partner_id'];
        if ($action === 'settings') {
            self::owner($actor);
            $auto = is_string($input->autoReply ?? null) ? mb_substr(trim($input->autoReply), 0, 600, 'UTF-8') : '';
            $data = ['signature' => !empty($input->signature), 'autoReply' => $auto, 'autoReplyEnabled' => !empty($input->autoReplyEnabled) && $auto !== ''];
            $this->db->prepare('INSERT INTO inbox_setting (partner_id,data,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)')
                ->execute([$partner, json_encode($data, JSON_UNESCAPED_UNICODE), $now]);
            return ['settings' => $this->settings($partner)];
        }
        if ($action === 'quick-save') {
            $shortcut = is_string($input->shortcut ?? null) ? trim($input->shortcut) : '';
            $body = is_string($input->body ?? null) ? trim($input->body) : '';
            if (!preg_match('/\A[\p{L}0-9_-]{1,40}\z/u', $shortcut) || $body === '' || mb_strlen($body) > 1000) throw new RuntimeException('Kısayol (harf, rakam) ve en fazla 1000 karakterlik metin girin.', 422);
            $this->db->prepare('INSERT INTO inbox_quick_reply (partner_id,shortcut,body,created_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body)')->execute([$partner, $shortcut, $body, $now]);
            return $this->quick($actor);
        }
        if ($action === 'quick-delete') {
            $this->db->prepare('DELETE FROM inbox_quick_reply WHERE partner_id=? AND id=?')->execute([$partner, (int)($input->id ?? 0)]);
            return $this->quick($actor);
        }
        $id = $input->id ?? null;
        if (!is_int($id) || $id < 1) throw new RuntimeException('Konuşma bulunamadı.', 404);
        $me = (string)($actor['membership_id'] ?? '');
        $name = self::name($actor);
        if ($action === 'reply') return $this->reply($actor, $id, $input, $now);
        $this->db->beginTransaction();
        try {
            $row = $this->conversation($partner, $id, true);
            $channel = ['id' => $row['channel_id'], 'partner_id' => $partner, 'kind' => $row['kind']];
            switch ($action) {
                case 'note':
                    $text = is_string($input->text ?? null) ? trim($input->text) : '';
                    if ($text === '' || mb_strlen($text) > 4000) throw new RuntimeException('Not 1-4000 karakter olmalı.', 422);
                    $this->db->prepare('INSERT INTO inbox_message (conversation_id,partner_id,channel_id,direction,body,author_id,author_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
                        ->execute([$id, $partner, $row['channel_id'], 'note', $text, $me, $name, '', $now]);
                    break;
                case 'assign':
                    $to = (string)($input->to ?? '');
                    $toName = '';
                    if ($to === 'me') { $to = $me; $toName = $name; }
                    elseif ($to !== '') {
                        $team = array_column($this->team($actor)['team'], 'name', 'id');
                        if (!isset($team[$to])) throw new RuntimeException('Ekip üyesi bulunamadı.', 404);
                        $toName = $team[$to];
                    }
                    if ($to === $row['assignee_id']) break;
                    $this->db->prepare('UPDATE inbox_conversation SET assignee_id=?,assignee_name=?,assigned_at=? WHERE id=?')->execute([$to, $toName, $to === '' ? null : $now, $id]);
                    $text = $to === '' ? $name.' konuşmayı atamadan çıkardı.' : ($to === $me ? $name.' konuşmayı üstlendi.' : $name.' konuşmayı '.$toName.' kişisine atadı.');
                    $this->event($id, $channel, $text, $now);
                    break;
                case 'status':
                    $status = (string)($input->status ?? '');
                    if (!in_array($status, ['open', 'closed', 'snoozed'], true)) throw new RuntimeException('Durum geçersiz.', 422);
                    $until = null;
                    if ($status === 'snoozed') {
                        $until = (int)($input->until ?? 0);
                        if ($until <= $now || $until > $now + 60 * 86400) throw new RuntimeException('Erteleme zamanı geçersiz.', 422);
                    }
                    $this->db->prepare('UPDATE inbox_conversation SET status=?,snooze_until=?,unread=IF(?=\'closed\',0,unread) WHERE id=?')->execute([$status, $until, $status, $id]);
                    $this->event($id, $channel, match ($status) { 'closed' => $name.' konuşmayı çözüldü olarak işaretledi.', 'open' => $name.' konuşmayı yeniden açtı.',
                        default => $name.' konuşmayı '.date('d.m.Y H:i', $until + 3 * 3600).' tarihine erteledi.' }, $now);
                    break;
                case 'link':
                    $client = (string)($input->client ?? '');
                    if ($client !== '') {
                        if (!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $client)) throw new RuntimeException('Müşteri bilgisi geçersiz.', 422);
                        $state = (new ClinicRecords($this->db))->slice('partner:'.$partner, ['clients' => [$client]]);
                        if (!$state || !$state->clients) throw new RuntimeException('Müşteri bulunamadı.', 404);
                    }
                    $this->db->prepare('UPDATE inbox_conversation SET client_id=? WHERE id=?')->execute([$client, $id]);
                    $this->event($id, $channel, $client === '' ? $name.' müşteri bağlantısını kaldırdı.' : $name.' konuşmayı '.($state->clients[0]->name ?? 'müşteri').' kartına bağladı.', $now);
                    break;
                case 'tag':
                    $tags = is_array($input->tags ?? null) ? $input->tags : [];
                    $clean = [];
                    foreach (array_slice($tags, 0, 8) as $t) if (is_string($t) && preg_match('/\A[\p{L}0-9 _-]{1,24}\z/u', trim($t))) $clean[] = mb_strtolower(trim($t), 'UTF-8');
                    $this->db->prepare('UPDATE inbox_conversation SET tags=? WHERE id=?')->execute([implode(',', array_unique($clean)), $id]);
                    break;
                case 'read':
                    $this->db->prepare('UPDATE inbox_conversation SET unread=0 WHERE id=?')->execute([$id]);
                    break;
                default:
                    throw new RuntimeException('İşlem geçersiz.', 422);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
        return $this->thread($actor, $id, $now);
    }

    public function quick(array $actor): array
    {
        self::guard($actor, false);
        $q = $this->db->prepare('SELECT id,shortcut,body FROM inbox_quick_reply WHERE partner_id=? ORDER BY shortcut LIMIT 200');
        $q->execute([$actor['partner_id']]);
        return ['quick' => array_map(static fn($r) => ['id' => (int)$r['id'], 'shortcut' => $r['shortcut'], 'body' => $r['body']], $q->fetchAll(PDO::FETCH_ASSOC))];
    }

    private function reply(array $actor, int $id, object $input, int $now): array
    {
        $partner = $actor['partner_id'];
        $me = (string)($actor['membership_id'] ?? '');
        $name = self::name($actor);
        $text = is_string($input->text ?? null) ? trim(str_replace("\r\n", "\n", $input->text)) : '';
        $template = is_object($input->template ?? null) ? $input->template : null;
        if (($text === '' && !$template) || mb_strlen($text) > 4000) throw new RuntimeException('Mesaj 1-4000 karakter olmalı.', 422);
        $row = $this->conversation($partner, $id);
        $channelRow = $this->channelRow($partner, $row['channel_id']);
        if ($channelRow['status'] === 'removed') throw new RuntimeException('Bu kanalın bağlantısı kaldırılmış; yanıt gönderilemez.', 422);
        $config = $channelRow['kind'] === 'web' ? [] : $this->config($channelRow);
        $settings = $this->settings($partner);
        $outgoing = $text;
        if ($settings['signature'] && $text !== '') $outgoing .= "\n— ".$name;
        // Konuşmayı devralma: yanıt yazan kişi atanır; başkasına atanmışsa devraldığı kayda geçer.
        if ($row['assignee_id'] !== $me) {
            $this->db->prepare('UPDATE inbox_conversation SET assignee_id=?,assignee_name=?,assigned_at=? WHERE id=?')->execute([$me, $name, $now, $id]);
            $this->event($id, ['id' => $row['channel_id'], 'partner_id' => $partner], $row['assignee_id'] === '' ? $name.' konuşmayı üstlendi.' : $name.' konuşmayı '.($row['assignee_name'] ?: 'diğer ekip üyesinden').' devraldı.', $now);
        }
        $this->db->prepare('INSERT INTO inbox_message (conversation_id,partner_id,channel_id,direction,body,author_id,author_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $partner, $row['channel_id'], 'out', $template ? ($text !== '' ? $text : 'Şablon: '.(string)($template->name ?? '')) : $outgoing, $me, $name, 'queued', $now]);
        $messageId = (int)$this->db->lastInsertId();
        $status = 'sent'; $error = ''; $external = null;
        try {
            $external = $this->deliver($channelRow, $config, $row, $outgoing, $template, $now, $messageId, $name);
        } catch (RuntimeException $failure) {
            $status = 'failed';
            $error = mb_substr($failure->getMessage(), 0, 300, 'UTF-8');
        }
        if ($status === 'sent' && is_string($external) && str_starts_with($external, 'gw:')) $status = 'queued';
        $this->db->prepare('UPDATE inbox_message SET status=?,error=?,external_id=? WHERE id=?')->execute([$status, $error, $external, $messageId]);
        $this->db->prepare("UPDATE inbox_conversation SET last_message_at=?,last_preview=?,last_direction='out',unread=0,status=IF(status='closed','open',status) WHERE id=?")
            ->execute([$now, mb_substr(preg_replace('/\s+/u', ' ', $text) ?? $text, 0, 200, 'UTF-8'), $id]);
        $result = $this->thread($actor, $id, $now);
        if ($status === 'failed') $result['warning'] = 'Mesaj kaydedildi ancak gönderilemedi: '.$error;
        return $result;
    }

    /** Kanala göre gönderir; sağlayıcının mesaj kimliğini döndürür. */
    private function deliver(array $channel, array $c, array $conv, string $text, ?object $template, int $now, int $messageId = 0, string $by = ''): ?string
    {
        $kind = $channel['kind'];
        $to = (string)$conv['contact_key'];
        if (in_array($c['provider'] ?? '', ['phone', 'device'], true)) {
            // Telefon Bağlantısı: mesaj kliniğin kendi hattından (SMS) veya WhatsApp numarasından gider; 24 saat kuralı yoktur.
            $gateway = new PhoneGateway($this->db);
            if (!$gateway->route($conv['partner_id'], $kind)) throw new RuntimeException($kind === 'sms' ? 'Telefon Bağlantısı sayfasında SMS gönderimi kapalı veya bağlı telefon yok.' : 'Telefon Bağlantısı sayfasında WhatsApp modu kapalı.', 422);
            if ($template) throw new RuntimeException('Bu kanalda şablon gerekmez; mesajı doğrudan yazın.', 422);
            return 'gw:'.$gateway->enqueue($conv['partner_id'], $kind, $to, $text, 'inbox', 'm'.$messageId, 0, $now, null, $by);
        }
        if (in_array($kind, ['whatsapp', 'messenger', 'instagram'], true) && !$template) {
            $last = (int)($conv['last_inbound_at'] ?? 0);
            if ($last === 0 || $now - $last > 86400) {
                throw new RuntimeException($kind === 'whatsapp' ? 'Müşterinin son mesajından bu yana 24 saat geçti. WhatsApp kuralları gereği yalnızca onaylı şablon mesaj gönderilebilir.'
                    : 'Müşterinin son mesajından bu yana 24 saat geçti. Meta kuralları gereği bu kanaldan yeni mesaj gönderilemez; müşterinin yazmasını bekleyin veya başka kanal kullanın.');
            }
        }
        switch ($kind) {
            case 'whatsapp':
                $body = ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => ltrim($to, '+')];
                if ($template) {
                    $tname = (string)($template->name ?? '');
                    $lang = (string)($template->language ?? 'tr');
                    if (!preg_match('/\A[a-z0-9_]{1,128}\z/', $tname) || !preg_match('/\A[a-z]{2,3}(?:_[A-Z]{2})?\z/', $lang)) throw new RuntimeException('Şablon adı veya dili geçersiz.', 422);
                    $params = [];
                    foreach (is_array($template->params ?? null) ? array_slice($template->params, 0, 10) : [] as $p) if (is_string($p) && trim($p) !== '') $params[] = ['type' => 'text', 'text' => mb_substr(trim($p), 0, 500, 'UTF-8')];
                    $body += ['type' => 'template', 'template' => ['name' => $tname, 'language' => ['code' => $lang]] + ($params ? ['components' => [['type' => 'body', 'parameters' => $params]]] : [])];
                } else {
                    $body += ['type' => 'text', 'text' => ['preview_url' => false, 'body' => $text]];
                }
                $r = $this->http('POST', $this->endpoint('graph').'/'.$c['apiVersion'].'/'.$c['phoneNumberId'].'/messages', $body, $c['accessToken']);
                return isset($r['messages'][0]['id']) ? 'wa:'.$r['messages'][0]['id'] : null;
            case 'messenger':
            case 'instagram':
                $r = $this->http('POST', $this->endpoint('graph').'/'.$c['apiVersion'].'/me/messages', ['recipient' => ['id' => $to], 'messaging_type' => 'RESPONSE', 'message' => ['text' => $text]], $c['pageToken']);
                return isset($r['message_id']) ? 'm:'.$r['message_id'] : null;
            case 'telegram':
                $r = $this->http('POST', $this->endpoint('telegram').'/bot'.$c['botToken'].'/sendMessage', ['chat_id' => $to, 'text' => $text]);
                return isset($r['result']['message_id']) ? 'tg:'.$to.':'.$r['result']['message_id'] : null;
            case 'sms':
                $digits = preg_replace('/\D/', '', $to) ?? '';
                if (!preg_match('/\A905[0-9]{9}\z/', $digits)) throw new RuntimeException('SMS yalnızca Türkiye cep numaralarına gönderilebilir.', 422);
                $curl = curl_init($this->endpoint('netgsm').'/sms/rest/v2/send');
                curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Basic '.base64_encode($c['account'].':'.$c['password'])],
                    CURLOPT_POSTFIELDS => json_encode(['msgheader' => $c['sender'], 'encoding' => 'UNICODE', 'iysfilter' => '0', 'messages' => [['no' => substr($digits, 2), 'msg' => $text]]], JSON_UNESCAPED_UNICODE)]);
                $raw = curl_exec($curl); $http = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE); unset($curl);
                $data = is_string($raw) ? json_decode($raw, true) : null;
                $code = str_pad((string)($data['code'] ?? ''), 2, '0', STR_PAD_LEFT);
                if ($http < 200 || $http >= 300 || !in_array($code, ['00', '01', '02'], true)) throw new RuntimeException('SMS sağlayıcısı mesajı kabul etmedi (kod '.$code.').', 502);
                return 'sms:'.(string)($data['jobid'] ?? bin2hex(random_bytes(6)));
            case 'email':
                return $this->sendMail($c, $to, $conv, $text);
            case 'web':
                if (filter_var($to, FILTER_VALIDATE_EMAIL)) {
                    $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE partner_id=? AND kind='email' AND status='active' ORDER BY created_at LIMIT 1");
                    $q->execute([$conv['partner_id']]);
                    if ($mail = $q->fetch(PDO::FETCH_ASSOC)) return $this->sendMail($this->config($mail), $to, $conv, $text);
                }
                throw new RuntimeException('Web formu yanıtı için E-posta kanalı bağlayın veya müşteriyi telefonla arayın.', 422);
        }
        throw new RuntimeException('Kanal desteklenmiyor.', 422);
    }

    private function sendMail(array $c, string $to, array $conv, string $text): string
    {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Alıcı e-posta adresi geçersiz.', 422);
        $host = (string)$c['smtpHost']; $port = (string)($c['smtpPort'] ?: '465');
        $ip = isset($this->endpoints['smtp']) ? '127.0.0.1' : gethostbyname($host);
        if (!isset($this->endpoints['smtp']) && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) throw new RuntimeException('SMTP sunucusu bulunamadı.', 422);
        $prev = $this->db->prepare("SELECT external_id FROM inbox_message WHERE conversation_id=? AND direction='in' AND external_id LIKE 'mail:%' ORDER BY id DESC LIMIT 1");
        $prev->execute([$conv['id']]);
        $ref = substr((string)$prev->fetchColumn(), 5);
        $subject = (string)$conv['subject'];
        $subject = $subject === '' ? 'Klinik mesajınız hakkında' : (preg_match('/\A(re|ynt|yanıt):/iu', $subject) ? $subject : 'Re: '.$subject);
        $mid = '<'.bin2hex(random_bytes(12)).'@'.(explode('@', (string)$c['address'])[1] ?? 'vetzimo.com').'>';
        $payload = 'From: <'.$c['address'].">\r\nTo: <".$to.">\r\nDate: ".gmdate(DATE_RFC2822)."\r\nMessage-ID: ".$mid."\r\n"
            .($ref !== '' && preg_match('/\A<[^\r\n<>]{3,180}>\z/', $ref) ? 'In-Reply-To: '.$ref."\r\nReferences: ".$ref."\r\n" : '')
            .'Subject: =?UTF-8?B?'.base64_encode($subject)."?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($text));
        $stream = fopen('php://temp', 'w+b'); fwrite($stream, $payload); rewind($stream);
        $curl = curl_init(($port === '465' ? 'smtps' : 'smtp').'://'.$host.':'.$port);
        curl_setopt_array($curl, [CURLOPT_RESOLVE => [$host.':'.$port.':'.$ip], CURLOPT_USE_SSL => isset($this->endpoints['smtp']) ? CURLUSESSL_NONE : CURLUSESSL_ALL,
            CURLOPT_USERNAME => $c['username'], CURLOPT_PASSWORD => $c['password'], CURLOPT_MAIL_FROM => '<'.$c['address'].'>', CURLOPT_MAIL_RCPT => ['<'.$to.'>'],
            CURLOPT_UPLOAD => true, CURLOPT_INFILE => $stream, CURLOPT_INFILESIZE => strlen($payload), CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 20]);
        $ok = curl_exec($curl); $err = curl_error($curl); unset($curl);
        if ($ok === false) throw new RuntimeException('E-posta gönderilemedi: '.$err, 502);
        return 'mail:'.$mid;
    }

    // ───────────────────────────── e-posta (IMAP) ─────────────────────────────
    private function imapCommand(array $c, string $command, string $path = 'INBOX'): ?string
    {
        if (($c['imapHost'] ?? '') === '') throw new RuntimeException('IMAP sunucusu girilmemiş; gelen e-postalar için IMAP veya yönlendirme adresini kullanın.', 422);
        $curl = curl_init('imaps://'.$c['imapHost'].':'.($c['imapPort'] ?: '993').'/'.$path);
        curl_setopt_array($curl, [CURLOPT_USERNAME => $c['username'], CURLOPT_PASSWORD => $c['password'], CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25, CURLOPT_PROTOCOLS => CURLPROTO_IMAPS] + ($command !== '' ? [CURLOPT_CUSTOMREQUEST => $command] : []));
        $raw = curl_exec($curl); $err = curl_error($curl); unset($curl);
        if ($raw === false) throw new RuntimeException('IMAP bağlantısı kurulamadı: '.$err, 502);
        return (string)$raw;
    }

    /** Zamanlanmış görev: IMAP kutularındaki yeni e-postaları alır. */
    public function pollMail(int $now, int $limit = 25): array
    {
        $rows = $this->db->query("SELECT * FROM inbox_channel WHERE kind='email' AND status IN ('active','error') AND JSON_VALUE(config,'$.imapHost')<>''")->fetchAll(PDO::FETCH_ASSOC);
        $stats = ['channels' => 0, 'messages' => 0, 'errors' => 0];
        foreach ($rows as $row) {
            $stats['channels']++;
            try {
                $c = $this->config($row);
                $last = (int)$row['poll_state'];
                if ($last === 0) {
                    $since = gmdate('d-M-Y', (int)$row['created_at']);
                    $found = $this->imapCommand($c, 'UID SEARCH SINCE '.$since);
                } else {
                    $found = $this->imapCommand($c, 'UID SEARCH UID '.($last + 1).':*');
                }
                preg_match('/\* SEARCH([0-9 ]*)/', (string)$found, $m);
                $uids = array_values(array_filter(array_map('intval', preg_split('/\s+/', trim($m[1] ?? '')) ?: []), static fn($u) => $u > $last));
                sort($uids);
                foreach (array_slice($uids, 0, $limit) as $uid) {
                    $raw = $this->imapCommand($c, '', 'INBOX;UID='.$uid);
                    if ($raw !== null && strlen($raw) < 2_000_000) {
                        $mail = self::parseMail($raw);
                        if ($mail['from'] !== '' && strtolower($mail['from']) !== strtolower((string)$c['address']) && !preg_match('/\A(mailer-daemon|postmaster|no-?reply)@/i', $mail['from'])) {
                            if ($this->ingest($row, $mail['from'], $mail['name'], $mail['from'], self::cleanMail($mail['text']), 'mail:'.mb_substr($mail['id'] ?: 'uid'.$uid.'@'.$row['id'], 0, 180), $mail['date'] ?: $now, $mail['subject'])) $stats['messages']++;
                        }
                    }
                    $last = max($last, $uid);
                    $this->db->prepare('UPDATE inbox_channel SET poll_state=? WHERE id=?')->execute([(string)$last, $row['id']]);
                }
                if ($last === 0 && !$uids) $this->db->prepare('UPDATE inbox_channel SET poll_state=? WHERE id=?')->execute(['0', $row['id']]);
                $this->db->prepare("UPDATE inbox_channel SET last_error='',status='active' WHERE id=?")->execute([$row['id']]);
            } catch (\Throwable $error) {
                $stats['errors']++;
                $this->db->prepare("UPDATE inbox_channel SET last_error=?,status='error' WHERE id=?")->execute([mb_substr($error->getMessage(), 0, 300, 'UTF-8'), $row['id']]);
            }
        }
        return $stats;
    }

    /** RFC 822 iletiden gönderen, konu, kimlik ve düz metni çıkarır (multipart, base64, quoted-printable, karakter seti). */
    public static function parseMail(string $raw): array
    {
        [$head, $body] = array_pad(preg_split("/\r?\n\r?\n/", $raw, 2) ?: [], 2, '');
        $headers = self::headers($head);
        [$name, $from] = self::mailbox($headers['reply-to'] ?? $headers['from'] ?? '');
        $text = self::part($headers, $body);
        $date = isset($headers['date']) ? (strtotime($headers['date']) ?: 0) : 0;
        return ['from' => $from, 'name' => $name, 'subject' => mb_substr(self::mimeHeader($headers['subject'] ?? ''), 0, 200, 'UTF-8'), 'id' => trim($headers['message-id'] ?? ''), 'text' => $text, 'date' => $date];
    }

    private static function headers(string $head): array
    {
        $out = [];
        foreach (preg_split("/\r?\n(?![ \t])/", $head) ?: [] as $line) {
            if (!str_contains($line, ':')) continue;
            [$k, $v] = explode(':', $line, 2);
            $out[strtolower(trim($k))] = trim(preg_replace("/\r?\n[ \t]+/", ' ', $v) ?? $v);
        }
        return $out;
    }

    private static function part(array $headers, string $body, int $depth = 0): string
    {
        $type = strtolower($headers['content-type'] ?? 'text/plain');
        if ($depth < 5 && str_starts_with($type, 'multipart/') && preg_match('/boundary="?([^";]+)"?/i', $headers['content-type'] ?? '', $m)) {
            $html = '';
            foreach (explode('--'.$m[1], $body) as $chunk) {
                $chunk = ltrim($chunk, "\r\n");
                if ($chunk === '' || str_starts_with($chunk, '--')) continue;
                [$h, $b] = array_pad(preg_split("/\r?\n\r?\n/", $chunk, 2) ?: [], 2, '');
                $ph = self::headers($h);
                if (str_contains(strtolower($ph['content-disposition'] ?? ''), 'attachment')) continue;
                $pt = strtolower($ph['content-type'] ?? 'text/plain');
                if (str_starts_with($pt, 'text/plain') || str_starts_with($pt, 'multipart/')) { $t = self::part($ph, $b, $depth + 1); if (trim($t) !== '') return $t; }
                if (str_starts_with($pt, 'text/html') && $html === '') $html = self::part($ph, $b, $depth + 1);
            }
            return $html;
        }
        $encoding = strtolower($headers['content-transfer-encoding'] ?? '');
        if ($encoding === 'base64') $body = (string)base64_decode(preg_replace('/\s+/', '', $body) ?? '');
        elseif ($encoding === 'quoted-printable') $body = quoted_printable_decode($body);
        $charset = preg_match('/charset="?([A-Za-z0-9_-]+)"?/i', $headers['content-type'] ?? '', $cm) ? strtoupper($cm[1]) : 'UTF-8';
        if ($charset !== 'UTF-8' && $charset !== 'US-ASCII') $body = (string)@mb_convert_encoding($body, 'UTF-8', $charset);
        if (str_starts_with($type, 'text/html')) {
            $body = preg_replace(['~<(script|style)[^>]*>.*?</\1>~is', '~<br\s*/?>~i', '~</(p|div|tr|li|h[1-6])>~i'], ['', "\n", "\n"], $body) ?? $body;
            $body = html_entity_decode(strip_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        return trim(preg_replace("/[ \t]+\n/", "\n", $body) ?? $body);
    }

    // ───────────────────────────── web formu ─────────────────────────────
    /** Klinik web sitesinin iletişim formundan gelen mesajı da gelen kutusuna ekler. */
    public function ingestWeb(string $partner, string $name, string $email, string $phone, string $body, int $now): void
    {
        $q = $this->db->prepare("SELECT * FROM inbox_channel WHERE partner_id=? AND kind='web'");
        $q->execute([$partner]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $id = bin2hex(random_bytes(16));
            $this->db->prepare("INSERT INTO inbox_channel (id,partner_id,kind,label,status,hook_key,external_id,config,created_at) VALUES (?,?,'web','Web sitesi','active',?,'','{}',?)")
                ->execute([$id, $partner, bin2hex(random_bytes(20)), $now]);
            $row = $this->channelRow($partner, $id);
        }
        $phone = $phone !== '' ? self::phone($phone) : '';
        $contact = filter_var($email, FILTER_VALIDATE_EMAIL) ? strtolower($email) : $phone;
        if ($contact === '') return;
        $text = $body.($phone !== '' && $contact !== $phone ? "\nTelefon: ".$phone : '');
        $this->ingest($row, $contact, $name, $contact, $text, 'web:'.substr(hash('sha256', $contact.'|'.$body.'|'.$now), 0, 40), $now, 'Web sitesi iletişim formu');
    }
}
