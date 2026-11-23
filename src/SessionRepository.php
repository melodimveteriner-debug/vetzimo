<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;

/**
 * Validates an existing session. Branch access must still be checked against
 * the current clinic workspace before any records are returned or changed.
 */
final class SessionRepository
{
    public const SESSION_COOKIE = '__Host-vetnet-session';
    public const DEVICE_COOKIE = '__Host-vetnet-device';
    private const IDLE_TIMEOUT = 1800;

    public function __construct(private readonly PDO $database)
    {
    }

    public function resolve(array $cookies, int $now, bool $forUpdate = false): ?array
    {
        $token = $cookies[self::SESSION_COOKIE] ?? null;
        $device = $cookies[self::DEVICE_COOKIE] ?? null;
        if (!$this->isToken($token) || !$this->isToken($device)) {
            return null;
        }

        $tokenHash = base64_encode(hash('sha256', $token, true));
        $deviceHash = base64_encode(hash('sha256', $device, true));
        $query = $this->database->prepare(
            "SELECT s.account_id,s.membership_id,s.expires,s.touched,s.reauth_at,a.kind,
                    a.identifier,c.workspace_id,c.is_owner,m.partner_id,m.role,m.branch_id,
                    m.customer_id,m.modules,m.name,p.name AS partner_name
             FROM identity_session s
             JOIN identity_account a ON a.id=s.account_id
             LEFT JOIN identity_center c ON c.account_id=a.id
             LEFT JOIN identity_membership m ON m.id=s.membership_id AND m.account_id=a.id
             LEFT JOIN partner_account p ON p.id=m.partner_id
             WHERE s.token_hash=? AND s.device_hash=? AND a.blocked=0
               AND a.version=s.account_version AND s.expires>? AND s.touched>?
               AND ((a.kind='center' AND c.account_id IS NOT NULL AND a.totp_seed IS NOT NULL
                     AND s.membership_id IS NULL)
                 OR (a.kind='phone' AND m.status='active' AND p.active=1))"
            . ($forUpdate ? " FOR UPDATE" : "")
        );
        $query->execute([$tokenHash, $deviceHash, $now, $now - self::IDLE_TIMEOUT]);
        $session = $query->fetch();
        if ($session === false) {
            return null;
        }

        if ($now - (int) $session['touched'] > 60) {
            $touch = $this->database->prepare(
                'UPDATE identity_session SET touched=? WHERE token_hash=? AND touched=? AND expires>?'
            );
            $touch->execute([$now, $tokenHash, $session['touched'], $now]);
        }

        return $session;
    }

    private function isToken(mixed $value): bool
    {
        return is_string($value) && preg_match('/\A[a-f0-9]{64}\z/D', $value) === 1;
    }
}
