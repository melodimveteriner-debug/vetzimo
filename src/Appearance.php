<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class Appearance
{
    public const DEFAULT = 'prizma';

    public function __construct(private readonly PDO $db) {}

    public function read(string $key = 'global'): array
    {
        $query = $this->db->prepare('SELECT palette,locked FROM vetnet_appearance WHERE scope_key=?');
        $query->execute([$key]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        $palette = in_array($row['palette'] ?? '', ['orchid','prizma','nebula'], true) ? $row['palette'] : ''; // kaldırılan temalar varsayılana döner
        // Sitenin varsayılan teması Prizma · Işıltı; kişisel kayıtta boş değer "genel temayı izle" anlamına gelir.
        if ($palette === '' && $key === 'global') $palette = self::DEFAULT;
        return ['palette'=>$palette, 'locked'=>(bool)($row['locked'] ?? false)];
    }

    public function save(string $key, object $body): array
    {
        $palette = $body->palette ?? null;
        if (!in_array($palette,['','orchid','prizma','nebula'],true)) {
            throw new RuntimeException('Geçerli bir tema seçin.',422);
        }
        $locked = $key === 'global' && ($body->locked ?? false) === true;
        $query = $this->db->prepare('INSERT INTO vetnet_appearance(scope_key,palette,locked) VALUES(?,?,?) ON DUPLICATE KEY UPDATE palette=VALUES(palette),locked=VALUES(locked)');
        $query->execute([$key,$palette,(int)$locked]);
        return ['palette'=>$palette,'locked'=>$locked];
    }
}
