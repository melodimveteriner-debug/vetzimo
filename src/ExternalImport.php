<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

require_once __DIR__ . '/ClinicProtocol.php';

use RuntimeException;

final class ExternalImport
{
    public const TABLES=[
        'clients'=>['name'], 'patients'=>['name','owner'=>'clients'],
        'suppliers'=>['name'], 'products'=>['name','category','price','stock'],
        'vaccineCatalog'=>['name'], 'followups'=>['title','date','patient'=>'patients','vaccine'=>'vaccineCatalog'],
        'stockLots'=>['product'=>'products','supplier'=>'suppliers','received','remaining'],
        'stockMoves'=>['product'=>'products','lot'=>'stockLots','date','delta'],
        'appointments'=>['date','time','client'=>'clients','patient'=>'patients'],
        'exams'=>['date','patient'=>'patients'],
        'sales'=>['date','amount','items','client'=>'clients','patient'=>'patients'],
        'collections'=>['date','amount','sale'=>'sales'],
    ];
    /** Boş bırakılabilen bağlantılar (ör. müşterisiz perakende satış, kayıtsız randevu). */
    private const OPTIONAL=['vaccine','supplier','client','patient'];
    /** Mali kayıtlar değiştirilemez: aynı dosya tekrar yüklenirse mevcut kayıt korunur. */
    private const IMMUTABLE=['sales','collections','stockMoves'];

    public static function merge(object $state, object $source,string $branch,bool $restore=false): array
    {
        if (!ClinicAccess::branch($state,$branch) || !empty(ClinicAccess::branch($state,$branch)->sharedWith)) {
            throw new RuntimeException('Bağımsız ve etkin bir veri şubesi seçin.',422);
        }
        foreach ($source as $kind=>$rows) {
            if (!isset(self::TABLES[$kind])) throw new RuntimeException('Desteklenmeyen aktarım tablosu: '.$kind,422);
        }
        $next=clone $state;
        $counts=[];
        $sourceId=static fn($value)=>is_string($value) && preg_match('/\A[A-Za-z0-9_.:-]{1,100}\z/',$value);
        $id=static fn(string $kind,string $external)=>$restore&&preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D',$external)
            ? $external : 'kv-'.substr(hash('sha256',$branch.'|'.$kind.'|'.$external),0,40);
        $known=[];
        foreach (self::TABLES as $kind=>$fields) {
            $rows=$source->$kind ?? [];
            if (!is_array($rows)) throw new RuntimeException($kind.': kayıt listesi geçersiz.',422);
            $items=array_column($state->$kind ?? [],null,'id');
            $counts[$kind]=['added'=>0,'updated'=>0,'unchanged'=>0];
            $seen=[];
            foreach ($rows as $index=>$raw) {
                $where=$kind.' · satır '.($index+1);
                if (!is_object($raw) || !$sourceId($raw->id ?? null)) throw new RuntimeException($where.': kaynak kayıt kimliği gerekli.',422);
                $key=$id($kind,$raw->id);
                if (isset($seen[$key])) throw new RuntimeException($where.': yinelenen kimlik.',422);
                $seen[$key]=true;
                if (($restore || in_array($kind,self::IMMUTABLE,true)) && isset($items[$key])) {
                    if ($items[$key]->branch!==$branch) throw new RuntimeException($where.': yedek kaydı başka bir veri şubesine ait.',409);
                    $counts[$kind]['unchanged']++;
                    continue;
                }
                $row=(object)['id'=>$key,'branch'=>$branch];
                foreach ($raw as $field=>$value) {
                    if (in_array($field,['id','branch'],true)) continue;
                    if (preg_match('/password|passwd|sifre|şifre|token|secret/i',$field)) continue;
                    if (!is_string($value) || strlen($value)>50000) throw new RuntimeException($where.': alanlar metin olmalıdır.',422);
                    $row->$field=$value;
                }
                foreach ($fields as $field=>$target) {
                    if (is_int($field)) {
                        if (trim($row->$target ?? '')==='') throw new RuntimeException($where.': '.$target.' gerekli.',422);
                        if ($target==='date' && !self::date($row->$target)) throw new RuntimeException($where.': tarih geçersiz.',422);
                        continue;
                    }
                    $value=$row->$field ?? '';
                    if ($value==='' && in_array($field,self::OPTIONAL,true)) { $row->$field=''; continue; }
                    if (!$sourceId($value) || !isset($known[$target][$id($target,$value)])) {
                        throw new RuntimeException($where.': '.$field.' bağlantısı bulunamadı.',422);
                    }
                    $row->$field=$id($target,$value);
                }
                if ($kind==='followups') {
                    $row->kind='Aşı';
                    if (!empty($row->done) && !self::date($row->done)) throw new RuntimeException($where.': uygulama tarihi geçersiz.',422);
                    if (in_array($row->status ?? '',['Tamamlandı','Yapıldı'],true) && empty($row->done)) {
                        throw new RuntimeException($where.': yapılmış aşı için uygulama tarihi gerekli.',422);
                    }
                    $row->status=!empty($row->done)?'Tamamlandı':(($row->status ?? '')==='İptal'?'İptal':'Planlandı');
                }
                if ($kind==='appointments') {
                    if (!preg_match('/\A([01]\d|2[0-3]):[0-5]\d\z/',$row->time)) throw new RuntimeException($where.': saat geçersiz.',422);
                    if (!in_array($row->status ?? '',['Bekliyor','Muayenede','Tamamlandı','İptal','Gelmedi'],true)) $row->status='Bekliyor';
                    if (($row->patient ?? '')!=='' && ($row->client ?? '')!=='' && ($known['patients'][$row->patient]->owner ?? '')!==$row->client) $row->patient='';
                }
                if ($kind==='exams') $row->status??='Tamamlandı';
                if ($kind==='sales') {
                    $row->paid??='0';
                    $row->method??='Nakit';
                    if (($row->patient ?? '')!=='' && ($known['patients'][$row->patient]->owner ?? '')!==($row->client ?? '')) $row->patient='';
                    try { $lines=json_decode($row->items,false,8,JSON_THROW_ON_ERROR); } catch (\Throwable) { throw new RuntimeException($where.': satış kalemleri geçersiz.',422); }
                    if (!is_array($lines)) throw new RuntimeException($where.': satış kalemleri geçersiz.',422);
                    foreach ($lines as $line) if (!is_object($line) || !empty($line->product) || ($line->stock ?? 'Hayır')!=='Hayır') {
                        throw new RuntimeException($where.': aktarılan satış kalemi stoktan düşmez; ürün bağlantısı kullanılamaz.',422);
                    }
                }
                $prior=$items[$key] ?? null;
                if ($prior && $prior->branch!==$branch) throw new RuntimeException($where.': şube uyuşmuyor.',409);
                $row=$prior ? (object)array_replace((array)$prior,(array)$row) : $row;
                if (in_array($kind,['clients','patients'],true)) ClinicProtocol::seal($kind,$row,$prior);
                $counts[$kind][$prior===null?'added':($prior==$row?'unchanged':'updated')]++;
                $items[$key]=$row;
            }
            $known[$kind]=array_filter($items,static fn($row)=>$row->branch===$branch);
            $next->$kind=array_values($items);
        }
        Finance::validate($state,$next);
        return [$next,$counts];
    }

    private static function date(string $value): bool
    {
        return preg_match('/\A(\d{4})-(\d{2})-(\d{2})\z/',$value,$parts)===1 &&
            checkdate((int)$parts[2],(int)$parts[3],(int)$parts[1]);
    }
}
