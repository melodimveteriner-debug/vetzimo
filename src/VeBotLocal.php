<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class VeBotLocal
{
    public function __construct(private PDO $db) {}

    public function enqueue(string $turn, array $payload, string $sources): array
    {
        $this->db->exec('DELETE FROM vebot_local_job WHERE expires_at<=UTC_TIMESTAMP()');
        $this->db->prepare('INSERT INTO vebot_local_job (turn_id,payload,sources,expires_at) VALUES (?,?,?,UTC_TIMESTAMP()+INTERVAL 10 MINUTE)')
            ->execute([$turn,json_encode($payload,JSON_THROW_ON_ERROR),$sources]);
        return ['job'=>$turn];
    }

    public function active(array $scope): bool
    {
        $query=$this->db->prepare('SELECT 1 FROM vebot_local_job j JOIN vebot_turn t ON t.id=j.turn_id WHERE
            t.partner_id=? AND t.membership_id=? AND j.payload IS NOT NULL AND j.expires_at>UTC_TIMESTAMP() LIMIT 1');
        $query->execute($scope);
        return (bool)$query->fetchColumn();
    }

    public function status(array $actor,string $turn,bool $cancel): array
    {
        if (!preg_match('/\A[1-9][0-9]{0,18}\z/',$turn)) throw new RuntimeException('İstek numarası geçersiz.',422);
        $query=$this->db->prepare('SELECT j.payload IS NOT NULL AS waiting,j.failed,t.answer FROM vebot_turn t LEFT JOIN vebot_local_job j
            ON j.turn_id=t.id AND j.expires_at>UTC_TIMESTAMP() WHERE t.id=? AND t.partner_id=? AND t.membership_id=?');
        $query->execute([$turn,$actor['partner_id'],$actor['membership_id']]);
        $row=$query->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('VeBot isteği bulunamadı.',404);
        if ($row['answer']!=='') return ['answer'=>$row['answer']];
        if ($cancel) {
            $this->db->prepare('DELETE FROM vebot_local_job WHERE turn_id=? AND payload IS NOT NULL')->execute([$turn]);
            return ['cancelled'=>true];
        }
        if ($row['failed']) throw new RuntimeException('Yerel model yanıt veremedi. Bilgisayardaki VeBot penceresini kontrol edin.',503);
        if (!$row['waiting']) throw new RuntimeException('Yerel VeBot isteği sona erdi. Bilgisayar bağlantısını kontrol edip tekrar deneyin.',503);
        return ['pending'=>true];
    }

    public function work(object $body): array
    {
        if (($body->action ?? '')==='claim') {
            $lease=bin2hex(random_bytes(24));
            $this->db->prepare('UPDATE vebot_local_job SET lease=? WHERE lease IS NULL AND payload IS NOT NULL
                AND expires_at>UTC_TIMESTAMP()+INTERVAL 1 MINUTE ORDER BY turn_id LIMIT 1')->execute([$lease]);
            $query=$this->db->prepare('SELECT turn_id,payload FROM vebot_local_job WHERE lease=?');
            $query->execute([$lease]);
            $job=$query->fetch(PDO::FETCH_ASSOC);
            return ['job'=>$job?['id'=>(string)$job['turn_id'],'lease'=>$lease,'payload'=>json_decode($job['payload'],true,512,JSON_THROW_ON_ERROR)]:null];
        }
        $lease=$body->lease ?? null;
        $answer=$body->answer ?? null;
        if (($body->action ?? '')!=='complete' || !is_string($lease) || !preg_match('/\A[0-9a-f]{48}\z/',$lease)
            || !is_string($answer) || strlen($answer)>64000) throw new RuntimeException('Yerel VeBot yanıtı geçersiz.',422);
        $answer=trim($answer);
        $this->db->beginTransaction();
        try {
            $query=$this->db->prepare('SELECT turn_id,sources FROM vebot_local_job WHERE lease=? AND payload IS NOT NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE');
            $query->execute([$lease]);
            $job=$query->fetch(PDO::FETCH_ASSOC);
            if ($job) {
                if ($answer!=='') {
                    $this->db->prepare('UPDATE vebot_turn SET answer=? WHERE id=?')->execute([$answer.$job['sources'],$job['turn_id']]);
                }
                $this->db->prepare("UPDATE vebot_local_job SET payload=NULL,sources='',failed=? WHERE turn_id=?")
                    ->execute([$answer===''?1:0,$job['turn_id']]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        return ['ok'=>true];
    }
}
