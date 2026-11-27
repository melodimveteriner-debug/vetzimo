<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;

/**
 * Satır düzeyinde değişiklik günlüğü (klinik başına tek sürüm sayacının darboğazını kaldırır).
 *
 * Her kayıt yazımı, gerçekten değişen satırları (içerik özeti farklı olan, eklenen, silinen) revizyonuyla birlikte
 * aynı veritabanı işleminde günlüğe yazar. Eski bir revizyona dayanan kısmi kayıt geldiğinde aradaki revizyonların
 * değiştirdiği satırlarla kesişmiyorsa güvenle güncel revizyona taşınır; kesişiyorsa (aynı satır) 409 korunur.
 * Günlüğü olmayan veya eksik bir revizyon varsa taşıma yapılmaz (temkinli: veri kaybı mümkün değil).
 */
final class ClinicChanges
{
    /** Tüm koleksiyon değişti (veya çok fazla satır): satır bazında birleştirme yapılmaz. */
    public const ALL = '*';
    /** Taşınabilecek en uzun aralık (revizyon). */
    public const WINDOW = 200;
    /** Bir yazımda bundan fazla satır değişirse koleksiyon "tümü" olarak işaretlenir. */
    private const ROW_LIMIT = 3000;

    /** @var array<string,array<string,true>> */
    private static array $pending = [];

    public static function reset(): void { self::$pending = []; }

    public static function row(string $collection, string $rowKey): void
    {
        if (isset(self::$pending[$collection][self::ALL])) return;
        $id = str_starts_with($rowKey, '@') ? substr($rowKey, 1) : self::ALL;
        if ($id === self::ALL) { self::$pending[$collection] = [self::ALL => true]; return; }
        self::$pending[$collection][$id] = true;
        if (count(self::$pending[$collection]) > self::ROW_LIMIT) self::$pending[$collection] = [self::ALL => true];
    }

    public static function all(string $collection): void { self::$pending[$collection] = [self::ALL => true]; }

    /** @return array<string,array<string,true>> */
    public static function take(): array { $out = self::$pending; self::$pending = []; return $out; }

    /** İşlem (transaction) dışında çağrılmalı. */
    public static function ensure(PDO $db): void
    {
        $db->exec('CREATE TABLE IF NOT EXISTS clinic_change_log (
            workspace_id VARCHAR(120) NOT NULL, revision INT UNSIGNED NOT NULL, collection VARCHAR(40) NOT NULL, record_id VARCHAR(80) NOT NULL,
            PRIMARY KEY (workspace_id, revision, collection, record_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    /** Toplanan değişiklikleri revizyona yazar. Tablo yoksa sessizce atlar (yalnız otomatik taşıma kapanır). */
    public static function write(PDO $db, string $workspace, int $revision, array $changes): void
    {
        try {
            $insert = $db->prepare('INSERT IGNORE INTO clinic_change_log(workspace_id,revision,collection,record_id) VALUES (?,?,?,?)');
            if (!$changes) $insert->execute([$workspace, $revision, '', '']);
            foreach ($changes as $collection => $ids) foreach (array_keys($ids) as $id) {
                $insert->execute([$workspace, $revision, substr((string)$collection, 0, 40), substr((string)$id, 0, 80)]);
            }
            if ($revision % 50 === 0) {
                $db->prepare('DELETE FROM clinic_change_log WHERE workspace_id=? AND revision<?')->execute([$workspace, $revision - 2 * self::WINDOW]);
            }
        } catch (PDOException $error) {
            if ($error->getCode() !== '42S02') throw $error;
        }
    }

    /**
     * ($from, $to] aralığındaki tüm değişiklikler; aralıkta günlüğü olmayan revizyon varsa null.
     * @return array<string,array<string,true>>|null
     */
    public static function between(PDO $db, string $workspace, int $from, int $to): ?array
    {
        if ($to <= $from || $to - $from > self::WINDOW) return null;
        try {
            $q = $db->prepare('SELECT revision, collection, record_id FROM clinic_change_log WHERE workspace_id=? AND revision>? AND revision<=?');
            $q->execute([$workspace, $from, $to]);
            $rows = $q->fetchAll(PDO::FETCH_NUM);
        } catch (PDOException) { return null; }
        $seen = []; $out = [];
        foreach ($rows as [$revision, $collection, $id]) {
            $seen[$revision] = true;
            if ($collection === '') continue;
            if ($id === self::ALL) $out[$collection] = [self::ALL => true];
            elseif (!isset($out[$collection][self::ALL])) $out[$collection][$id] = true;
        }
        return count($seen) === $to - $from ? $out : null;
    }

    /**
     * Yama, aradaki değişikliklerle çakışıyor mu? Etkinlik günlüğü (activity) birleştirilir, çakışma sayılmaz.
     * Yeni satır eklemek (prepend/append) yalnız aynı kimlik eklenmişse çakışır.
     */
    public static function conflicts(object $patch, array $changed): bool
    {
        // Bir listenin tamamı değiştiyse (toplu aktarım vb.) istemci satır satır eşitlenemez: taşıma yapılmaz.
        foreach ($changed as $collection => $ids) {
            if (isset($ids[self::ALL]) && $collection !== 'activity' && in_array($collection, ClinicRecords::COLLECTIONS, true)) return true;
        }
        foreach ($patch as $collection => $ops) {
            if ($collection === 'activity' || !isset($changed[$collection])) continue;
            if (!$ops instanceof \stdClass || property_exists($ops, 'replace')) return true;
            $all = isset($changed[$collection][self::ALL]);
            foreach (['update','prepend','append'] as $kind) foreach ((array)($ops->$kind ?? []) as $row) {
                if (!is_object($row)) return true;
                if ($kind === 'update' && $all) return true;
                if (isset($changed[$collection][(string)($row->id ?? '')])) return true;
            }
        }
        return false;
    }
}
