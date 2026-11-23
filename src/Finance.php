<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
use RuntimeException;

final class Finance
{
    public static function money(string $value): int
    {
        if(!preg_match('/\A(?:0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?\z/',$value)) throw new RuntimeException('Para tutarı geçersiz.',422);
        $parts=explode('.',$value); $amount=(int)$parts[0]*100+(int)str_pad($parts[1] ?? '',2,'0');
        if($amount>1_000_000_000) throw new RuntimeException('İşlem tutarı sınırı aşıldı.',422);
        return $amount;
    }
    private static function rounded(int $numerator,int $denominator): int
    {
        if($numerator<0 || $denominator<=0) throw new RuntimeException('Tutar hesabı geçersiz.',422);
        return intdiv($numerator+intdiv($denominator,2),$denominator);
    }
    public static function qty(string $value,bool $zero=false): int
    {
        if(!preg_match('/\A(?:0|[1-9][0-9]{0,8})\z/',$value)||(!$zero && (int)$value===0)) throw new RuntimeException('Adet geçersiz.',422);
        return (int)$value;
    }
    public static function index(array $rows): array { $out=[];foreach($rows as $row)$out[$row->id]=$row;return $out; }
    public static function saleTotal(object $sale,array $products): int
    {
        try { $lines=json_decode($sale->items ?? '',false,32,JSON_THROW_ON_ERROR); }
        catch(\Throwable) { throw new RuntimeException('Satış kalemleri geçersiz.',422); }
        if(!is_array($lines)||count($lines)<1||count($lines)>30) throw new RuntimeException('Satışta 1–30 kalem bulunmalıdır.',422);
        $amounts=[]; $totalNet=0; $totalGross=0;
        foreach($lines as $line) {
            if(!is_object($line)||!is_string($line->name ?? null)||trim($line->name)===''||!is_string($line->quantity ?? null)||!is_string($line->price ?? null)) throw new RuntimeException('Satış kalemi geçersiz.',422);
            if(!empty($line->legacyAmount)||!empty($line->legacyTaxRounding)) throw new RuntimeException('Eski satış biçimi aktarımı gerekli.',422);
            $quantity=self::qty($line->quantity); $price=self::money($line->price); $rate=self::money($line->vat ?? '0');
            if($rate>10000) throw new RuntimeException('KDV oranı geçersiz.',422);
            $raw=$price*$quantity;
            if($raw>1_000_000_000) throw new RuntimeException('Satış kalemi tutarı sınırı aşıldı.',422);
            if(!in_array($line->taxMode ?? '',['KDV Dahil','KDV Hariç'],true)) throw new RuntimeException('KDV hesaplama biçimi geçersiz.',422);
            $base=$line->taxMode==='KDV Dahil'?self::rounded($raw*10000,10000+$rate):$raw;
            $gross=$line->taxMode==='KDV Dahil'?$raw:$base+self::rounded($base*$rate,10000);
            $discount=self::money($line->discountAmount ?? '0');
            if($discount>$gross) throw new RuntimeException('İndirim kalem tutarını aşamaz.',422);
            $after=$gross-$discount;
            $net=$discount?self::rounded($after*10000,10000+$rate):$base;
            $amounts[]=[$after,$net,$rate]; $totalNet+=$net; $totalGross+=$after;
            if($totalGross>1_000_000_000) throw new RuntimeException('Satış toplamı sınırı aşıldı.',422);
            if(!empty($line->product)) {
                $product=$products[$line->product] ?? null;
                if(!$product||$product->branch!==$sale->branch) throw new RuntimeException('Ürün bu şubede bulunamadı.',422);
                $tracked=($product->category ?? '')!=='Hizmet' && ($product->track ?? '')!=='Hayır';
                if(($line->stock ?? '')!==($tracked?'Evet':'Hayır')) throw new RuntimeException('Satış stok niteliği ürünle eşleşmiyor.',422);
            } elseif(($line->stock ?? 'Hayır')!=='Hayır') throw new RuntimeException('Stok ürünü seçilmedi.',422);
        }
        $discount=self::money($sale->discount ?? '0'); $mode=$sale->discountType ?? 'GenelToplamTL';
        if(!in_array($mode,['GenelToplamTL','Tutar','Yüzde'],true)) throw new RuntimeException('İndirim türü geçersiz.',422);
        if($mode==='Yüzde') {
            if($discount>10000) throw new RuntimeException('İndirim oranı geçersiz.',422);
            $discount=self::rounded($totalNet*$discount,10000);
        }
        $remainingBase=$mode==='GenelToplamTL'?$totalGross:$totalNet;
        if($discount>$remainingBase) throw new RuntimeException('İndirim satış tutarını aşamaz.',422);
        $remaining=$discount; $total=0;
        foreach($amounts as [$after,$net,$rate]) {
            $weight=$mode==='GenelToplamTL'?$after:$net;
            $share=$remainingBase?self::rounded($remaining*$weight,$remainingBase):0;
            $remaining-=$share; $remainingBase-=$weight;
            $total+=$mode==='GenelToplamTL'?$after-$share:($net-$share)+self::rounded(($net-$share)*$rate,10000);
        }
        return $total;
    }
    public static function validate(object $old,object $next,bool $cashCorrection=false): void
    {
        $products=self::index($next->products); $sales=self::index($next->sales); $purchases=self::index($next->purchases);
        // Financial records remain immutable. Corrections require explicit reversal flows.
        foreach(['sales','purchases','collections','payments','expenses','stockMoves'] as $key) {
            $index=self::index($next->$key);
            foreach($old->$key as $row) if(!isset($index[$row->id])||($row!=$index[$row->id] && !($key==='expenses' && $cashCorrection))) throw new RuntimeException('Mali hareket değiştirilemez; ters kayıt işlemi gereklidir.',422);
        }
        $oldSales=self::index($old->sales);
        foreach($next->sales as $sale) {
            if(!isset($oldSales[$sale->id]) && self::saleTotal($sale,$products)!==self::money($sale->amount)) throw new RuntimeException('Satış toplamı kalemlerle eşleşmiyor.',422);
            if(self::money($sale->paid ?? '0')>self::money($sale->amount)) throw new RuntimeException('Tahsilat satış toplamını aşamaz.',422);
        }
        foreach([['collections','sales','sale'],['payments','purchases','purchase']] as [$key,$parentKey,$link]) {
            $parents=self::index($next->$parentKey); $paid=[];
            foreach($next->$key as $row) {
                $parent=$parents[$row->$link] ?? null; $amount=self::money($row->amount);
                if(!$parent||$parent->branch!==$row->branch||$row->date<$parent->date||$amount===0) throw new RuntimeException('Tahsilat veya ödeme bağlantısı geçersiz.',422);
                $paid[$parent->id]=($paid[$parent->id] ?? 0)+$amount;
            }
            foreach($parents as $parent) if(($paid[$parent->id] ?? 0)+self::money($parent->paid ?? '0')>self::money($parent->amount)) throw new RuntimeException('Ödeme toplamı açık bakiyeyi aşamaz.',422);
        }
        foreach($next->expenses as $row) { self::money($row->amount); if(!in_array($row->type,['Gelir','Gider'],true)) throw new RuntimeException('Kasa hareket türü geçersiz.',422); }
        $oldProducts=self::index($old->products); $lots=self::index($next->stockLots); $oldLots=self::index($old->stockLots); $oldMoves=self::index($old->stockMoves);
        $deltas=[]; $balances=[];
        foreach($next->stockMoves as $move) {
            $lot=$lots[$move->lot ?? ''] ?? null;
            if(!$lot||$lot->product!==$move->product||$lot->branch!==$move->branch||!preg_match('/\A-?[0-9]{1,9}\z/',$move->delta)) throw new RuntimeException('Stok hareketi geçersiz.',422);
            if(!isset($oldMoves[$move->id])) $deltas[$lot->id]=($deltas[$lot->id] ?? 0)+(int)$move->delta;
        }
        foreach($next->stockLots as $lot) {
            $product=$products[$lot->product] ?? null;
            if(!$product||$product->branch!==$lot->branch) throw new RuntimeException('Stok partisi ürüne bağlı değil.',422);
            $remaining=self::qty($lot->remaining,true); $received=self::qty($lot->received,true);
            if($remaining>$received) throw new RuntimeException('Parti bakiyesi giren stoktan fazla olamaz.',422);
            $baseline=isset($oldLots[$lot->id])?self::qty($oldLots[$lot->id]->remaining,true):0;
            if(!isset($oldLots[$lot->id]) && $lot->id==='initial-'.$product->id) $baseline=self::qty($oldProducts[$product->id]->stock ?? '0',true);
            if($baseline+($deltas[$lot->id] ?? 0)!==$remaining) throw new RuntimeException('Parti bakiyesi stok hareketleriyle eşleşmiyor.',422);
            $balances[$product->id]=($balances[$product->id] ?? 0)+$remaining;
        }
        foreach($next->products as $product) {
            self::money($product->price); $stock=self::qty($product->stock,true);
            if(isset($balances[$product->id]) && $balances[$product->id]!==$stock) throw new RuntimeException('Ürün stoğu parti toplamına eşit olmalıdır.',422);
            if(isset($oldProducts[$product->id]) && !isset($balances[$product->id]) && $oldProducts[$product->id]->stock!==$product->stock) throw new RuntimeException('Stok değişikliği için parti hareketi gereklidir.',422);
        }
        $consumption=[];
        foreach($next->sales as $sale) if(!isset($oldSales[$sale->id])) {
            $required=[];
            foreach(json_decode($sale->items) as $line) if(($line->stock ?? '')==='Evet') $required[$line->product]=($required[$line->product] ?? 0)+self::qty($line->quantity);
            try { $allocations=json_decode($sale->stockAllocations ?? '[]',false,16,JSON_THROW_ON_ERROR); } catch(\Throwable) {throw new RuntimeException('Stok dağılımı geçersiz.',422);}
            if(!is_array($allocations)) throw new RuntimeException('Stok dağılımı geçersiz.',422);
            $allocated=[];
            foreach($allocations as $a) {
                if(!is_array($a)||count($a)!==3||!is_int($a[2])||$a[2]<1) throw new RuntimeException('Stok dağılımı geçersiz.',422);
                $lot=$lots[$a[0]] ?? null;
                if(!$lot||$lot->branch!==$sale->branch||$lot->product!==$a[1]||(!empty($lot->expiry)&&$lot->expiry<$sale->date)) throw new RuntimeException('Stok partisi geçersiz veya tarihi geçmiş.',422);
                $consumption[$a[0]]=($consumption[$a[0]] ?? 0)+$a[2];
                $allocated[$a[1]]=($allocated[$a[1]] ?? 0)+$a[2];
            }
            ksort($required);ksort($allocated);
            if($required!==$allocated) throw new RuntimeException('Satış ile stoktan düşülen miktar eşleşmiyor.',422);
        }
        $saleMoves=[];
        foreach($next->stockMoves as $move) if(!isset($oldMoves[$move->id]) && ($move->source ?? '')==='Satış') {
            if((int)$move->delta>=0) throw new RuntimeException('Satış stok hareketi negatif olmalıdır.',422);
            $saleMoves[$move->lot]=($saleMoves[$move->lot] ?? 0)-(int)$move->delta;
        }
        ksort($consumption);ksort($saleMoves);
        if($consumption!==$saleMoves) throw new RuntimeException('Satış stoğu hareket kaydı ile eşleşmiyor.',422);
    }
}
