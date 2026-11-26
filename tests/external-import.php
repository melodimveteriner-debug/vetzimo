<?php
declare(strict_types=1);
// KolayVET aktarımı: randevu, muayene, satış ve tahsilat tabloları; isteğe bağlı bağlantılar ve tekrar yüklemede yinelenmeme.
foreach (['ClinicProtocol','ClinicAccess','Finance','ExternalImport'] as $c) require_once __DIR__.'/../src/'.$c.'.php';
use VetNet\Cpanel\ExternalImport;
function check(bool $ok,string $msg): void { if(!$ok){fwrite(STDERR,"HATA: $msg\n");exit(1);} }
$state=(object)['branches'=>[(object)['id'=>'merkez','name'=>'Merkez','status'=>'Aktif']]];
foreach (['clients','patients','suppliers','products','vaccineCatalog','followups','stockLots','stockMoves','appointments','exams','sales','collections','purchases','payments','expenses'] as $k) $state->$k=[];
$items=fn($a)=>json_encode([['name'=>'Muayene','quantity'=>'2','price'=>(string)($a/2),'vat'=>'0','taxMode'=>'KDV Dahil','stock'=>'Hayır']]);
$src=json_decode(json_encode([
 'clients'=>[['id'=>'c-1','name'=>'Ayşe']], 'patients'=>[['id'=>'p-1','name'=>'Tekir','owner'=>'c-1']],
 'appointments'=>[['id'=>'r-1','date'=>'2026-12-01','time'=>'10:30','client'=>'c-1','patient'=>'p-1','status'=>'Tamamlandı'],['id'=>'r-2','date'=>'2026-12-02','time'=>'11:00','status'=>'Bilinmez']],
 'exams'=>[['id'=>'m-1','date'=>'2026-11-01','patient'=>'p-1','weight'=>'4.2']],
 'sales'=>[['id'=>'s-1','date'=>'2026-11-01','amount'=>'300','items'=>$items(300),'client'=>'c-1'],['id'=>'s-2','date'=>'2026-11-02','amount'=>'100','items'=>$items(100)]],
 'collections'=>[['id'=>'t-1','sale'=>'s-1','date'=>'2026-11-03','amount'=>'200']],
]));
[$next,$counts]=ExternalImport::merge($state,$src,'merkez');
foreach (['appointments'=>2,'exams'=>1,'sales'=>2,'collections'=>1] as $k=>$n) check($counts[$k]['added']===$n,"$k eklenmedi");
check(in_array('Bekliyor',array_column($next->appointments,'status'),true),'bilinmeyen durum Bekliyor olmalı');
check($next->sales[1]->client==='' && $next->sales[1]->paid==='0','müşterisiz satış');
check($next->collections[0]->sale===$next->sales[0]->id,'tahsilat satışa bağlı');
[$again,$c2]=ExternalImport::merge($next,$src,'merkez');
check($c2['sales']['unchanged']===2 && $c2['collections']['unchanged']===1 && $c2['sales']['added']===0,'tekrar yükleme yineledi');
$bad=json_decode(json_encode(['collections'=>[['id'=>'t-9','sale'=>'s-1','date'=>'2026-11-04','amount'=>'150']]]));
try { ExternalImport::merge($next,$bad,'merkez'); check(false,'fazla tahsilat kabul edildi'); } catch (RuntimeException $e) { check(str_contains($e->getMessage(),'açık bakiye'),'fazla tahsilat hatası: '.$e->getMessage()); }
$stock=json_decode(json_encode(['sales'=>[['id'=>'s-9','date'=>'2026-11-01','amount'=>'10','items'=>json_encode([['name'=>'X','quantity'=>'1','price'=>'10','vat'=>'0','taxMode'=>'KDV Dahil','stock'=>'Evet','product'=>'u-1']])]]]));
try { ExternalImport::merge($next,$stock,'merkez'); check(false,'stoklu kalem kabul edildi'); } catch (RuntimeException $e) { check(str_contains($e->getMessage(),'stoktan düşmez'),'stok hatası'); }
echo "external-import tamam\n";
