<?php
declare(strict_types=1);

namespace VetNet\Cpanel;
require_once __DIR__.'/AppUsage.php';

use PDO;

/**
 * Validates an existing session. Branch access must still be checked against
 * the current clinic workspace before any records are returned or changed.
 */
final class SessionRepository
{
    public const SESSION_COOKIE = '__Host-vetnet-session';
    public const DEVICE_COOKIE = '__Host-vetnet-device';
    // Tüm oturumlar (klinik, bayi, hasta sahibi, merkez; tarayıcı, telefon, tablet, uygulama) 24 saat açık kalır.
    private const IDLE_TIMEOUT = 86400;
    private const CENTER_IDLE_TIMEOUT = 86400;
    /** Kullanıldıkça uzayan oturumun girişten itibaren en uzun ömrü; sonra yeniden giriş istenir. */
    private const MAX_LIFETIME = 30 * 86400;

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
            "SELECT s.account_id,s.membership_id,s.expires,s.touched,s.created,s.reauth_at,a.kind,
                    a.identifier,c.workspace_id,c.is_owner,c.department,m.partner_id,m.role,m.branch_id,
                    m.customer_id,m.modules,m.name,p.name AS partner_name
             FROM identity_session s
             JOIN identity_account a ON a.id=s.account_id
             LEFT JOIN identity_center c ON c.account_id=a.id
             LEFT JOIN identity_membership m ON m.id=s.membership_id AND m.account_id=a.id
             LEFT JOIN partner_account p ON p.id=m.partner_id
             WHERE s.token_hash=? AND s.device_hash=? AND a.blocked=0
               AND a.version=s.account_version AND s.expires>? AND s.touched>IF(a.kind='center',?,?)
               AND ((a.kind='center' AND c.account_id IS NOT NULL AND a.totp_seed IS NOT NULL
                     AND s.membership_id IS NULL)
                 OR (a.kind='phone' AND m.status='active' AND p.active=1))"
            . ($forUpdate ? " FOR UPDATE" : "")
        );
        $query->execute([$tokenHash, $deviceHash, $now, $now - self::CENTER_IDLE_TIMEOUT, $now - self::IDLE_TIMEOUT]);
        $session = $query->fetch();
        if ($session === false) {
            return null;
        }

        if ($now - (int) $session['touched'] > 60) {
            // Oturum kullanıldıkça 24 saat uzar (açık kalan klinik ekranı ertesi gün "erişim yetkiniz yok" demez);
            // girişten itibaren en fazla 30 gün. Tarayıcı çerezi de aynı süreyle yenilenir.
            $expires = max((int) $session['expires'], min((int) $session['created'] + self::MAX_LIFETIME, $now + self::IDLE_TIMEOUT));
            $touch = $this->database->prepare(
                'UPDATE identity_session SET touched=?,expires=? WHERE token_hash=? AND touched=? AND expires>?'
            );
            $touch->execute([$now, $expires, $tokenHash, $session['touched'], $now]);
            if ($touch->rowCount() === 1 && $expires > (int) $session['expires'] && PHP_SAPI !== 'cli' && !headers_sent() && function_exists('sessionCookie')) {
                sessionCookie(self::SESSION_COOKIE, $token, $expires);
                sessionCookie(self::DEVICE_COOKIE, $device, $expires);
            }
            $session['expires'] = $expires;
            // Hasta sahibinin uygulama/portal kullanımı (son kullanım; dakikada en fazla bir kez).
            if (($session['role'] ?? '') === 'customer') AppUsage::record($this->database, (string) $session['membership_id'], (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), $now, false);
        }

        return $session;
    }

    private function isToken(mixed $value): bool
    {
        return is_string($value) && preg_match('/\A[a-f0-9]{64}\z/D', $value) === 1;
    }
}
