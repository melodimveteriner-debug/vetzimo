<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Klinik ekibi (telefonla giriş yapan hesaplar) için iki adımlı doğrulama (TOTP, RFC 6238).
 * Anahtar şifreli saklanır, aynı kod iki kez kullanılamaz; tek kullanımlık 8 kurtarma kodu üretilir.
 */
final class TeamTotp
{
    public function __construct(private readonly PDO $db, private readonly string $key) {}

    private function row(string $account, bool $lock = false): ?array
    {
        $q = $this->db->prepare('SELECT * FROM identity_phone_totp WHERE account_id=?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$account]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function enabled(string $account): bool
    {
        try {
            return ($this->row($account)['enabled_at'] ?? null) !== null;
        } catch (\PDOException $error) {
            if ($error->getCode() === '42S02') return false; // Güncelleme henüz uygulanmadı.
            throw $error;
        }
    }

    private static function team(array $actor): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true)) {
            throw new RuntimeException('İki adımlı doğrulama klinik ekibi hesapları içindir.', 403);
        }
    }

    public function status(array $actor): array
    {
        self::team($actor);
        $row = $this->row($actor['account_id']);
        $codes = $row && $row['recovery'] ? count(array_filter(json_decode($row['recovery'], true) ?: [])) : 0;
        return ['enabled' => ($row['enabled_at'] ?? null) !== null, 'enabledAt' => $row['enabled_at'] ?? null, 'recoveryLeft' => $codes];
    }

    public function start(array $actor, string $issuer): array
    {
        self::team($actor);
        $row = $this->row($actor['account_id']);
        if (($row['enabled_at'] ?? null) !== null) throw new RuntimeException('İki adımlı doğrulama zaten açık.', 409);
        $secret = Totp::secret();
        $this->db->prepare('INSERT INTO identity_phone_totp(account_id,pending_seed) VALUES (?,?) ON DUPLICATE KEY UPDATE pending_seed=VALUES(pending_seed)')
            ->execute([$actor['account_id'], Totp::encrypt($secret, $this->key)]);
        $label = rawurlencode($issuer . ':' . ($actor['identifier'] ?? 'hesap'));
        return ['secret' => $secret, 'uri' => 'otpauth://totp/' . $label . '?secret=' . $secret . '&issuer=' . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30'];
    }

    public function confirm(array $actor, string $code, int $now): array
    {
        self::team($actor);
        $this->db->beginTransaction();
        try {
            $row = $this->row($actor['account_id'], true);
            if (!$row || !$row['pending_seed']) throw new RuntimeException('Önce kurulumu başlatın.', 409);
            $secret = Totp::decrypt($row['pending_seed'], $this->key);
            $step = Totp::verify($secret, trim($code), $now);
            if ($step === null) throw new RuntimeException('Kod doğrulanamadı. Uygulamadaki güncel 6 haneli kodu girin; telefonunuzun saatinin doğru olduğundan emin olun.', 422);
            $codes = [];
            for ($i = 0; $i < 8; $i++) $codes[] = substr(bin2hex(random_bytes(4)), 0, 4) . '-' . substr(bin2hex(random_bytes(4)), 0, 4);
            $hashes = array_map(static fn($c) => hash('sha256', $c), $codes);
            $this->db->prepare('UPDATE identity_phone_totp SET seed=?,pending_seed=NULL,step=?,enabled_at=?,recovery=? WHERE account_id=?')
                ->execute([Totp::encrypt($secret, $this->key), $step, $now, json_encode($hashes), $actor['account_id']]);
            $this->audit($actor, 'team_totp.enable');
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        return ['enabled' => true, 'recoveryCodes' => $codes];
    }

    public function disable(array $actor, string $password, string $code, int $now): array
    {
        self::team($actor);
        $q = $this->db->prepare('SELECT password_hash FROM identity_account WHERE id=?');
        $q->execute([$actor['account_id']]);
        if (!password_verify($password, (string)$q->fetchColumn())) throw new RuntimeException('Şifre doğrulanamadı.', 403);
        if (!$this->pass($actor['account_id'], $code, $now)) throw new RuntimeException('Doğrulama kodu geçersiz.', 403);
        $this->db->prepare('DELETE FROM identity_phone_totp WHERE account_id=?')->execute([$actor['account_id']]);
        $this->audit($actor, 'team_totp.disable');
        return ['enabled' => false];
    }

    /** Girişte ikinci adım. 2FA kapalıysa her zaman geçer; açıksa TOTP ya da tek kullanımlık kurtarma kodu gerekir. */
    public function pass(string $account, string $code, int $now): bool
    {
        if (!$this->enabled($account)) return true;
        $code = strtolower(trim($code));
        if ($code === '') return false;
        $this->db->beginTransaction();
        try {
            $row = $this->row($account, true);
            $ok = false;
            if (preg_match('/\A[0-9]{6}\z/', $code)) {
                $step = Totp::verify(Totp::decrypt($row['seed'], $this->key), $code, $now, (int)$row['step']);
                if ($step !== null) {
                    $this->db->prepare('UPDATE identity_phone_totp SET step=? WHERE account_id=?')->execute([$step, $account]);
                    $ok = true;
                }
            } elseif (preg_match('/\A[0-9a-f]{4}-[0-9a-f]{4}\z/', $code)) {
                $hashes = json_decode((string)$row['recovery'], true) ?: [];
                $index = array_search(hash('sha256', $code), $hashes, true);
                if ($index !== false) {
                    $hashes[$index] = null;
                    $this->db->prepare('UPDATE identity_phone_totp SET recovery=? WHERE account_id=?')->execute([json_encode($hashes), $account]);
                    $ok = true;
                }
            }
            $this->db->commit();
            return $ok;
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    private function audit(array $actor, string $action): void
    {
        $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$actor['partner_id'], $actor['account_id'], $action]);
    }
}
