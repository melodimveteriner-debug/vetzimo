<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

require_once __DIR__ . '/CronGuard.php';
require_once __DIR__ . '/OutboundLimit.php';
require_once __DIR__ . '/ColdStorage.php';

use PDO;
use PDOException;

/**
 * Sistem sağlığı: barındırma kotalarını (PHP bellek/süre, veritabanı bağlantısı, disk), zamanlanmış görevleri,
 * dış gönderim kotasını ve büyüyen klinikleri tek ekranda gösterir; sınır yaklaşmadan uyarır ve ne yapılacağını söyler.
 * Yalnız okur; hiçbir ayarı değiştirmez.
 */
final class SystemHealth
{
    /** Görev adı => beklenen en uzun çalışma aralığı (sn). */
    private const JOBS = ['appointment-reminders'=>1800, 'home-visit-mail'=>1800, 'web-builder-mail'=>1800, 'app-push'=>1800,
        'inbox-poll'=>3600, 'center-analytics'=>7200, 'subscription-reminders'=>90000, 'expire-access-records'=>90000];

    public function __construct(private readonly PDO $db, private readonly string $root) {}

    /** @return array{checks:list<array<string,string>>,jobs:list<array<string,mixed>>,clinics:list<array<string,mixed>>,outbound:list<array<string,mixed>>,generated:int} */
    public function report(?int $now = null): array
    {
        $now ??= time();
        $checks = [];
        $add = static function (string $label, string $value, string $level, string $advice) use (&$checks): void {
            $checks[] = ['label'=>$label, 'value'=>$value, 'level'=>$level, 'advice'=>$advice];
        };

        // PHP
        $memory = self::bytes((string)ini_get('memory_limit'));
        $raisable = $memory >= 0 && self::canRaise();
        $add('PHP bellek sınırı (memory_limit)', $memory < 0 ? 'sınırsız' : (int)($memory >> 20).' MB',
            $memory < 0 || $memory >= 512 << 20 || $raisable ? 'ok' : ($memory >= 256 << 20 ? 'warn' : 'bad'),
            $raisable ? 'Yazılım büyük işlemlerde belleği kendisi artırabiliyor.' : 'cPanel › PHP seçenekleri › memory_limit en az 512M yapın.');
        $time = (int)ini_get('max_execution_time');
        $add('PHP süre sınırı (max_execution_time)', $time === 0 ? 'sınırsız' : $time.' sn', $time === 0 || $time >= 120 ? 'ok' : ($time >= 60 ? 'warn' : 'bad'),
            'Büyük aktarım ve yedekler için en az 120 saniye önerilir.');
        $upload = min(self::bytes((string)ini_get('upload_max_filesize')), self::bytes((string)ini_get('post_max_size')));
        $add('Yükleme sınırı (upload/post_max_size)', $upload < 0 ? 'sınırsız' : (int)($upload >> 20).' MB', $upload < 0 || $upload >= 16 << 20 ? 'ok' : 'warn',
            'Veri aktarımı parçaları için en az 16 MB önerilir.');
        $missing = array_values(array_filter(['curl','mbstring','pdo_mysql','openssl','zlib','json'], static fn($e) => !extension_loaded($e)));
        $add('PHP uzantıları', $missing ? implode(', ', $missing).' eksik' : 'tam', $missing ? 'bad' : 'ok', 'cPanel › PHP uzantılarından eksik olanları açın.');

        // Veritabanı
        $vars = $this->pairs("SHOW VARIABLES WHERE Variable_name IN ('max_connections','max_user_connections','innodb_buffer_pool_size','max_allowed_packet')");
        $stat = $this->pairs("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Max_used_connections')");
        $max = (int)($vars['max_user_connections'] ?? 0) ?: (int)($vars['max_connections'] ?? 0);
        $peak = (int)($stat['Max_used_connections'] ?? 0);
        if ($max > 0) {
            $ratio = $peak / $max;
            $add('Veritabanı bağlantı sınırı', $peak.' / '.$max.' (en yüksek kullanım)', $ratio < 0.7 ? 'ok' : ($ratio < 0.9 ? 'warn' : 'bad'),
                $max < 100 ? 'Paylaşımlı hosting bağlantı sınırı düşük; yoğunlukta "Sunucu meşgul" yanıtı ve otomatik yeniden deneme olur. Ayrı sunucuda 500+ önerilir.' : 'Yoğun saatlerde en yüksek kullanımı izleyin.');
        }
        $packet = (int)($vars['max_allowed_packet'] ?? 0);
        if ($packet) $add('Veritabanı paket sınırı (max_allowed_packet)', (int)($packet >> 20).' MB', $packet >= 16 << 20 ? 'ok' : 'warn', 'Büyük kayıtlar için en az 16 MB önerilir.');
        $pool = (int)($vars['innodb_buffer_pool_size'] ?? 0);
        $size = $this->scalar("SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema=DATABASE()");
        if ($size !== null) {
            $add('Veritabanı boyutu', self::human((int)$size), $pool && $pool < (int)$size / 10 ? 'warn' : 'ok',
                $pool ? 'Önbellek (innodb_buffer_pool_size) '.self::human($pool).'; veritabanının en az %10–25\'i önerilir.' : 'Veri büyüdükçe önbellek boyutunu izleyin.');
        }

        // Disk
        $free = @disk_free_space($this->root);
        if ($free !== false) $add('Boş disk alanı', self::human((int)$free), $free > 5 * (1 << 30) ? 'ok' : ($free > 1 << 30 ? 'warn' : 'bad'),
            'Yedekler ve veri büyümesi için en az 5 GB boş alan önerilir.');

        // Zamanlanmış görevler
        $jobs = CronGuard::report($this->db);
        $known = array_column($jobs, null, 'job');
        foreach (self::JOBS as $job => $interval) {
            $row = $known[$job] ?? null;
            if (!$row) { $add('Zamanlanmış görev: '.$job, 'hiç çalışmadı', 'warn', 'cPanel › Cron işlerine bu görevi ekleyin (kurulum rehberindeki satır).'); continue; }
            $last = (int)($row['finished_at'] ?? 0) ?: (int)$row['started_at'];
            $late = $now - $last > 2 * $interval;
            $stuck = $row['status'] === 'running' && $now - (int)$row['started_at'] > 3600;
            $add('Zamanlanmış görev: '.$job, ($row['status'] === 'error' ? 'hata · ' : '').date('d.m.Y H:i', $last).(isset($row['seconds']) ? ' · '.$row['seconds'].' sn' : ''),
                $row['status'] === 'error' || $stuck ? 'bad' : ($late ? 'warn' : 'ok'),
                $stuck ? 'Görev bir saattir bitmedi; sunucu süre sınırını ve hata günlüğünü kontrol edin.' : ($late ? 'Görev beklenenden uzun süredir çalışmadı; cron ayarını kontrol edin.' : ($row['status'] === 'error' ? 'Son çalışma hata verdi; hata günlüğünü kontrol edin.' : 'Düzenli çalışıyor.')));
        }

        // Büyüyen klinikler (arşiv eşiği ve tarayıcı yükü)
        $clinics = [];
        try {
            // Sayılar Gelişmiş Panel önbelleğinden okunur (tüm kayıt tablosu taranmaz); önbellek zamanlanmış görevle tazelenir.
            $q = $this->db->query("SELECT s.workspace_id, CAST(JSON_EXTRACT(a.payload,'$.records') AS UNSIGNED) AS records
                FROM center_analytics_set a JOIN clinic_record_set s ON s.id=a.set_id
                WHERE JSON_EXTRACT(a.payload,'$.records')>".(ColdStorage::THRESHOLD / 2)." ORDER BY records DESC LIMIT 10");
            $names = $this->db->prepare('SELECT name FROM partner_account WHERE id=?');
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $names->execute([substr((string)$row['workspace_id'], 8)]);
                $clinics[] = ['name'=>(string)($names->fetchColumn() ?: $row['workspace_id']), 'records'=>(int)$row['records'],
                    'archive'=>(int)$row['records'] > ColdStorage::THRESHOLD];
            }
        } catch (PDOException) {}
        $largest = $clinics[0]['records'] ?? 0;
        $add('En büyük klinik', $clinics ? number_format($largest, 0, ',', '.').' kayıt' : 'eşiğin altında', $largest < 250000 ? 'ok' : ($largest < 500000 ? 'warn' : 'bad'),
            'Büyük kliniklerde 2 yıldan eski ve işi bitmiş kayıtlar arşivde tutulur; tarayıcıya yalnız güncel veri gider.');

        return ['checks'=>$checks, 'jobs'=>$jobs, 'clinics'=>$clinics, 'outbound'=>OutboundLimit::usage($this->db, $now), 'generated'=>$now];
    }

    private function pairs(string $sql): array
    {
        try { return $this->db->query($sql)->fetchAll(PDO::FETCH_KEY_PAIR); } catch (PDOException) { return []; }
    }

    private function scalar(string $sql): ?string
    {
        try { $v = $this->db->query($sql)->fetchColumn(); return $v === false ? null : (string)$v; } catch (PDOException) { return null; }
    }

    private static function canRaise(): bool
    {
        $before = (string)ini_get('memory_limit');
        $ok = @ini_set('memory_limit', '1024M') !== false && self::bytes((string)ini_get('memory_limit')) >= 1024 << 20;
        @ini_set('memory_limit', $before);
        return $ok;
    }

    public static function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '-1') return -1;
        $n = (int)$value;
        return match (strtolower(substr($value, -1))) { 'g'=>$n << 30, 'm'=>$n << 20, 'k'=>$n << 10, default=>$n };
    }

    private static function human(int $bytes): string
    {
        foreach (['GB'=>30, 'MB'=>20, 'KB'=>10] as $unit => $shift) if ($bytes >= 1 << $shift) return number_format($bytes / (1 << $shift), 1, ',', '.').' '.$unit;
        return $bytes.' B';
    }
}
