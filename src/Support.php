<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

require_once __DIR__ . '/SupportAttachments.php';

final class Support
{
    public function __construct(private readonly PDO $db) {}

    public function handle(array $actor, array $branches, bool $owner, ?string $id, ?object $input, int $limit, array $files=[], ?string $download=null, bool $native=false): array
    {
        $grant = ClinicAccess::modules($actor)->support ?? '';
        if ($native && !$owner && !in_array($actor['role'],['dealer','branch','staff'],true)) throw new RuntimeException('Destek erişiminiz yok.',403);
        if (!$owner && $actor['role'] !== 'dealer' && !in_array($grant, $input ? ['write'] : ['read','write'], true)) {
            throw new RuntimeException('Destek erişiminiz yok.',403);
        }
        $where = $owner ? '1=1' : 't.partner_id=?';
        $params = $owner ? [] : [$actor['partner_id']];
        if (!$owner && $actor['role'] !== 'dealer') {
            $where .= ' AND t.branch=?';
            $params[] = $actor['branch_id'];
        }
        if ($id !== null) {
            $where .= ' AND t.id=?';
            $params[] = $id;
        }
        if (!$input || $id !== null) {
            $sql = "SELECT t.*,p.name AS partner_name,
                (SELECT r.author FROM clinic_support_reply r WHERE r.ticket_id=t.id ORDER BY r.id LIMIT 1) AS author,
                (SELECT COUNT(*) FROM clinic_support_reply r WHERE r.ticket_id=t.id) AS reply_count,
                (SELECT MAX(r.created_at) FROM clinic_support_reply r WHERE r.ticket_id=t.id) AS last_reply_at
                FROM clinic_support t JOIN partner_account p ON p.id=t.partner_id WHERE $where
                ORDER BY t.updated_at DESC,t.id LIMIT ".($id ? 1 : $limit);
            if ($input) $sql .= ' FOR UPDATE';
            $query = $this->db->prepare($sql);
            $query->execute($params);
            if ($id === null) return ['tickets'=>$query->fetchAll(PDO::FETCH_ASSOC),'branches'=>$branches,'owner'=>$owner,'attachments'=>true,
                ...($native?['canCreate'=>!$owner && ($actor['role']==='dealer'||$grant==='write')]:[])];
            $ticket = $query->fetch(PDO::FETCH_ASSOC);
            if (!$ticket) throw new RuntimeException('Destek talebi bulunamadı.',404);
            if (!$input) {
                if ($download!==null) SupportAttachments::download($this->db,$id,$download);
                $select='SELECT id,author,side,body,created_at,0 AS has_photo FROM clinic_support_reply WHERE ticket_id=?';
                $replies = $this->db->prepare($select.($native?' ORDER BY id DESC LIMIT 60':' ORDER BY id'));
                $replies->execute([$id]);
                if ($native) return ['ticket'=>$ticket,'replies'=>array_reverse($replies->fetchAll(PDO::FETCH_ASSOC)),
                    'canReply'=>($owner||$actor['role']==='dealer'||$grant==='write') && $ticket['status']==='Açık'];
                $attachments=$this->db->prepare('SELECT a.id,a.reply_id,a.name,a.size_bytes FROM clinic_support_attachment a
                    JOIN clinic_support_reply r ON r.id=a.reply_id WHERE r.ticket_id=? ORDER BY a.id');
                $attachments->execute([$id]);
                $byReply=[];
                foreach ($attachments->fetchAll(PDO::FETCH_ASSOC) as $file) $byReply[$file['reply_id']][]=$file;
                $messages=$replies->fetchAll(PDO::FETCH_ASSOC);
                foreach ($messages as &$message) $message['files']=$byReply[$message['id']]??[];
                unset($message);
                return ['ticket'=>$ticket,'replies'=>$messages,'owner'=>$owner,'attachments'=>true];
            }
        }
        $now = gmdate('c');
        if ($id !== null && ($input->action ?? '') === 'close') {
            $this->db->prepare("UPDATE clinic_support SET status='Çözüldü',updated_at=? WHERE id=?")->execute([$now,$id]);
            return ['ok'=>true];
        }
        if (!empty($input->photo)) throw new RuntimeException('Bu kurulumda destek taleplerine dosya ekleme kapalı.',422);
        $body = $this->requiredText($input->body ?? null,5000);
        if ($id === null) {
            if ($owner) throw new RuntimeException('Bayi adına talep açılamaz.',403);
            $branch = null;
            foreach ($branches as $candidate) {
                if ($candidate->id === ($input->branch ?? null) && ($candidate->status ?? '') !== 'Pasif') $branch = $candidate;
            }
            $subject = $this->requiredText($input->subject ?? null,160);
            if (!$branch || !in_array($input->department ?? '', ['Muhasebe','Satış','Destek / Yazılım'], true) ||
                !in_array($input->urgency ?? '', ['Düşük','Orta','Yüksek'], true)) throw new RuntimeException('Şube, departman ve aciliyeti kontrol edin.',422);
            $id = bin2hex(random_bytes(16));
            $this->db->prepare('INSERT INTO clinic_support(id,partner_id,branch,branch_name,subject,department,urgency,updated_at) VALUES(?,?,?,?,?,?,?,?)')
                ->execute([$id,$actor['partner_id'],$branch->id,$branch->name,$subject,$input->department,$input->urgency,$now]);
        } elseif ($ticket['status'] !== 'Açık') {
            throw new RuntimeException('Bu konuşma kapatıldı.',409);
        }
        $this->db->prepare('INSERT INTO clinic_support_reply(ticket_id,author,side,body,created_at) VALUES(?,?,?,?,?)')
            ->execute([$id,$owner ? 'Merkez Yönetimi' : $actor['name'],$owner ? 'Yönetim' : 'Bayi',$body,$now]);
        if ($files) {
            $reply=$this->db->lastInsertId();
            $attach=$this->db->prepare('INSERT INTO clinic_support_attachment(id,reply_id,name,bytes,size_bytes) VALUES (?,?,?,?,?)');
            foreach ($files as $file) $attach->execute([bin2hex(random_bytes(16)),$reply,...$file]);
        }
        $this->db->prepare('UPDATE clinic_support SET updated_at=? WHERE id=?')->execute([$now,$id]);
        return ['ok'=>true,'id'=>$id];
    }

    /**
     * Klinik kullanıcısının okumadığı merkez yanıtları.
     * GET: {count, rows:[{ticket,subject,unread}]}  ·  POST {ticket}: bileti okundu işaretler.
     */
    public function notices(array $actor, ?object $input): array
    {
        $grant = ClinicAccess::modules($actor)->support ?? '';
        if ($actor['role'] !== 'dealer' && !in_array($grant, ['read','write'], true)) return ['count'=>0,'rows'=>[]];
        $where = 't.partner_id=?';
        $params = [$actor['partner_id']];
        if ($actor['role'] !== 'dealer') {
            $where .= ' AND t.branch=?';
            $params[] = $actor['branch_id'];
        }
        if ($input !== null) {
            $ticket = $input->ticket ?? null;
            if (!is_string($ticket) || !preg_match('/\A[0-9a-f]{32}\z/', $ticket)) throw new RuntimeException('Destek talebi geçersiz.', 422);
            $last = $this->db->prepare("SELECT MAX(r.id) FROM clinic_support t JOIN clinic_support_reply r ON r.ticket_id=t.id WHERE $where AND t.id=?");
            $last->execute([...$params, $ticket]);
            $id = $last->fetchColumn();
            if ($id) {
                $this->db->prepare('INSERT INTO clinic_support_read(membership_id,ticket_id,last_reply_id) VALUES (?,?,?)
                    ON DUPLICATE KEY UPDATE last_reply_id=GREATEST(last_reply_id,VALUES(last_reply_id))')
                    ->execute([$actor['membership_id'], $ticket, $id]);
            }
            return ['ok'=>true];
        }
        $query = $this->db->prepare("SELECT t.id AS ticket, t.subject FROM clinic_support t
            LEFT JOIN clinic_support_read s ON s.ticket_id=t.id AND s.membership_id=?
            WHERE $where AND EXISTS (SELECT 1 FROM clinic_support_reply r
                WHERE r.ticket_id=t.id AND r.side='Yönetim' AND r.id>COALESCE(s.last_reply_id,0))
            ORDER BY t.updated_at DESC LIMIT 50");
        $query->execute([$actor['membership_id'], ...$params]);
        $rows = array_map(static fn($row) => ['ticket'=>$row['ticket'],'subject'=>$row['subject'],'unread'=>true], $query->fetchAll(PDO::FETCH_ASSOC));
        return ['count'=>count($rows),'rows'=>$rows];
    }

    private function requiredText(mixed $value, int $length): string
    {
        if (!is_string($value) || !preg_match('/\A.{1,'.$length.'}\z/us',trim($value))) {
            throw new RuntimeException('Zorunlu metin eksik veya çok uzun.',422);
        }
        return trim($value);
    }
}
