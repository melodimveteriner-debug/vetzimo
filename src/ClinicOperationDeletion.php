<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class ClinicOperationDeletion
{
    public function __construct(private readonly PDO $db) {}

    public function apply(object $state, array $actor, string $collection, object $row): void
    {
        switch ($collection) {
            case 'appointments':
                if (str_starts_with($row->id,'visit-')) throw new RuntimeException('Bu randevuyu Evde Hizmet başvurusundan silin.',422);
                foreach ($state->exams ?? [] as $exam) {
                    if ($exam->id===($row->controlExamId ?? '')) {
                        if (!ClinicAccess::allowed($actor,'exams',true)) {
                            throw new RuntimeException('Kontrol randevusunu kaldırmak için muayene yazma yetkisi gerekir.',403);
                        }
                        $exam->next=$exam->nextTime='';
                    }
                    if (($exam->appointmentId ?? '') === $row->id) unset($exam->appointmentId);
                }
                (new ClinicRecordDeletion($this->db))->deleteAppointmentData($actor['partner_id'],$row->id);
                break;
            case 'products':
                if ($this->usedProduct($state,$actor['partner_id'],$row)) {
                    $row->archived='Evet';
                    return;
                }
                break;
            case 'sales':
                $this->removeSale($state,$actor,$row);
                break;
            case 'tasks':
                if (!in_array($row->status ?? '',['Tamamlandı','Arşiv'],true)) throw new RuntimeException('Yalnız tamamlanan görev silinebilir.',422);
                break;
            case 'templates':
                foreach ($state->messages??[] as $draft) {
                    if (($draft->template??'')===$row->id) unset($draft->template);
                }
                break;
            case 'initialPayments':
                $this->ensureLocalPayment($row);
                if (Finance::money($row->paid??'0')<=0) throw new RuntimeException('Kaldırılabilecek bir satış tahsilatı yok.',404);
                $this->reverseLedger($actor,'sales',$row->id);
                $row->paid='0';
                return;
            case 'expenses':
                self::recordCashAdjustment($this->db,$actor,$row,'void',-1);
                break;
            case 'payments':
                $this->reverseLedger($actor,$collection,$row->id);
                break;
            case 'collections':
                $sale=array_column($state->sales,null,'id')[$row->sale]??null;
                if ($sale) $this->ensureLocalPayment($sale);
                $this->reverseLedger($actor,$collection,$row->id);
                break;
        }
        $state->$collection = self::without($state->$collection,$row->id);
    }

    private function usedProduct(object $state, string $partner, object $product): bool
    {
        foreach (['stockLots','stockMoves','purchases','prescriptions','vaccineCatalog'] as $type) {
            if (in_array($product->id,array_column($state->$type ?? [],'product'),true)) return true;
        }
        foreach ($state->sales ?? [] as $sale) {
            if (($sale->product ?? '')===$product->id) return true;
            foreach (json_decode($sale->items ?? '[]') ?? [] as $line) {
                if (($line->product ?? '')===$product->id) return true;
            }
        }
        if ((int)($product->stock ?? 0)>0) return true;
        $quote=$this->db->prepare("SELECT 1 FROM clinic_visit_request r JOIN clinic_visit_quote q ON q.visit_id=r.id
            WHERE r.partner_id=? AND JSON_CONTAINS(q.details,JSON_OBJECT('product',?),'$.lines') LIMIT 1");
        $quote->execute([$partner,$product->id]);
        return (bool)$quote->fetchColumn();
    }

    private function ensureLocalPayment(object $sale): void
    {
        if (str_starts_with($sale->id,'visit-') || !empty($sale->invoice) || !empty($sale->okcTransactionId) ||
            !empty($sale->fiscalReceipt) || !empty($sale->fiscalDocumentId)) {
            throw new RuntimeException('Bu kaydı bağlı ödeme veya mali belge üzerinden iptal edin.',422);
        }
    }

    private function removeSale(object $state, array $actor, object $sale): void
    {
        $this->ensureLocalPayment($sale);
        $payments=array_filter($state->collections,static fn($row)=>$row->sale===$sale->id);
        if ($payments && !ClinicAccess::deleteAllowed($actor,'collections')) {
            throw new RuntimeException('Bağlı tahsilatları iptal etmek için tahsilat yetkisi gerekir.',403);
        }
        $allocations=json_decode($sale->stockAllocations ?? '[]',true,16,JSON_THROW_ON_ERROR);
        $tracked=array_filter(json_decode($sale->items ?? '[]') ?? [],static fn($line)=>($line->stock ?? '')==='Evet');
        if (($tracked || !empty($sale->product)) && !$allocations) {
            throw new RuntimeException('Eski satışın stok partisi doğrulanamadı. Stok hareketlerini kontrol edin.',409);
        }
        if ($allocations && !ClinicAccess::allowed($actor,'products',true)) {
            throw new RuntimeException('Stok iadesi için ürün yazma yetkisi gerekir.',403);
        }
        $lots=array_column($state->stockLots,null,'id');
        $products=array_column($state->products,null,'id');
        foreach ($allocations as [$lotId,$productId,$qty]) {
            $lot=$lots[$lotId]??null;
            $product=$products[$productId]??null;
            if (!$lot || !$product || $lot->product!==$productId || $lot->branch!==$sale->branch ||
                $product->branch!==$sale->branch || !is_int($qty) || $qty<1 || (int)$lot->remaining+$qty>(int)$lot->received) {
                throw new RuntimeException('Stok partisi doğrulanamadı. Satış durumu değişmedi.',409);
            }
            $lot->remaining=(string)((int)$lot->remaining+$qty);
            $product->stock=(string)((int)$product->stock+$qty);
            $state->stockMoves[]=(object)['id'=>bin2hex(random_bytes(16)),'branch'=>$sale->branch,'product'=>$productId,
                'lot'=>$lotId,'date'=>WebBuilder::today(),'delta'=>(string)$qty,'balance'=>$lot->remaining,
                'source'=>'Satış iptali','reason'=>'Satış iptali','createdBy'=>$actor['name']];
        }
        foreach ($payments as $payment) $this->reverseLedger($actor,'collections',$payment->id);
        $state->collections=array_values(array_filter($state->collections,static fn($row)=>$row->sale!==$sale->id));
        $this->reverseLedger($actor,'sales',$sale->id);
    }

    public static function recordCashAdjustment(PDO $db,array $actor,object $row,string $operation,int $factor): void
    {
        $income=$row->type==='Gelir';
        $type=$income?'cash_adjust_income':'cash_adjust_expense';
        $id=hash('sha256',$row->id.':'.$operation);
        $db->prepare('INSERT INTO finance_entry(partner_id,branch_id,source_type,source_id,entry_date,amount_cents,account_id)
            VALUES (?,?,?,?,?,?,?)')->execute([$actor['partner_id'],$row->branch,$type,$id,$row->date,
                Finance::money($row->amount)*($income?1:-1)*$factor,$actor['account_id']]);
    }
    private function reverseLedger(array $actor, string $type, string $id): void
    {
        $this->db->prepare("INSERT INTO finance_entry(partner_id,branch_id,source_type,source_id,entry_date,amount_cents,account_id)
            SELECT f.partner_id,f.branch_id,CONCAT(f.source_type,'_void'),f.source_id,f.entry_date,-f.amount_cents,?
            FROM finance_entry f WHERE f.partner_id=? AND f.source_type=? AND f.source_id=?
            AND NOT EXISTS (SELECT 1 FROM finance_entry v WHERE v.partner_id=f.partner_id
                AND v.source_type=CONCAT(f.source_type,'_void') AND v.source_id=f.source_id)")
            ->execute([$actor['account_id'],$actor['partner_id'],$type,$id]);
    }

    private static function without(array $rows, string $id): array
    {
        return array_values(array_filter($rows,static fn($row)=>$row->id!==$id));
    }
}
