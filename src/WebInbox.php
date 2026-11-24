<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/** Klinik uygulaması: web sitesi iletişim mesajları; işlendi işareti ve müşteri kartı bağlantısı. */
final class WebInbox
{
    public function __construct(private readonly PDO $db) {}

    private static function guard(array $actor, bool $write): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true) || !ClinicAccess::allowed($actor, 'clients', $write)) {
            throw new RuntimeException('Web mesajları için müşteri yetkisi gerekir.', 403);
        }
    }

    public function list(array $actor, string $filter): array
    {
        self::guard($actor, false);
        $where = $filter === 'open' ? ' AND handled_at IS NULL' : ($filter === 'done' ? ' AND handled_at IS NOT NULL' : '');
        $q = $this->db->prepare('SELECT id,message,created_at,handled_at,handled_by,client_id FROM clinic_web_inbox WHERE partner_id=?' . $where . ' ORDER BY id DESC LIMIT 200');
        $q->execute([$actor['partner_id']]);
        $items = [];
        while ($row = $q->fetch(PDO::FETCH_ASSOC)) {
            $m = json_decode((string)$row['message'], true) ?: [];
            $items[] = ['id' => (int)$row['id'], 'name' => (string)($m['name'] ?? ''), 'email' => (string)($m['email'] ?? ''), 'phone' => (string)($m['phone'] ?? ''),
                'body' => (string)($m['body'] ?? ''), 'createdAt' => $row['created_at'], 'handledAt' => $row['handled_at'] === null ? null : (int)$row['handled_at'],
                'handledBy' => $row['handled_by'], 'client' => $row['client_id']];
        }
        $c = $this->db->prepare('SELECT COUNT(*) FROM clinic_web_inbox WHERE partner_id=? AND handled_at IS NULL');
        $c->execute([$actor['partner_id']]);
        return ['items' => $items, 'open' => (int)$c->fetchColumn()];
    }

    public function update(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $id = $input->id ?? null;
        if (!is_int($id) || $id < 1) throw new RuntimeException('Mesaj bulunamadı.', 404);
        $action = $input->action ?? '';
        $name = mb_substr((string)($actor['name'] ?? ''), 0, 120, 'UTF-8');
        if ($action === 'handle') {
            $q = $this->db->prepare('UPDATE clinic_web_inbox SET handled_at=?,handled_by=? WHERE partner_id=? AND id=? AND handled_at IS NULL');
            $q->execute([$now, $name, $actor['partner_id'], $id]);
        } elseif ($action === 'reopen') {
            $q = $this->db->prepare("UPDATE clinic_web_inbox SET handled_at=NULL,handled_by='' WHERE partner_id=? AND id=?");
            $q->execute([$actor['partner_id'], $id]);
        } elseif ($action === 'link') {
            $client = $input->client ?? '';
            if (!is_string($client) || ($client !== '' && !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $client))) throw new RuntimeException('Müşteri bilgisi geçersiz.', 422);
            if ($client !== '') {
                $state = (new ClinicRecords($this->db))->slice('partner:' . $actor['partner_id'], ['clients' => [$client]]);
                if (!$state || !$state->clients) throw new RuntimeException('Müşteri bulunamadı.', 404);
            }
            $q = $this->db->prepare('UPDATE clinic_web_inbox SET client_id=? WHERE partner_id=? AND id=?');
            $q->execute([$client, $actor['partner_id'], $id]);
        } else {
            throw new RuntimeException('İşlem geçersiz.', 422);
        }
        return ['ok' => true];
    }
}
