<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Veritabanı sürüm yönetimi.
 *
 * database/schema.sql      : ilk kurulumdaki temel yapı
 * database/migrations/*.sql: sonradan eklenen değişiklikler (dosya adına göre sırayla)
 *
 * Uygulanan her değişiklik schema_migration tablosuna yazılır; ikinci kez çalıştırılmaz.
 * Dosyalardaki ifadeler ';' ile ayrılır, bu yüzden metin değerleri içinde ';' kullanılmamalıdır.
 */
final class Migrations
{
    public function __construct(private readonly PDO $db, private readonly string $root) {}

    /** @return list<string> */
    public function files(): array
    {
        $files = glob($this->root.'/database/migrations/*.sql') ?: [];
        sort($files, SORT_STRING);
        return $files;
    }

    /** @return list<string> uygulanmamış değişikliklerin adları */
    public function pending(): array
    {
        $this->ensureTable();
        $done = $this->db->query('SELECT name FROM schema_migration')->fetchAll(PDO::FETCH_COLUMN);
        $done = array_flip($done);
        return array_values(array_filter(array_map('basename', $this->files()), static fn($name) => !isset($done[$name])));
    }

    /** Boş veritabanına temel yapıyı ve tüm değişiklikleri kurar. */
    public function installFresh(): void
    {
        $this->runFile($this->root.'/database/schema.sql');
        $this->ensureTable();
        $this->apply();
    }

    /** @return list<string> bu çağrıda uygulanan değişiklikler */
    public function apply(): array
    {
        $lock = 'vetzimo-migrate-'.substr(hash('sha256', (string)$this->db->query('SELECT DATABASE()')->fetchColumn()), 0, 32);
        $query = $this->db->prepare('SELECT GET_LOCK(?, 10)');
        $query->execute([$lock]);
        if ((int)$query->fetchColumn() !== 1) throw new RuntimeException('Başka bir veritabanı güncellemesi sürüyor.', 409);
        try {
            $applied = [];
            $record = $this->db->prepare('INSERT INTO schema_migration(name,applied_at) VALUES (?,?)');
            foreach ($this->pending() as $name) {
                // DDL ifadeleri MySQL'de otomatik commit olur; yarıda kalan bir değişiklik
                // elle incelenmelidir, otomatik geri alınmaz.
                $this->runFile($this->root.'/database/migrations/'.$name);
                $record->execute([$name, gmdate('Y-m-d H:i:s')]);
                $applied[] = $name;
            }
            return $applied;
        } finally {
            $this->db->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);
        }
    }

    private function ensureTable(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS schema_migration (
            name varchar(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            applied_at datetime NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    }

    private function runFile(string $file): void
    {
        $sql = file_get_contents($file);
        if ($sql === false) throw new RuntimeException('Veritabanı dosyası okunamadı: '.basename($file), 503);
        foreach (explode(';', $sql) as $statement) {
            $lines = array_filter(explode("\n", $statement), static fn($line) => !str_starts_with(ltrim($line), '--'));
            $statement = trim(implode("\n", $lines));
            if ($statement !== '') $this->db->exec($statement);
        }
    }
}
