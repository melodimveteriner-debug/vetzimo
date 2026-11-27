<?php
declare(strict_types=1);
// Ölçek testi: çok bayi + büyük klinik. Bellek/süre bütçeleri ve büyük veride doğru davranış (KolayVET benzeri).
$root=dirname(__DIR__);
foreach (glob($root.'/src/*.php') as $f) require_once $f;
use VetNet\Cpanel\{Database,WorkspaceRepository,ClinicRecords,IdentityApi,DeliveryNotice,AppointmentReminders,DailyNote,CenterAnalytics};
function ok(bool $c,string $m): void { if(!$c){fwrite(STDERR,"HATA: $m\n");exit(1);} }
function measure(callable $fn): array { gc_collect_cycles(); memory_reset_peak_usage(); $base=memory_get_usage(); $t=microtime(true); $r=$fn(); return [$r,(memory_get_peak_usage()-$base)>>20,microtime(true)-$t]; }
$db=Database::connect((string)getenv('VETNET_TEST_DSN'),'root','');
$repo=new WorkspaceRepository($db);
$now=strtotime('2026-11-26 12:00:00 +03:00');
$base=fn(string $name)=>(object)['version'=>1,'demo'=>false,'preferences'=>(object)['clinic'=>$name,'customerReminder_followups_mode'=>'auto','customerReminder_followups_sms'=>'Evet'],
    'branches'=>[(object)['id'=>'merkez','name'=>'Merkez','status'=>'Aktif']]];
$partner=fn(int $i)=>md5('scale-'.$i);
$insert=$db->prepare("INSERT INTO partner_account(id,code,name,email,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,NOW(),NOW())");
$member=$db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES (?,'phone',?,'x',1)");
$membership=$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES (?,?,?,'dealer',?,'{}','active')");

// 1) Büyük klinik: 3.000 müşteri/hasta, 12.000 aşı (yarısı yıllar önce yapılmamış), 12.000 satış + tahsilat
$big=$partner(0);
$insert->execute([$big,'BIG',"Büyük Klinik",'big@scale.test','05000000000']);
$member->execute([md5('acc0'),'05000000000']); $membership->execute([md5('mem0'),md5('acc0'),$big,'Büyük Klinik']);
$s=$base('Büyük Klinik');
$day=fn(int $k)=>date('Y-m-d',strtotime('2026-11-26 '.(($k%1500)-1400).' days'));
for($k=0;$k<3000;$k++){
    $s->clients[]=(object)['id'=>"c$k",'branch'=>'merkez','name'=>"Müşteri $k",'phone'=>sprintf('0532%07d',$k),'sms'=>'Var'];
    $s->patients[]=(object)['id'=>"p$k",'branch'=>'merkez','name'=>"Pati $k",'owner'=>"c$k",'species'=>'Kedi'];
}
for($k=0;$k<12000;$k++){
    $d=$day($k);
    $s->followups[]=(object)['id'=>"f$k",'branch'=>'merkez','patient'=>'p'.($k%3000),'title'=>'Karma aşı','kind'=>'Aşı','date'=>$d,'status'=>$k%2?'Tamamlandı':'Planlandı','done'=>$k%2?$d:''];
    $s->sales[]=(object)['id'=>"s$k",'branch'=>'merkez','client'=>'c'.($k%3000),'date'=>$d,'amount'=>'300','paid'=>'0','detail'=>'Muayene',
        'items'=>'[{"name":"Muayene","quantity":"1","price":"300","vat":"0","taxMode":"KDV Dahil","stock":"Hayır"}]'];
    $s->collections[]=(object)['id'=>"t$k",'branch'=>'merkez','sale'=>"s$k",'date'=>$d,'amount'=>'100'];
}
$s->exams=[(object)['id'=>'e1','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-20','title'=>'Kontrol']];
$s->labs=[];
ok($repo->save('partner:'.$big,0,$s)!==null,'büyük klinik kaydedilemedi');
unset($s);

// 2) 1.500 küçük bayi
for($i=1;$i<=1500;$i++){
    $p=$partner($i); $insert->execute([$p,'S'.$i,"Klinik $i","s$i@scale.test",sprintf('051%08d',$i)]);
    $member->execute([md5("acc$i"),sprintf('051%08d',$i)]); $membership->execute([md5("mem$i"),md5("acc$i"),$p,"Klinik $i"]);
    $st=$base("Klinik $i"); $st->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'A','phone'=>'05320000000']];
    $st->appointments=[(object)['id'=>'r1','branch'=>'merkez','client'=>'c1','date'=>'2026-11-27','time'=>'10:00','status'=>'Bekliyor','service'=>'Kontrol']];
    $repo->save('partner:'.$p,0,$st);
}

// Seçici okuma: yalnız istenen tablolar, tam yüklemeden çok daha az bellek
[$full,$fullMb]=measure(fn()=>$repo->load('partner:'.$big)['state']);
$fullSales=count($full->sales); unset($full);
[$part,$partMb,$partSec]=measure(fn()=>(new ClinicRecords($db))->collections('partner:'.$big,['clients','patients']));
ok(count($part->clients)===3000 && count($part->patients)===3000 && $part->sales===[] && $fullSales===12000,'seçici okuma içeriği');
ok($partMb*4<$fullMb,"seçici okuma belleği ($partMb MB) tam yüklemenin ($fullMb MB) dörtte birinden az olmalı");
unset($part);

// Ekip ve yetkiler ekranı: büyük klinikte 128 MB sunucuda çalışmalı
[$dir,$dirMb,$dirSec]=measure(fn()=>(new IdentityApi($db))->directory(['role'=>'dealer','partner_id'=>$big,'account_id'=>md5('acc0')]));
ok(count($dir['clients'])===3000,'directory müşteri listesi');
ok($dirMb<40,"directory belleği $dirMb MB (<40 olmalı)");

// Tek kayıt ekleme (web randevu talebi): tüm klinik yazılmaz; revizyon artar, eski revizyonla ekleme reddedilir
$rev=(int)$db->query("SELECT revision FROM clinic_workspace WHERE user_id='partner:$big'")->fetchColumn();
$row=(object)['id'=>'web-'.str_repeat('a',32),'branch'=>'merkez','date'=>'2026-12-01','time'=>'10:00','status'=>'Onay Bekliyor','service'=>'Aşı'];
[$newRev,$appMb,$appSec]=measure(fn()=>$repo->append('partner:'.$big,$rev,'appointments',$row));
ok($newRev===$rev+1,'ekleme revizyonu artırmalı');
ok($repo->append('partner:'.$big,$rev,'appointments',$row)===null,'eski revizyonla ekleme reddedilmeli');
$after=(new ClinicRecords($db))->collections('partner:'.$big,['appointments','clients']);
ok(end($after->appointments)->id===$row->id && count($after->clients)===3000,'eklenen randevu sonda, diğer tablolar aynı');
ok($appSec<1 && $appMb<16,"ekleme ".round($appSec,2)." sn / $appMb MB");
unset($after);

// Hatırlatma işleri: seçici okuma ile tam yüklemedekiyle aynı işler çıkmalı
$sel=(new ClinicRecords($db))->collections('partner:'.$big,['appointments','followups','patients','clients']);
$all=$repo->load('partner:'.$big)['state'];
ok(AppointmentReminders::jobs($sel,'Büyük Klinik',$now)==AppointmentReminders::jobs($all,'Büyük Klinik',$now),'hatırlatma işleri seçici okumada değişmemeli');
unset($sel,$all);

// Klinik bildirimleri: yıllar önce yapılmamış aşılar e-posta seline dönüşmemeli; 1.501 bayi makul sürede taranmalı
[, $qMb,$qSec]=measure(fn()=>(new DeliveryNotice($db))->queueClinicReminders($now));
$followNotices=(int)$db->query("SELECT COUNT(*) FROM clinic_delivery_notice WHERE partner_id='$big' AND title='Aşı ve takip uyarısı'")->fetchColumn();
ok($followNotices<=40,"eski yapılmamış aşılar için bildirim açılmamalı (açılan: $followNotices)");
ok($qSec<60,"1.501 bayi bildirim taraması ".round($qSec,1)." sn (<60)");
ok($qMb<64,"bildirim taraması belleği $qMb MB (<64)");

// Günlük ekip notu: tüm bayilere tek seferlik
[$sent,, $fSec]=measure(fn()=>(new DailyNote($db))->fanout($now));
ok($fSec<30,"günlük not dağıtımı ".round($fSec,1)." sn (<30)");

// Merkez paneli: bayi listesi sayfalı, analiz makul sürede
[, $aMb,$aSec]=measure(fn()=>(new CenterAnalytics($db))->get(true,$now));
ok($aSec<30 && $aMb<128,"merkez analizi ".round($aSec,1)." sn / $aMb MB");
printf("scale ok · tam yükleme %d MB, seçici %d MB, directory %d MB %.2fs, bildirim taraması %.1fs, analiz %.1fs\n",$fullMb,$partMb,$dirMb,$dirSec,$qSec,$aSec);
