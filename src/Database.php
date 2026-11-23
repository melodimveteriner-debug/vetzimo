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
        $connection = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            $multiStatements => false,
        ]);
        $connection->exec("SET NAMES utf8mb4");
        $connection->exec("SET SESSION time_zone = '+00:00'");
        return $connection;
    }
}
