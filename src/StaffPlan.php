<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

final class StaffPlan
{
    public function __construct(private readonly PDO $db) {}

    private function query(string $sql, array $params): \PDOStatement
    {
        $stmt=$this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    private static function date(mixed $value,string $format): DateTimeImmutable
    {
        $time=is_string($value)?DateTimeImmutable::createFromFormat('!'.$format,$value,new DateTimeZone('Europe/Istanbul')):false;
        if (!$time || $time->format($format)!==$value || (int)$time->format('Y')<2000 || (int)$time->format('Y')>2200) {
            throw new RuntimeException('Geçerli bir tarih ve saat seçin.',422);
        }
        return $time;
    }

    private static function checkRole(array $actor): void
    {
        if (!in_array($actor['role']??'',['dealer','branch','staff'],true)) {
            throw new RuntimeException('Bu bölüm için yetkiniz yok',403);
        }
    }

    public function week(array $actor,mixed $day,mixed $cursor=''): array
    {
        self::checkRole($actor);
        $monday=self::date($day,'Y-m-d')->modify('monday this week');
        $from=$monday->format('Y-m-d');
        $until=$monday->modify('+7 days')->format('Y-m-d');
        $manager=$actor['role']==='dealer';
        $params=[$actor['partner_id']];
        $staffFilter=$manager?'':' AND m.id=?';
        if (!$manager) $params[]=$actor['membership_id'];
        $members=$this->query("SELECT m.id,m.branch_id,m.name FROM identity_membership m JOIN identity_account a ON a.id=m.account_id
            WHERE m.partner_id=? AND a.blocked=0 AND m.role IN ('staff','branch') AND m.status='active'".$staffFilter." ORDER BY m.name,m.id",$params)->fetchAll(PDO::FETCH_ASSOC);
        $params=[$actor['partner_id'],$monday->modify('-366 days')->format('Y-m-d'),$until,$from];
        if (!$manager) $params[]=$actor['membership_id'];
        $continuation = '';
        if ($cursor !== '') {
            if (!is_string($cursor) || !preg_match('/\A(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)~([1-9][0-9]{0,19})\z/D', $cursor, $match)) {
                throw new RuntimeException('İşlem geçersiz.',422);
            }
            $continuation = ' AND (p.starts>? OR (p.starts=? AND p.id>?))';
            array_push($params, $match[1], $match[1], $match[2]);
        }
        $rows=$this->query("SELECT p.id,p.member_id,p.branch_id,p.kind,p.status,p.starts,p.ends,m.name FROM clinic_staff_plan p
            JOIN identity_membership m ON m.id=p.member_id AND m.partner_id=p.partner_id
            WHERE p.partner_id=? AND p.starts>=? AND p.starts<? AND p.ends>?".
            ($manager?'':' AND m.id=?').$continuation." ORDER BY p.starts,p.id LIMIT 61",$params)->fetchAll(PDO::FETCH_ASSOC);
        $nextCursor = '';
        if (count($rows) > 60) {
            array_pop($rows);
            $tail = end($rows);
            $nextCursor = $tail['starts'].'~'.$tail['id'];
        }
        return ['week'=>$from,'manager'=>$manager,'members'=>$members,'rows'=>$rows,'nextCursor'=>$nextCursor];
    }

    public function change(array $actor,object $body): array
    {
        self::checkRole($actor);
        $partner=$actor['partner_id'];
        $manager=$actor['role']==='dealer';
        // The home visit scheduler uses this same lock before touching visit slots.
        $this->db->beginTransaction();
        try {
            if (!$this->query('SELECT id FROM partner_account WHERE id=? AND active=1 FOR UPDATE',[$partner])->fetchColumn()) {
                throw new RuntimeException('Klinik bulunamadı.',404);
            }
            $action=$body->action??'';
            if ($action==='add') {
                $member=$this->query("SELECT m.account_id,m.branch_id FROM identity_membership m JOIN identity_account a ON a.id=m.account_id
                    WHERE m.id=? AND m.partner_id=? AND m.role IN ('branch','staff') AND m.status='active' AND a.blocked=0 FOR UPDATE",
                    [is_string($body->member??null)?$body->member:'',$partner])->fetch(PDO::FETCH_ASSOC);
                $kind=$body->kind??'';
                if (!$member || !in_array($kind,['shift','leave'],true) || (!$manager && ($kind!=='leave'||$body->member!==$actor['membership_id']))) {
                    throw new RuntimeException('Bu bölüm için yetkiniz yok',403);
                }
                $starts=self::date($body->starts??null,'Y-m-d\TH:i');
                $ends=self::date($body->ends??null,'Y-m-d\TH:i');
                if ($ends<=$starts || $ends>$starts->modify($kind==='leave'?'+366 days':'+24 hours')) {
                    throw new RuntimeException('Başlangıç ve bitiş aralığını kontrol edin.',422);
                }
                $s=$starts->format('Y-m-d H:i:s');
                $e=$ends->format('Y-m-d H:i:s');
                $status=$manager?'approved':'pending';
                if ($status==='approved') $this->available($partner,$member['account_id'],$s,$e,$kind);
                elseif ($this->query("SELECT 1 FROM clinic_staff_plan WHERE partner_id=? AND account_id=? AND kind='leave' AND status IN ('pending','approved') AND starts<? AND ends>? LIMIT 1 FOR UPDATE",[$partner,$member['account_id'],$e,$s])->fetchColumn()) {
                    throw new RuntimeException('Bu zaman aralığında bir izin kaydı var.',409);
                }
                $this->query("INSERT INTO clinic_staff_plan(partner_id,account_id,member_id,branch_id,kind,status,starts,ends,created_by,changed_by)
                    VALUES(?,?,?,?,?,?,?,?,?,?)",[$partner,$member['account_id'],$body->member,$member['branch_id'],$kind,$status,$s,$e,$actor['account_id'],$actor['account_id']]);
                $id=$this->db->lastInsertId();
            } else {
                $id=$body->id??null;
                if ((!is_string($id)&&!is_int($id)) || !ctype_digit((string)$id) || !in_array($action,['approve','decline','cancel'],true)) {
                    throw new RuntimeException('İşlem geçersiz.',422);
                }
                $row=$this->query('SELECT * FROM clinic_staff_plan WHERE id=? AND partner_id=? FOR UPDATE',[$id,$partner])->fetch(PDO::FETCH_ASSOC);
                if (!$row || (!$manager && ($row['member_id']!==$actor['membership_id']||$action!=='cancel'))) throw new RuntimeException('Bu bölüm için yetkiniz yok',403);
                if (($body->status??'')!==$row['status'] || !in_array($row['status'],['pending','approved'],true) || ($row['status']==='approved' && (!$manager || $action!=='cancel'))) {
                    throw new RuntimeException('Plan değişti. Listeyi yenileyin.',409);
                }
                if ($action==='approve') {
                    if (!$this->query("SELECT m.id FROM identity_membership m JOIN identity_account a ON a.id=m.account_id WHERE m.id=? AND m.partner_id=? AND m.branch_id=? AND m.account_id=? AND m.role IN ('branch','staff') AND m.status='active' AND a.blocked=0 FOR UPDATE",[$row['member_id'],$partner,$row['branch_id'],$row['account_id']])->fetchColumn()) throw new RuntimeException('Personel kaydını kontrol edin.',409);
                    $this->available($partner,$row['account_id'],$row['starts'],$row['ends'],$row['kind']);
                }
                $this->query('UPDATE clinic_staff_plan SET status=?,changed_by=? WHERE id=? AND partner_id=?',
                    [match($action){'approve'=>'approved','decline'=>'declined','cancel'=>'cancelled'},$actor['account_id'],$id,$partner]);
            }
            $this->query('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES(?,?,?)',[$partner,$actor['account_id'],'staff_plan.'.$action]);
            $this->db->commit();
            return ['id'=>(string)$id];
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    private function available(string $partner,string $account,string $starts,string $ends,string $kind): void
    {
        if ($this->query("SELECT 1 FROM clinic_staff_plan WHERE partner_id=? AND account_id=? AND starts<? AND ends>? AND status='approved' LIMIT 1 FOR UPDATE",[$partner,$account,$ends,$starts])->fetchColumn()) {
            throw new RuntimeException('Bu zaman aralığında onaylı vardiya veya izin var.',409);
        }
        if ($kind==='leave' && $this->query("SELECT s.visit_id FROM clinic_visit_slot s JOIN identity_membership m
            ON m.partner_id=s.partner_id AND (s.clinician=m.id OR s.assistant=m.id)
            WHERE s.partner_id=? AND m.account_id=? AND s.released=0 AND s.starts<? AND s.ends>? LIMIT 1 FOR UPDATE",[$partner,$account,$ends,$starts])->fetchColumn()) {
            throw new RuntimeException('Bu aralıkta personele atanmış ev ziyareti var.',409);
        }
    }

    public function checkVisit(string $partner,array $accounts,string $starts,string $ends): void
    {
        foreach (array_unique($accounts) as $account) {
            if ($this->query("SELECT 1 FROM clinic_staff_plan WHERE partner_id=? AND account_id=? AND kind='leave' AND status='approved' AND starts<? AND ends>? LIMIT 1 FOR UPDATE",[$partner,$account,$ends,$starts])->fetchColumn()) {
                throw new RuntimeException('Seçilen personel bu saatlerde izinli.',409);
            }
        }
    }
}
