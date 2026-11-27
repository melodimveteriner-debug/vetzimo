<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Push gönderimi: Android (Firebase Cloud Messaging HTTP v1), iOS (APNs, .p8 anahtarıyla), web/PWA (Web Push,
 * VAPID + RFC 8291 aes128gcm şifreleme; hesap gerektirmez, anahtarlar ilk kullanımda üretilir). Masaüstü
 * uygulaması bildirimleri uygulama içinden işletim sistemine verir (provider=desktop, push gönderilmez).
 *
 * Kilit ekranı gizliliği: hassas kategorilerde (hasta, tetkik, ödeme, mesaj) bildirim metni genel tutulur;
 * ayrıntı uygulama açıldığında oturum doğrulanarak gösterilir. Android'de visibility=PRIVATE kullanılır.
 */
final class AppPush
{
    private const SETTINGS_ID = '00000000000000000000000000000005';
    private const VAPID_ID = '00000000000000000000000000000006';
    private ?array $settings = null;
    private ?string $fcmToken = null;
    private int $fcmTokenUntil = 0;
    /** @var callable|null Testlerde HTTP isteği yerine geçer: fn(string $url, array $headers, string $body): array{0:int,1:string} */
    public $transport = null;

    public function __construct(private readonly PDO $db, private readonly array $config = []) {}

    private function key(): string { return (string)($this->config['encryptionKey'] ?? ''); }

    private function q(string $sql, array $args = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($args);
        return $q;
    }

    // ───────────────────────── Ayarlar ─────────────────────────

    public function settings(): array
    {
        if ($this->settings !== null) return $this->settings;
        $raw = $this->q("SELECT payload FROM center_management WHERE id=? AND kind='app_push'", [self::SETTINGS_ID])->fetchColumn();
        $s = $raw ? json_decode((string)$raw, true) : [];
        foreach (['fcmCredential', 'apnsKey'] as $f) if (!empty($s[$f])) { try { $s[$f] = Totp::decrypt($s[$f], $this->key()); } catch (\Throwable) { $s[$f] = ''; } }
        return $this->settings = $s + ['fcmProject' => '', 'fcmCredential' => '', 'apnsKey' => '', 'apnsKeyId' => '', 'apnsTeamId' => '', 'apnsTopic' => '', 'apnsSandbox' => false, 'contact' => 'https://vetzimo.com', 'androidSha256' => ''];
    }

    public function saveSettings(object $b): void
    {
        $old = $this->settings();
        $s = [
            'fcmProject' => preg_match('/\A[a-z0-9-]{0,64}\z/', (string)($b->fcmProject ?? '')) ? (string)($b->fcmProject ?? '') : throw new RuntimeException('Firebase proje kimliği geçersiz.', 422),
            'apnsKeyId' => preg_match('/\A[A-Z0-9]{0,10}\z/', (string)($b->apnsKeyId ?? '')) ? (string)($b->apnsKeyId ?? '') : throw new RuntimeException('APNs anahtar kimliği geçersiz.', 422),
            'apnsTeamId' => preg_match('/\A[A-Z0-9]{0,10}\z/', (string)($b->apnsTeamId ?? '')) ? (string)($b->apnsTeamId ?? '') : throw new RuntimeException('Apple ekip kimliği geçersiz.', 422),
            'apnsTopic' => preg_match('/\A[A-Za-z0-9.-]{0,120}\z/', (string)($b->apnsTopic ?? '')) ? (string)($b->apnsTopic ?? '') : throw new RuntimeException('Paket kimliği geçersiz.', 422),
            'apnsSandbox' => !empty($b->apnsSandbox),
            'androidSha256' => preg_match('/\A([0-9A-F]{2}:){31}[0-9A-F]{2}\z/', strtoupper(trim((string)($b->androidSha256 ?? '')))) ? strtoupper(trim((string)$b->androidSha256)) : (trim((string)($b->androidSha256 ?? '')) === '' ? '' : throw new RuntimeException('Android imza parmak izi (SHA-256) AA:BB:… biçiminde olmalı.', 422)),
            'contact' => preg_match('~\A(https://[A-Za-z0-9./-]{3,120}|mailto:[^@\s]{1,64}@[A-Za-z0-9.-]{3,120})\z~', (string)($b->contact ?? '')) ? (string)$b->contact : 'https://vetzimo.com',
        ];
        $cred = trim((string)($b->fcmCredential ?? ''));
        if ($cred !== '') {
            $j = json_decode($cred, true);
            if (!is_array($j) || ($j['type'] ?? '') !== 'service_account' || empty($j['private_key']) || empty($j['client_email'])) throw new RuntimeException('Firebase hizmet hesabı JSON dosyası geçersiz.', 422);
            if ($s['fcmProject'] === '') $s['fcmProject'] = (string)($j['project_id'] ?? '');
        }
        $p8 = trim((string)($b->apnsKey ?? ''));
        if ($p8 !== '' && !openssl_pkey_get_private($p8)) throw new RuntimeException('APNs .p8 anahtarı okunamadı.', 422);
        $store = $s;
        $store['fcmCredential'] = $cred !== '' ? Totp::encrypt($cred, $this->key()) : (!empty($old['fcmCredential']) && empty($b->fcmRemove) ? Totp::encrypt($old['fcmCredential'], $this->key()) : '');
        $store['apnsKey'] = $p8 !== '' ? Totp::encrypt($p8, $this->key()) : (!empty($old['apnsKey']) && empty($b->apnsRemove) ? Totp::encrypt($old['apnsKey'], $this->key()) : '');
        $this->q("INSERT INTO center_management(id,kind,payload) VALUES (?,'app_push',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)", [self::SETTINGS_ID, json_encode($store)]);
        $this->settings = null;
    }

    public function status(): array
    {
        $s = $this->settings();
        return ['fcm' => $s['fcmProject'] !== '' && $s['fcmCredential'] !== '', 'fcmProject' => $s['fcmProject'],
            'apns' => $s['apnsKey'] !== '' && $s['apnsKeyId'] !== '' && $s['apnsTeamId'] !== '' && $s['apnsTopic'] !== '',
            'apnsKeyId' => $s['apnsKeyId'], 'apnsTeamId' => $s['apnsTeamId'], 'apnsTopic' => $s['apnsTopic'], 'apnsSandbox' => $s['apnsSandbox'],
            'webpush' => true, 'vapid' => $this->vapidPublic(), 'contact' => $s['contact'], 'androidSha256' => $s['androidSha256']];
    }

    /** Uygulama bağlantıları: Android App Links ve iOS Universal Links doğrulama dosyaları. */
    public function wellKnown(string $file): ?array
    {
        $s = $this->settings();
        if ($file === 'assetlinks.json') {
            if ($s['androidSha256'] === '') return [];
            return [['relation' => ['delegate_permission/common.handle_all_urls'], 'target' => ['namespace' => 'android_app', 'package_name' => 'com.vetzimo.app', 'sha256_cert_fingerprints' => [$s['androidSha256']]]]];
        }
        if ($file === 'apple-app-site-association') {
            $id = ($s['apnsTeamId'] ?: 'TEAMID').'.'.($s['apnsTopic'] ?: 'com.vetzimo.app');
            return ['applinks' => ['details' => [['appIDs' => [$id], 'components' => [['/' => '/app*'], ['/' => '/clinic*'], ['/' => '/hasta-sahibi*'], ['/' => '/evde-hizmet/*']]]]], 'webcredentials' => ['apps' => [$id]]];
        }
        return null;
    }

    // ───────────────────────── VAPID ─────────────────────────

    private function vapid(): array
    {
        $raw = $this->q("SELECT payload FROM center_management WHERE id=? AND kind='app_vapid'", [self::VAPID_ID])->fetchColumn();
        if ($raw) {
            $v = json_decode((string)$raw, true);
            return ['public' => $v['public'], 'pem' => Totp::decrypt($v['pem'], $this->key())];
        }
        $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if (!$k || !openssl_pkey_export($k, $pem)) throw new RuntimeException('VAPID anahtarı üretilemedi.', 503);
        $d = openssl_pkey_get_details($k)['ec'];
        $public = self::b64u("\x04".str_pad($d['x'], 32, "\0", STR_PAD_LEFT).str_pad($d['y'], 32, "\0", STR_PAD_LEFT));
        $this->q("INSERT IGNORE INTO center_management(id,kind,payload) VALUES (?,'app_vapid',?)", [self::VAPID_ID, json_encode(['public' => $public, 'pem' => Totp::encrypt($pem, $this->key())])]);
        return $this->vapid();
    }

    public function vapidPublic(): string
    {
        try { return $this->vapid()['public']; } catch (\Throwable) { return ''; }
    }

    public static function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
    public static function unb64u(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/').str_repeat('=', (4 - strlen($s) % 4) % 4), true); }

    /** DER ECDSA imzasını JWT'nin istediği 64 baytlık r||s biçimine çevirir. */
    public static function derToRaw(string $der): string
    {
        $pos = 2; if (ord($der[1]) & 0x80) $pos += ord($der[1]) & 0x7f;
        $out = '';
        for ($i = 0; $i < 2; $i++) {
            $len = ord($der[$pos + 1]);
            $int = substr($der, $pos + 2, $len);
            $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
            $pos += 2 + $len;
        }
        return $out;
    }

    public static function jwt(array $header, array $claims, string $pem, string $alg): string
    {
        $data = self::b64u(json_encode($header)).'.'.self::b64u(json_encode($claims, JSON_UNESCAPED_SLASHES));
        if (!openssl_sign($data, $sig, $pem, OPENSSL_ALGO_SHA256)) throw new RuntimeException('İmza oluşturulamadı.', 503);
        return $data.'.'.self::b64u($alg === 'ES256' ? self::derToRaw($sig) : $sig);
    }

    /** RFC 8291 (aes128gcm) Web Push yükü şifreleme. */
    public static function encryptWebPush(string $payload, string $uaPublicB64, string $authB64, ?string $salt = null, $serverKey = null): string
    {
        $ua = self::unb64u($uaPublicB64); $auth = self::unb64u($authB64);
        if (strlen($ua) !== 65 || strlen($auth) < 16) throw new RuntimeException('Abonelik anahtarı geçersiz.', 422);
        $server = $serverKey ?: openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $d = openssl_pkey_get_details($server)['ec'];
        $asPublic = "\x04".str_pad($d['x'], 32, "\0", STR_PAD_LEFT).str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
        $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$ua;
        $peer = openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n");
        $shared = openssl_pkey_derive($peer, $server, 32);
        if ($shared === false) throw new RuntimeException('Anahtar uzlaşması başarısız.', 503);
        $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0".$ua.$asPublic, $auth);
        $salt ??= random_bytes(16);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
        $cipher = openssl_encrypt($payload."\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        return $salt.pack('N', 4096).chr(65).$asPublic.$cipher.$tag;
    }

    // ───────────────────────── HTTP ─────────────────────────

    private function http(string $url, array $headers, string $body, bool $h2 = false): array
    {
        if ($this->transport) return ($this->transport)($url, $headers, $body);
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS] + ($h2 ? [CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0] : []));
        $res = curl_exec($c);
        $code = (int)curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        $err = curl_error($c);
        curl_close($c);
        return [$code, $res === false ? $err : (string)$res];
    }

    private function fcmAccess(int $now): string
    {
        if ($this->fcmToken && $this->fcmTokenUntil > $now + 60) return $this->fcmToken;
        $cred = json_decode($this->settings()['fcmCredential'], true);
        $jwt = self::jwt(['alg' => 'RS256', 'typ' => 'JWT'], ['iss' => $cred['client_email'], 'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
            'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600], $cred['private_key'], 'RS256');
        [$code, $res] = $this->http('https://oauth2.googleapis.com/token', ['Content-Type: application/x-www-form-urlencoded'],
            http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]));
        $j = json_decode($res, true);
        if ($code !== 200 || empty($j['access_token'])) throw new RuntimeException('Firebase erişim anahtarı alınamadı ('.$code.').', 503);
        $this->fcmTokenUntil = $now + (int)($j['expires_in'] ?? 3000);
        return $this->fcmToken = $j['access_token'];
    }

    /**
     * Tek cihaza gönderir.
     * @return array{0:string,1:string} [sent|retry|invalid|skipped, hata]
     */
    public function deliver(array $device, array $msg, int $now): array
    {
        $s = $this->settings();
        $token = Totp::decrypt($device['token'], $this->key());
        $sound = $device['sound'] ?: 'default';
        switch ($device['provider']) {
            case 'fcm':
                if (!$this->status()['fcm']) return ['skipped', 'Firebase ayarlanmadı'];
                // Tüm bildirimler yüksek öncelikli ve sesli kanaldan gider (kanal "vzs_"; kanal henüz oluşmamışsa Android varsayılan sesli kanalı kullanır).
                $android = ['priority' => 'HIGH', 'collapse_key' => $msg['category'], 'ttl' => '86400s',
                    'notification' => ['channel_id' => 'vzs_'.$msg['category'], 'tag' => 'vz'.$msg['id'], 'notification_count' => $msg['badge'],
                        'visibility' => $msg['private'] ? 'PRIVATE' : 'PUBLIC', 'default_sound' => $sound === 'default'] + ($sound !== 'default' && $sound !== 'silent' ? ['sound' => $sound] : [])];
                $body = json_encode(['message' => ['token' => $token, 'notification' => ['title' => $msg['title'], 'body' => $msg['body']],
                    'data' => ['id' => (string)$msg['id'], 'href' => $msg['href'], 'membership' => $msg['membership'], 'category' => $msg['category'], 'badge' => (string)$msg['badge']],
                    'android' => $android]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                [$code, $res] = $this->http('https://fcm.googleapis.com/v1/projects/'.rawurlencode($s['fcmProject']).'/messages:send',
                    ['Authorization: Bearer '.$this->fcmAccess($now), 'Content-Type: application/json'], $body);
                if ($code === 200) return ['sent', ''];
                if ($code === 404 || ($code === 400 && str_contains($res, 'registration token')) || str_contains($res, 'UNREGISTERED')) return ['invalid', 'Anahtar geçersiz'];
                return [$code === 429 || $code >= 500 || $code === 0 ? 'retry' : 'failed', 'FCM '.$code.' '.mb_substr($res, 0, 160)];
            case 'apns':
                if (!$this->status()['apns']) return ['skipped', 'APNs ayarlanmadı'];
                $jwt = self::jwt(['alg' => 'ES256', 'kid' => $s['apnsKeyId']], ['iss' => $s['apnsTeamId'], 'iat' => intdiv($now, 1800) * 1800], $s['apnsKey'], 'ES256');
                $aps = ['alert' => ['title' => $msg['title'], 'body' => $msg['body']], 'badge' => $msg['badge'], 'thread-id' => $msg['category'], 'category' => 'VZ_'.strtoupper($msg['category']),
                    'mutable-content' => 1] + ($sound === 'silent' ? [] : ['sound' => $sound === 'default' ? 'default' : $sound.'.wav']) + ($msg['critical'] ? ['interruption-level' => 'time-sensitive'] : []);
                $host = $s['apnsSandbox'] ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
                [$code, $res] = $this->http($host.'/3/device/'.rawurlencode($token), ['authorization: bearer '.$jwt, 'apns-topic: '.$s['apnsTopic'], 'apns-push-type: alert',
                    'apns-priority: 10', 'apns-collapse-id: vz'.$msg['id'], 'apns-expiration: '.($now + 86400), 'content-type: application/json'],
                    json_encode(['aps' => $aps, 'id' => $msg['id'], 'href' => $msg['href'], 'membership' => $msg['membership'], 'category' => $msg['category']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), true);
                if ($code === 200) return ['sent', ''];
                if ($code === 410 || str_contains($res, 'BadDeviceToken') || str_contains($res, 'Unregistered')) return ['invalid', 'Anahtar geçersiz'];
                return [$code === 429 || $code >= 500 || $code === 0 ? 'retry' : 'failed', 'APNs '.$code.' '.mb_substr($res, 0, 160)];
            case 'webpush':
                $sub = json_decode($token, true);
                $v = $this->vapid();
                $aud = preg_replace('~\A(https://[^/]+).*\z~', '$1', $sub['endpoint']);
                $jwt = self::jwt(['typ' => 'JWT', 'alg' => 'ES256'], ['aud' => $aud, 'exp' => $now + 43200, 'sub' => $s['contact']], $v['pem'], 'ES256');
                $payload = json_encode(['id' => $msg['id'], 'title' => $msg['title'], 'body' => $msg['body'], 'href' => $msg['href'], 'membership' => $msg['membership'],
                    'category' => $msg['category'], 'badge' => $msg['badge'], 'silent' => $sound === 'silent'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                [$code, $res] = $this->http($sub['endpoint'], ['Content-Encoding: aes128gcm', 'Content-Type: application/octet-stream', 'TTL: 86400',
                    'Urgency: '.($msg['critical'] ? 'high' : 'normal'), 'Topic: vz'.$msg['id'], 'Authorization: vapid t='.$jwt.', k='.$v['public']],
                    self::encryptWebPush($payload, $sub['p256dh'], $sub['auth']));
                if ($code >= 200 && $code < 300) return ['sent', ''];
                if ($code === 404 || $code === 410) return ['invalid', 'Abonelik sona erdi'];
                return [$code === 429 || $code >= 500 || $code === 0 ? 'retry' : 'failed', 'WebPush '.$code.' '.mb_substr($res, 0, 160)];
            default:
                return ['skipped', 'Uygulama içinden gösterilir'];
        }
    }

    private static function inQuiet(?array $quiet, int $now): bool
    {
        if (!$quiet || empty($quiet['on'])) return false;
        $t = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('H:i');
        return $quiet['from'] <= $quiet['to'] ? ($t >= $quiet['from'] && $t < $quiet['to']) : ($t >= $quiet['from'] || $t < $quiet['to']);
    }

    /**
     * Yeni bildirimleri cihazlara dağıtır ve bekleyen yeniden denemeleri gönderir.
     * @return array{sent:int,failed:int,invalid:int,skipped:int,retry:int}
     */
    public function work(int $now, int $limit = 300): array
    {
        $stat = ['sent' => 0, 'failed' => 0, 'invalid' => 0, 'skipped' => 0, 'retry' => 0, 'muted' => 0];
        $hub = new AppHub($this->db, $this->config);
        $templates = $hub->templates();
        // 1) Henüz dağıtılmamış bildirimler: her cihaz için gönderim satırı açılır.
        $new = $this->q('SELECT id,account_id,membership_id,category,created_at FROM app_notification WHERE pushed=0 AND created_at>? ORDER BY id LIMIT '.(int)$limit, [$now - 86400])->fetchAll();
        foreach ($new as $n) {
            $devices = $this->q("SELECT d.id,d.provider,d.muted,p.quiet FROM app_device d LEFT JOIN app_preference p ON p.account_id=d.account_id
                WHERE d.account_id=? AND d.revoked_at IS NULL AND d.provider<>'desktop'
                AND (?='' OR d.membership_id=? OR (d.membership_id<>'' AND NOT EXISTS (SELECT 1 FROM identity_membership dm WHERE dm.id=d.membership_id AND dm.role='customer')
                    AND NOT EXISTS (SELECT 1 FROM identity_membership nm WHERE nm.id=? AND nm.role='customer')))", [$n['account_id'], $mid = (string)$n['membership_id'], $mid, $mid])->fetchAll();
            foreach ($devices as $d) {
                $muted = in_array($n['category'], json_decode((string)$d['muted'], true) ?: [], true) && !AppHub::CATEGORIES[$n['category']][1];
                $quiet = !AppHub::CATEGORIES[$n['category']][1] && self::inQuiet(json_decode((string)$d['quiet'], true), $now);
                if ($muted || $quiet) $stat['muted']++;
                $this->q('INSERT IGNORE INTO app_push(notification_id,device_id,status,attempts,next_at,created_at) VALUES (?,?,?,0,?,?)',
                    [$n['id'], $d['id'], $muted ? 'muted' : ($quiet ? 'quiet' : 'queued'), $now, $now]);
            }
            $this->q('UPDATE app_notification SET pushed=1 WHERE id=?', [$n['id']]);
        }
        // 2) Sıradaki gönderimler.
        $jobs = $this->q("SELECT x.notification_id,x.device_id,x.attempts,n.account_id,n.membership_id,n.category,n.title,n.body,n.href,n.read_at,n.cleared_at,
                d.provider,d.token,d.sound,d.revoked_at,d.membership_id AS device_membership FROM app_push x JOIN app_notification n ON n.id=x.notification_id JOIN app_device d ON d.id=x.device_id
            WHERE x.status IN ('queued','retry') AND x.next_at<=? ORDER BY x.next_at LIMIT ".(int)$limit, [$now])->fetchAll();
        $badge = [];
        $up = $this->db->prepare('UPDATE app_push SET status=?,attempts=attempts+1,next_at=?,error=?,sent_at=? WHERE notification_id=? AND device_id=?');
        foreach ($jobs as $j) {
            if ($j['revoked_at'] !== null || $j['read_at'] !== null || $j['cleared_at'] !== null) { $up->execute(['skipped', $now, 'Okundu veya cihaz kapandı', null, $j['notification_id'], $j['device_id']]); $stat['skipped']++; continue; }
            [$label, $critical, $private] = AppHub::CATEGORIES[$j['category']] ?? ['Bildirim', false, true];
            $t = $templates[$j['category']] ?? ['title' => 'VetZimo', 'body' => ''];
            $badge[$j['account_id'].'|'.$j['device_membership']] ??= $hub->unread($j['account_id'], (string)$j['device_membership']);
            $msg = ['id' => (int)$j['notification_id'], 'category' => $j['category'], 'critical' => $critical, 'private' => $private, 'membership' => $j['membership_id'],
                'href' => $j['href'], 'badge' => $badge[$j['account_id'].'|'.$j['device_membership']],
                'title' => $private ? $t['title'] : $j['title'],
                'body' => $private ? ($t['body'] ?: 'Ayrıntıları görmek için dokunun.') : trim(($t['body'] !== '' ? $t['body'].' · ' : '').$j['body'], ' ·')];
            try { [$out, $err] = $this->deliver($j, $msg, $now); } catch (\Throwable $e) { [$out, $err] = ['retry', mb_substr($e->getMessage(), 0, 160)]; }
            if ($out === 'retry' && (int)$j['attempts'] >= 6) $out = 'failed';
            $up->execute([$out, $now + min(21600, 60 * 2 ** min(8, (int)$j['attempts'])), $err ?: null, $out === 'sent' ? $now : null, $j['notification_id'], $j['device_id']]);
            if ($out === 'invalid') $this->q('UPDATE app_device SET revoked_at=? WHERE id=?', [$now, $j['device_id']]);
            $stat[$out] = ($stat[$out] ?? 0) + 1;
        }
        // 3) Eski gönderim kayıtları temizlenir (90 gün), okunmuş eski bildirimler 180 günde silinir.
        if (random_int(1, 50) === 1) {
            $this->q('DELETE FROM app_push WHERE created_at<?', [$now - 90 * 86400]);
            $this->q('DELETE FROM app_notification WHERE created_at<? AND (read_at IS NOT NULL OR cleared_at IS NOT NULL)', [$now - 180 * 86400]);
        }
        return $stat;
    }

    /** Merkez hesaplarının kendi cihazlarına deneme bildirimi. */
    public function test(int $now): int
    {
        $hub = new AppHub($this->db, $this->config);
        $hub->notifyCenter('system', 'Deneme bildirimi', 'VetZimo bildirimleri bu cihaza ulaşıyor.', '/yonetim#uygulamalar', 'test:'.$now, $now);
        $r = $this->work($now);
        return $r['sent'];
    }
}
