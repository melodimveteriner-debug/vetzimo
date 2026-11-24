<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class Appearance
{
    public function __construct(private readonly PDO $db) {}

    public function read(string $key = 'global'): array
    {
        $query = $this->db->prepare('SELECT palette,locked FROM vetnet_appearance WHERE scope_key=?');
        $query->execute([$key]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        return ['palette'=>$row['palette'] ?? '', 'locked'=>(bool)($row['locked'] ?? false)];
    }

    public function save(string $key, object $body): array
    {
        $palette = $body->palette ?? null;
        if (!in_array($palette,['','classic','blue','olive','coral','orchid','aurora','dark','midnight'],true)) {
            throw new RuntimeException('Geçerli bir tema seçin.',422);
        }
        $locked = $key === 'global' && ($body->locked ?? false) === true;
        $query = $this->db->prepare('INSERT INTO vetnet_appearance(scope_key,palette,locked) VALUES(?,?,?) ON DUPLICATE KEY UPDATE palette=VALUES(palette),locked=VALUES(locked)');
        $query->execute([$key,$palette,(int)$locked]);
        return ['palette'=>$palette,'locked'=>$locked];
    }
}
