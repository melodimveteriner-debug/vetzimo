<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

require_once __DIR__.'/AppHub.php';
use PDO;
use RuntimeException;

final class DealerLogin
{
    private const WINDOW_SECONDS = 900;
    private const MAX_ATTEMPTS = 10;
    private const SESSION_SECONDS = 28800;

    public function __construct(private readonly PDO $database, private readonly string $rateSecret)
    {
        if (strlen($rateSecret) < 32) {
            throw new \InvalidArgumentException('A random login rate secret is required.');
        }
    }

    /** @return array{token: string, device: string, age: int}|null */
    public function signIn(string $phone, string $password, string $address, int $now, ?string $bookingPartner=null, ?TeamTotp $totp=null, string $otp=''): ?array
    {
        $this->reserveAttempt($address, $now);
        $identifier = self::normalizePhone($phone);
        if ($identifier !== '') $this->reserveAttempt('account:'.$identifier,$now);
        if ($identifier === '' || strlen($password) > 512) {
            return null;
        }

        $query = $this->database->prepare(
            "SELECT a.id,a.password_hash,a.version,a.identifier,m.id AS membership_id,m.role,m.branch_id,m.customer_id,m.partner_id,m.modules
             FROM identity_account a JOIN identity_membership m ON m.account_id=a.id
             JOIN partner_account p ON p.id=m.partner_id
             WHERE a.kind='phone' AND a.identifier=? AND a.blocked=0
               AND m.status='active' AND p.active=1
             ORDER BY (m.role='customer' AND m.partner_id <=> ?) DESC,FIELD(m.role,'dealer','branch','staff','customer'),m.id"
        );
        $query->execute([$identifier,$bookingPartner]);
        $accounts = $query->fetchAll();
        $dummy = '$argon2id$v=19$m=19456,t=2,p=1$dmV0bmV0LWR1bW15LXNhbHQ$2kJt5TvTYj2TjRtwCXNTSep3hx6JPELnITrpTXQsiGA';
        // All memberships of this identifier resolve to the same identity account.
        if (!password_verify($password, $accounts[0]['password_hash'] ?? $dummy) || !$accounts) return null;
        $workspaces = new WorkspaceRepository($this->database);
        $account = null;
        foreach ($accounts as $candidate) {
            if ($candidate['role']==='dealer') {
                $account=$candidate;
                break;
            }
            $workspace='partner:'.$candidate['partner_id'];
            // Hasta sahibinde yalnız kendi müşteri kaydı okunur (büyük klinikte tüm alan yüklenmez).
            $state=$candidate['role']==='customer' ?
                ((($slice=(new ClinicRecords($this->database))->slice($workspace,['clients'=>[(string)$candidate['customer_id']]])) && $slice->clients)
                    ? $slice : $workspaces->load($workspace)['state']) :
                (object)['branches'=>$workspaces->branches($workspace)];
            if (ClinicAccess::valid($candidate,$state)) { $account=$candidate; break; }
        }
        if (!$account) return null;
        // Ekip hesabında iki adımlı doğrulama açıksa ikinci adım olmadan oturum açılmaz.
        if ($totp && !$totp->pass($account['id'], $otp, $now)) return ['otpRequired' => true, 'otpInvalid' => trim($otp) !== ''];

        $token = bin2hex(random_bytes(32));
        $device = bin2hex(random_bytes(32));
        $insert = $this->database->prepare(
            "INSERT INTO identity_session
             (token_hash,device_hash,account_id,account_version,membership_id,created,touched,expires,reauth_at)
             SELECT ?,?,a.id,a.version,m.id,?,?,?,?
             FROM identity_account a JOIN identity_membership m ON m.account_id=a.id
             JOIN partner_account p ON p.id=m.partner_id
             WHERE a.id=? AND a.version=? AND a.blocked=0 AND m.id=?
               AND m.status='active' AND p.active=1"
        );
        $insert->execute([
            self::hashToken($token), self::hashToken($device), $now, $now,
            $now + self::SESSION_SECONDS, $now, $account['id'], $account['version'], $account['membership_id'],
        ]);
        if ($insert->rowCount() !== 1) {
            return null;
        }
        (new AppHub($this->database))->securityLogin($account['id'],$account['membership_id'],$account['role'],(string)($_SERVER['HTTP_USER_AGENT'] ?? ''),$now);

        return ['token' => $token, 'device' => $device, 'age' => self::SESSION_SECONDS, 'partner_id'=>$account['partner_id'], 'destination'=>$account['role']==='customer'?'/hasta-sahibi':'/clinic'];
    }

    public function changePassword(array $cookies, string $current, string $next, string $address, int $now): void
    {
        $this->reserveAttempt('password:' . $address, $now);
        if (strlen($next) < 12 || strlen($next) > 512 || strlen($current) > 512) {
            throw new RuntimeException('Yeni şifre en az 12 karakter olmalıdır.', 422);
        }
        $this->database->beginTransaction();
        try {
            $actor = (new SessionRepository($this->database))->resolve($cookies, $now, true);
            if (!in_array($actor['role'] ?? '',['dealer','branch','staff','customer'],true)) throw new RuntimeException('Oturum doğrulanamadı.', 403);
            $query = $this->database->prepare('SELECT password_hash FROM identity_account WHERE id=? FOR UPDATE');
            $query->execute([$actor['account_id']]);
            if (!password_verify($current, (string)$query->fetchColumn())) throw new RuntimeException('Mevcut şifre doğrulanamadı.', 403);
            $this->database->prepare('UPDATE identity_account SET password_hash=?,version=version+1 WHERE id=?')
                ->execute([password_hash($next,PASSWORD_ARGON2ID),$actor['account_id']]);
            $this->database->prepare('DELETE FROM identity_session WHERE account_id=?')->execute([$actor['account_id']]);
            $this->database->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')
                ->execute([$actor['partner_id'],$actor['account_id'],'password.changed']);
            $this->database->commit();
        } catch (\Throwable $error) {
            $this->database->rollBack();
            throw $error;
        }
    }

    public function signOut(string $token, string $device): void
    {
        // Çıkış yapılan cihaza artık bildirim gönderilmez.
        (new AppHub($this->database))->forgetSession(self::hashToken($device));
        $query = $this->database->prepare('DELETE FROM identity_session WHERE token_hash=? AND device_hash=?');
        $query->execute([self::hashToken($token), self::hashToken($device)]);
    }

    public static function normalizePhone(string $phone): string
    {
        $phone = preg_replace('/[\s()+-]/', '', $phone);
        $phone = preg_replace('/^(?:0090|90|0)(?=5[0-9]{9}$)/D', '', $phone);
        return preg_match('/\A5[0-9]{9}\z/', $phone) === 1 ? '+90' . $phone : '';
    }

    private static function hashToken(string $token): string
    {
        return base64_encode(hash('sha256', $token, true));
    }

    public function throttle(string $key,int $now): void { $this->reserveAttempt($key,$now); }
    private function reserveAttempt(string $address, int $now): void
    {
        $key = hash_hmac('sha256', $address, $this->rateSecret, true);
        $window = intdiv($now, self::WINDOW_SECONDS) * self::WINDOW_SECONDS;
        $this->database->beginTransaction();
        try {
            $add = $this->database->prepare(
                'INSERT INTO identity_login_window (address_hash,window_start,attempts) VALUES (?,?,0)
                 ON DUPLICATE KEY UPDATE address_hash=address_hash'
            );
            $add->execute([$key, $window]);
            $read = $this->database->prepare(
                'SELECT window_start,attempts FROM identity_login_window WHERE address_hash=? FOR UPDATE'
            );
            $read->execute([$key]);
            $row = $read->fetch();
            $attempts = (int) $row['window_start'] === $window ? (int) $row['attempts'] : 0;
            if ($attempts >= self::MAX_ATTEMPTS) {
                throw new RuntimeException('Çok fazla giriş denemesi. Daha sonra tekrar deneyin.', 429);
            }
            $write = $this->database->prepare(
                'UPDATE identity_login_window SET window_start=?,attempts=? WHERE address_hash=?'
            );
            $write->execute([$window, $attempts + 1, $key]);
            $this->database->commit();
        } catch (\Throwable $error) {
            $this->database->rollBack();
            throw $error;
        }
    }
}
