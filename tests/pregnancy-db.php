<?php
declare(strict_types=1);
// Doğum takibi kayıt akışı: başlat, beklenen yavru sayısı (sınırlar), tarih düzeltmede korunur, doğumda kapanır, yeni gebelikte sıfırlanır.
require __DIR__.'/../src/Database.php';
require __DIR__.'/../src/Pregnancy.php';
use VetNet\Cpanel\{Database,Pregnancy};
function ok(bool $c,string $m){if(!$c){fwrite(STDERR,"HATA: $m\n");exit(1);}}
function rejected(callable $f,string $m){try{$f();}catch(RuntimeException $e){if($e->getCode()===422)return;}fwrite(STDERR,"HATA: $m\n");exit(1);}
$db=Database::connect((string)getenv('VETNET_TEST_DSN'),'root','');
$p=new Pregnancy($db);$now=time();$mate=(new DateTimeImmutable('-40 days'))->format('Y-m-d');
rejected(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>4],'clinic','Dr',$now),'takip yokken yavru sayısı girilmemeli');
$r=$p->save('pt','p1','Köpek',(object)['mating'=>$mate],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===null,'başta beklenen yavru boş');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>'6'],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===6,'beklenen yavru kaydı');
rejected(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>25],'clinic','Dr',$now),'20 üstü reddedilmeli');
$r=$p->save('pt','p1','Köpek',(object)['mating'=>(new DateTimeImmutable('-41 days'))->format('Y-m-d')],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===6,'tarih düzeltmede beklenen sayı korunmalı');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>null],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===null,'beklenen sayı silinebilmeli');
// Kontrol sonuçları ve anı fotoğrafları
$forbidden=function(callable $f,string $m){try{$f();}catch(RuntimeException $e){if($e->getCode()===403)return;}fwrite(STDERR,"HATA: $m\n");exit(1);};
$forbidden(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'check','kind'=>'us','count'=>5],'owner','Sahip',$now),'hasta sahibi kontrol sonucu girmemeli');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'check','kind'=>'us','date'=>(new DateTimeImmutable('-10 days'))->format('Y-m-d'),'count'=>5,'heart'=>'heard','fluid'=>'Normal','note'=>'İyi'],'clinic','Dr',$now);
ok($r['pregnancy']['checks']['us']['count']===5 && $r['pregnancy']['expected']===5,'ultrason sonucu ve beklenen sayı');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'check','kind'=>'xray','count'=>7,'heart'=>'','fluid'=>'Az'],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===7 && $r['pregnancy']['checks']['xray']['fluid']==='Az','röntgen sayısı öncelikli');
rejected(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'check','kind'=>'us','fluid'=>'Çok'],'clinic','Dr',$now),'geçersiz amnion değeri reddedilmeli');
$png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
$forbidden(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'photo','kind'=>'us','image'=>$png],'owner','Sahip',$now),'hasta sahibi ultrason fotoğrafı eklememeli');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'photo','kind'=>'family','image'=>$png,'note'=>'Ailecek'],'owner','Sahip',$now);
ok(($r['pregnancy']['photos']['family']['note'] ?? '')==='Ailecek' && $p->photo('pt','p1','family')===$png,'aile fotoğrafı ve notu');
$r=$p->save('pt','p1','Köpek',(object)['action'=>'photo','kind'=>'family','note'=>'Yeni not'],'owner','Sahip',$now);
ok($p->photo('pt','p1','family')===$png && $r['pregnancy']['photos']['family']['note']==='Yeni not','yalnız not değişince fotoğraf korunmalı');
rejected(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'photo','kind'=>'xray','image'=>'data:image/png;base64,QUJD'],'clinic','Dr',$now),'bozuk fotoğraf reddedilmeli');
$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>3],'owner','Sahip',$now);
$p->save('pt','p1','Köpek',(object)['action'=>'end','ended'=>(new DateTimeImmutable('today'))->format('Y-m-d'),'litter'=>3,'healthy'=>3],'clinic','Dr',$now);
rejected(fn()=>$p->save('pt','p1','Köpek',(object)['action'=>'expected','expected'=>2],'clinic','Dr',$now),'doğumdan sonra beklenen sayı değişmemeli');
$r=$p->save('pt','p1','Köpek',(object)['mating'=>(new DateTimeImmutable('-2 days'))->format('Y-m-d')],'clinic','Dr',$now);
ok($r['pregnancy']['expected']===null && $r['pregnancy']['ended']===null && $r['pregnancy']['checks']===[] && $r['pregnancy']['photos']===[],'yeni gebelikte eski sayı, kontroller ve fotoğraflar sıfırlanmalı');
echo "pregnancy-db ok\n";
