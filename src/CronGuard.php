<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;

/**
 * Zamanlanmış görev koruması: aynı görev iki kez üst üste çalışmaz (veritabanı kilidi; birden çok sunucuda da geçerli),
 * her çalışma süresi ve sonucuyla kaydedilir. Merkez › Sistem sağlığı ekranı bu kayıtlardan "görev gecikti / hata verdi"
 * uyarısı üretir. Görev ölümcül hatayla dursa bile kapanış kaydı yazılır.
 */
final class CronGuard
{
    private static ?PDO $db = null;
    private static string $job = '';
    private static float $started = 0;
    private static bool $done = false;

    /** Kilit alınamazsa (önceki çalışma sürüyor) süreç sessizce çıkar. */
    public static function begin(PDO $db, string $job): void
    {
        $lock = $db->prepare('SELECT GET_LOCK(?,0)');
        $lock->execute(['vetzimo-cron-'.$job.'-'.substr(md5((string)$db->query('SELECT DATABASE()')->fetchColumn()), 0, 8)]);
        if ((int)$lock->fetchColumn() !== 1) exit(0);
        self::$db = $db; self::$job = $job; self::$started = microtime(true); self::$done = false;
        self::write('running', null);
        register_shutdown_function(static function (): void {
            if (self::$done || !self::$db) return;
            $error = error_get_last();
            $fatal = $error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true);
            self::finish($fatal ? 'error' : 'ok', $fatal ? 'Ölümcül hata: '.mb_substr((string)$error['message'], 0, 200) : null);
        });
    }

    public static function finish(string $status = 'ok', ?string $detail = null): void
    {
        if (!self::$db || self::$done) return;
        self::$done = true;
        self::write($status, $detail);
    }

    /** @return list<array<string,mixed>> */
    public static function report(PDO $db): array
    {
        try {
            return $db->query('SELECT job, started_at, finished_at, seconds, status, runs, failures, last_error FROM cron_heartbeat ORDER BY job')->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException) { return []; }
    }

    private static function write(string $status, ?string $detail): void
    {
        $db = self::$db; $now = time(); $seconds = round(microtime(true) - self::$started, 2);
        $sql = $status === 'running'
            ? 'INSERT INTO cron_heartbeat(job,started_at,status,runs) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE started_at=VALUES(started_at),status=VALUES(status),runs=runs+1'
            : 'UPDATE cron_heartbeat SET finished_at=?,seconds=?,status=?,failures=failures+?,last_error=COALESCE(?,last_error) WHERE job=?';
        $args = $status === 'running' ? [self::$job, $now, $status] : [$now, $seconds, $status, $status === 'ok' ? 0 : 1, $detail, self::$job];
        try {
            if ($db->inTransaction()) $db->rollBack();
            $db->prepare($sql)->execute($args);
        } catch (PDOException $error) {
            if ($error->getCode() !== '42S02') return;
            try {
                $db->exec('CREATE TABLE IF NOT EXISTS cron_heartbeat (job VARCHAR(60) NOT NULL PRIMARY KEY, started_at INT UNSIGNED NOT NULL,
                    finished_at INT UNSIGNED NULL, seconds DECIMAL(10,2) NULL, status VARCHAR(12) NOT NULL, runs INT UNSIGNED NOT NULL DEFAULT 0,
                    failures INT UNSIGNED NOT NULL DEFAULT 0, last_error VARCHAR(255) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
                $db->prepare($sql)->execute($args);
            } catch (PDOException) {}
        }
    }
}
