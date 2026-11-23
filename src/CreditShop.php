<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class CreditShop
{
    public function __construct(private readonly PDO $db,private readonly CenterManagement $management) {}

    public function catalog(array $actor): array
    {
        $q=$this->db->prepare("SELECT id,payload,updated_at FROM center_management WHERE kind='credit_order'
            AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.partner'))=? ORDER BY updated_at DESC,id LIMIT 200");
        $q->execute([$actor['partner_id']]);
        $orders=array_map(static fn($row)=>['id'=>$row['id'],'created_at'=>$row['updated_at']]+json_decode($row['payload'],true,32,JSON_THROW_ON_ERROR),$q->fetchAll());
        $balance=$this->db->prepare("SELECT g.channel,GREATEST(0,SUM(g.units)-(SELECT COALESCE(SUM(m.units),0) FROM clinic_bulk_message m
            WHERE m.partner_id=g.partner_id AND m.channel=g.channel AND m.status<>'rejected')) AS balance
            FROM clinic_credit_grant g WHERE g.partner_id=? GROUP BY g.channel");
        $balance->execute([$actor['partner_id']]);
        $packages=array_map(static fn($row)=>['id'=>$row['id'],'name'=>$row['name'],'channel'=>$row['channel'],
            'units'=>(int)$row['units'],'price'=>Finance::money(str_replace(',','.',$row['price'])),'card'=>false],
            $this->management->rows('credit_package'));
        $bank=$this->bank();
        return ['orders'=>$orders,'limits'=>$balance->fetchAll(),'packages'=>$packages,'scopeId'=>$actor['membership_id'],
            'bank'=>$bank!==null,'preview'=>false];
    }

    private function bank(): ?string
    {
        $settings=$this->management->rows('shop_bank')[0] ?? null;
        return $settings && $settings['enabled']==='yes' ? $settings['beneficiary'].' · '.$settings['iban'] : null;
    }

    public function order(array $actor,object $body): array
    {
        $request=$body->requestId ?? null;
        $package=$body->packageId ?? null;
        if (!is_string($request) || !preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/',$request) || !is_string($package) || ($body->method ?? '')!=='bank') {
            throw new RuntimeException('Sipariş bilgilerini kontrol edin.',422);
        }
        $id=substr(hash('sha256','credit:'.$actor['partner_id'].':'.$request),0,32);
        $q=$this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='credit_order'");
        $q->execute([$id]);
        $existing=$q->fetchColumn();
        if (!$existing) {
            $bank=$this->bank();
            $packages=array_column($this->management->rows('credit_package'),null,'id');
            $row=$packages[$package] ?? null;
            if (!$bank || !$row) throw new RuntimeException('Paket veya havale seçeneği satışta değil.',422);
            $record=['partner'=>$actor['partner_id'],'package'=>$package,'name'=>$row['name'],'channel'=>$row['channel'],
                'units'=>(int)$row['units'],'price'=>Finance::money(str_replace(',','.',$row['price'])),'method'=>'bank',
                'status'=>'pending','instruction'=>$bank];
            $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'credit_order',?) ON DUPLICATE KEY UPDATE id=id")
                ->execute([$id,json_encode($record,JSON_THROW_ON_ERROR)]);
            $q->execute([$id]);
            $existing=$q->fetchColumn();
        }
        if ((json_decode($existing,true,32,JSON_THROW_ON_ERROR)['package'] ?? null)!==$package) throw new RuntimeException('Sipariş anahtarı başka bir paket için kullanılmış.',409);
        return ['id'=>$id];
    }

    public function reference(array $actor,object $body): void
    {
        $id=$body->id ?? null;
        $ref=$body->reference ?? null;
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/',$id) || !is_string($ref) || !preg_match('/\A[^\p{Cc}]{1,100}\z/u',trim($ref))) {
            throw new RuntimeException('Geçerli banka işlem referansını girin.',422);
        }
        $q=$this->db->prepare("UPDATE center_management SET payload=JSON_SET(payload,'$.reference',?,'$.status','review')
            WHERE id=? AND kind='credit_order' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.partner'))=?
            AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.status'))='pending'");
        $q->execute([trim($ref),$id,$actor['partner_id']]);
        if (!$q->rowCount()) throw new RuntimeException('Ödeme bildirimi bekleyen sipariş bulunamadı.',409);
    }

    public function review(object $body): void
    {
        $id=$body->id ?? null;
        $decision=$body->action ?? '';
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/',$id) || !in_array($decision,['approved','rejected'],true)) throw new RuntimeException('Karar geçersiz.',422);
        $this->db->beginTransaction();
        try {
            $q=$this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='credit_order' FOR UPDATE");
            $q->execute([$id]);
            $raw=$q->fetchColumn();
            $order=$raw?json_decode($raw,true,32,JSON_THROW_ON_ERROR):[];
            if (($order['status'] ?? '')!=='review') throw new RuntimeException('İnceleme bekleyen sipariş bulunamadı.',409);
            if ($decision==='approved') {
                $amount=$body->verifiedAmount ?? null;
                if (($body->verified ?? false)!==true || !is_string($amount) ||
                    Finance::money(str_replace(',','.',trim($amount)))!==(int)$order['price']) {
                    throw new RuntimeException('Bankada doğrulanan tutar siparişle eşleşmeli.',422);
                }
                $this->db->prepare('INSERT INTO clinic_credit_grant(order_id,partner_id,channel,units,bank_reference) VALUES (?,?,?,?,?)')
                    ->execute([$id,$order['partner'],$order['channel'],$order['units'],strtolower(trim($order['reference']))]);
            }
            $this->db->prepare("UPDATE center_management SET payload=JSON_SET(payload,'$.status',?) WHERE id=? AND kind='credit_order'")
                ->execute([$decision,$id]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            if ($error instanceof \PDOException && (int)($error->errorInfo[1] ?? 0)===1062) throw new RuntimeException('Banka referansı daha önce onaylanmış.',409);
            throw $error;
        }
    }
}
