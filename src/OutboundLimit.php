<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Dış servis gönderim sınırı (SMTP, WhatsApp Cloud): sağlayıcının saatlik kotası aşılıp hesap askıya alınmasın diye
 * gönderen hesap başına saatlik sayaç. Arka plan kuyrukları (hatırlatma, bildirim) kotanın %80'ini kullanabilir;
 * kalan %20 kullanıcının o an beklediği iletilere (hesap açma, onam, destek yanıtı) ayrılır.
 * Sınır dolunca 429 atılır; kuyruklar iletiyi silmez, bir sonraki saate erteler (veri/ileti kaybı yok).
 */
final class OutboundLimit
{
    public const BACKGROUND_SHARE = 0.8;

    public static function take(PDO $db, string $scope, string $channel, int $hourly, bool $background, ?int $now = null): void
    {
        if ($hourly <= 0) return; // 0 = sınırsız
        $limit = $background ? max(1, (int)floor($hourly * self::BACKGROUND_SHARE)) : $hourly;
        $hour = intdiv($now ?? time(), 3600);
        $sql = 'INSERT INTO outbound_rate(scope,channel,hour,sent) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE sent=IF(sent<?,sent+1,sent)';
        try {
            $q = $db->prepare($sql);
            $q->execute([substr($scope, 0, 64), $channel, $hour, $limit]);
        } catch (PDOException $error) {
            if ($error->getCode() !== '42S02' || $db->inTransaction()) return; // sayaç tablosu yoksa gönderim engellenmez
            self::ensure($db);
            $q = $db->prepare($sql);
            $q->execute([substr($scope, 0, 64), $channel, $hour, $limit]);
        }
        if ($q->rowCount() === 0) {
            throw new RuntimeException('Saatlik gönderim sınırına ulaşıldı; kalan iletiler bir sonraki saatte otomatik gönderilecek.', 429);
        }
        if ($hour % 24 === 0 && random_int(0, 50) === 0) {
            try { $db->prepare('DELETE FROM outbound_rate WHERE hour<?')->execute([$hour - 48]); } catch (PDOException) {}
        }
    }

    /** Bu saatte kullanılan / sınır (yönetim ekranındaki sağlık özeti için). */
    public static function usage(PDO $db, ?int $now = null): array
    {
        try {
            $q = $db->prepare('SELECT scope, channel, sent FROM outbound_rate WHERE hour=? ORDER BY sent DESC LIMIT 20');
            $q->execute([intdiv($now ?? time(), 3600)]);
            return $q->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException) { return []; }
    }

    /** Sonraki saat başı (erteleme zamanı). */
    public static function nextHour(?int $now = null): int
    {
        return (intdiv($now ?? time(), 3600) + 1) * 3600 + random_int(0, 120);
    }

    public static function ensure(PDO $db): void
    {
        $db->exec('CREATE TABLE IF NOT EXISTS outbound_rate (
            scope VARCHAR(64) NOT NULL, channel VARCHAR(16) NOT NULL, hour INT UNSIGNED NOT NULL, sent INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (scope, channel, hour)
        ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin');
    }
}
