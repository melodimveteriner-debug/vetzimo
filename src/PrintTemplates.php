<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class PrintTemplates
{
    private array $defaults;

    public function __construct(private readonly PDO $db)
    {
        $this->defaults = json_decode(file_get_contents(dirname(__DIR__).'/print-defaults.json'), true, 32, JSON_THROW_ON_ERROR);
    }

    public function listing(array $actor, object $state): array
    {
        $dealer = $actor['role'] === 'dealer';
        $modules = ClinicAccess::modules($actor);
        $allowed = array_keys(array_filter($this->defaults['permissions'], static fn ($module) => $dealer || in_array($modules->$module ?? '', ['read','write'], true)));
        if (!$allowed) throw new RuntimeException('Çıktı şablonu erişiminiz yok.', 403);
        $templates = array_column($this->defaults['templates'], null, 'id');
        $query = $this->db->prepare('SELECT id,title,category,body,active FROM clinic_print_template WHERE partner_id=? ORDER BY id');
        $query->execute([$actor['partner_id']]);
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $row['active'] = (bool)$row['active'];
            $row['system'] = isset($templates[$row['id']]);
            $templates[$row['id']] = $row;
        }
        $templates = array_values(array_filter($templates, static fn ($row) => in_array($row['category'], $allowed, true) && ($dealer || $row['active'])));
        $sales = array_map(static function ($sale) {
            $sale = clone $sale;
            $sale->lines = json_decode($sale->items ?? '[]') ?: [];
            return $sale;
        }, $state->sales ?? []);
        $select = static fn (array $rows, string $fields) => array_map(
            static fn ($row) => array_intersect_key((array)$row, array_flip(explode(' ', $fields.' branch'))),
            $rows
        );
        return [
            'templates'=>$templates, 'allowed'=>$allowed, 'canEdit'=>$dealer, 'preview'=>false,
            'scopeId'=>$actor['membership_id'], 'clients'=>$select($state->clients ?? [], 'id name phone email address'), 'patients'=>$select($state->patients ?? [], 'id name owner species breed protocol chip sex birth weight'),
            'products'=>$select($state->products ?? [], 'id name'), 'suppliers'=>$select($state->suppliers ?? [], 'id name'),
            'branches'=>array_map(static fn ($branch) => ['dataId'=>($branch->sharedWith ?? '') ?: $branch->id] + (array)$branch, $state->branches ?? []),
            'records'=>['sale'=>$select($sales, 'id detail client patient date invoice amount paid method publicNotes lines'),'exam'=>$select($state->exams ?? [], 'id title patient date clinician complaint findings assessment plan next'),'stay'=>$select($state->stays ?? [], 'id kind patient start end room'),
                'purchase'=>$state->purchases ?? [],'vaccine'=>array_values(array_filter($state->followups ?? [], static fn ($row) => ($row->kind ?? '') === 'Aşı'))],
            'clinic'=>['name'=>$state->preferences->clinic ?? $actor['name'],'phone'=>$state->preferences->phone ?? '', 'address'=>$state->preferences->address ?? '', 'logo'=>''],
        ];
    }

    public function change(array $actor, string $action, object $body, string $scope, int $now): array
    {
        if ($actor['role'] !== 'dealer' || $scope !== $actor['membership_id'] || $now - (int)$actor['reauth_at'] > 300) {
            throw new RuntimeException('Bayi yöneticisi doğrulaması gerekiyor.', 403);
        }
        $id = $body->id ?? bin2hex(random_bytes(16));
        if (!is_string($id) || !preg_match('/\A[a-zA-Z0-9_-]{1,80}\z/', $id)) throw new RuntimeException('Geçersiz şablon.', 422);
        if ($action === 'delete') {
            if (in_array($id, array_column($this->defaults['templates'], 'id'), true)) throw new RuntimeException('Sistem şablonu yalnızca kapatılabilir.', 422);
            $query = $this->db->prepare('DELETE FROM clinic_print_template WHERE partner_id=? AND id=?');
            $query->execute([$actor['partner_id'],$id]);
            if (!$query->rowCount()) throw new RuntimeException('Şablon bulunamadı.', 404);
        } else {
            $title = $body->title ?? null;
            $text = $body->body ?? null;
            $category = $body->category ?? null;
            if (!is_string($title) || !trim($title) || !preg_match('/\A.{1,120}\z/us', $title) || !is_string($text) || !trim($text) || strlen($text) > 16000 || !is_string($category) || !isset($this->defaults['permissions'][$category])) {
                throw new RuntimeException('Şablon adı, türü ve metni geçersiz.', 422);
            }
            $query = $this->db->prepare('INSERT INTO clinic_print_template(partner_id,id,title,category,body,active) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),category=VALUES(category),body=VALUES(body),active=VALUES(active)');
            $query->execute([$actor['partner_id'],$id,trim($title),$category,$text,(int)(($body->active ?? false) === true)]);
        }
        return ['ok'=>true,'id'=>$id];
    }
}
