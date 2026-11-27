<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;

final class Database
{
    public static function connect(string $dsn, string $username, string $password): PDO
    {
        if (!str_starts_with($dsn, 'mysql:')) {
            throw new \InvalidArgumentException('A MySQL PDO connection is required.');
        }

        $multiStatements = PHP_VERSION_ID >= 80400 ? \Pdo\Mysql::ATTR_MULTI_STATEMENTS : PDO::MYSQL_ATTR_MULTI_STATEMENTS;
        try {
            $connection = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            $multiStatements => false,
            ]);
        } catch (\PDOException $error) {
            // Yoğunlukta bağlantı sınırı (1040 / 1203 max_user_connections) dolarsa anlamsız 500 yerine tekrar denenebilir 503.
            if (in_array((int)($error->errorInfo[1] ?? $error->getCode()), [1040, 1203], true) || str_contains($error->getMessage(), 'Too many connections') || str_contains($error->getMessage(), 'max_user_connections')) {
                if (PHP_SAPI !== 'cli' && !headers_sent()) header('Retry-After: 2');
                throw new \RuntimeException('Sunucu şu anda çok yoğun. Birkaç saniye içinde yeniden deneyin.', 503);
            }
            throw $error;
        }
        $connection->exec("SET NAMES utf8mb4");
        $connection->exec("SET SESSION time_zone = '+00:00'");
        return $connection;
    }
}
