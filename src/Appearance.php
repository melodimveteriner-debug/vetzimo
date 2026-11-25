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

    private const BLUR_ID = '00000000000000000000000000000009';

    /** Genel bakış grafiklerinin bulanıklığı cihaz türüne göre (true = bulanık, "Grafiği göster" ile açılır). Varsayılan: telefonda açık, tablet ve bilgisayarda bulanık. */
    public function chartBlur(): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='chart_blur'");
        $q->execute([self::BLUR_ID]);
        $s = json_decode((string)$q->fetchColumn(), true) ?: [];
        return ['mobile' => ($s['mobile'] ?? false) === true, 'tablet' => ($s['tablet'] ?? true) === true, 'desktop' => ($s['desktop'] ?? true) === true];
    }

    public function saveChartBlur(object $b): array
    {
        $v = ['mobile' => ($b->mobile ?? false) === true, 'tablet' => ($b->tablet ?? false) === true, 'desktop' => ($b->desktop ?? false) === true];
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'chart_blur',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::BLUR_ID, json_encode($v, JSON_THROW_ON_ERROR)]);
        return $v;
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
