<?php
declare(strict_types=1);
// Personele göre web randevusu: her personelin takvimi ayrıdır, “Fark etmez” ilk boş kişiye atar,
// atanmamış randevu ortak kapasiteden düşer, izindeki personele saat açılmaz, aynı saate iki randevu verilmez.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,WebBuilder,WebBooking};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Staff Test','05551000046','staff@example.test','Staff-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('s',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000046','Staff-test-secret-42','192.0.2.50',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=$identity->actor($dealer,$now); $partner=$actor['partner_id'];
foreach ([['acc-a','mem-a','Ayşe Yılmaz'],['acc-m','mem-m','Mehmet Kara']] as [$account,$member,$name]) {
    $db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES (?,'phone',?)")->execute([$account,'0555'.random_int(1000000,9999999)]);
    $db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,name,modules,status) VALUES (?,?,?,'staff','merkez',?,'{}','active')")->execute([$member,$account,$partner,$name]);
}
$web=new WebBuilder($db,['origin'=>'https://example.test']); $booking=new WebBooking($db,$web);
$tz=new DateTimeZone('Europe/Istanbul'); $date=new DateTimeImmutable('+2 days',$tz); $day=$date->format('Y-m-d');
$draft=['booking'=>['enabled'=>true,'branches'=>['merkez'],'duration'=>30,'hours'=>['merkez'=>[$date->format('N')=>[['09:00','10:00']]]],'providers'=>['merkez'=>''],'staff'=>['merkez'=>['mem-a','mem-m']]]];
$site=['partner_id'=>$partner];
$data=$work->read($dealer,$now); $state=$data['state'];
$slots=fn(string $staff='')=>array_map(static fn($s)=>$s->clinician,$booking->slots($site,$draft,'merkez',$day,$state,$staff));
ok($booking->staffOptions($site,$draft,'merkez')===['mem-a'=>'Ayşe Yılmaz','mem-m'=>'Mehmet Kara'],'Seçilebilir personel listesi yanlış');
ok($slots()===['09:00'=>'Ayşe Yılmaz','09:30'=>'Ayşe Yılmaz'],'Boş takvimde iki saat açılmalı');
ok($slots('mem-m')===['09:00'=>'Mehmet Kara','09:30'=>'Mehmet Kara'],'Seçilen personel randevuya yazılmalı');
ok($slots('yok')===[],'Listede olmayan personele saat açılmamalı');
$appointment=static fn(string $id,string $time,string $who)=>(object)['id'=>$id,'branch'=>'merkez','date'=>$day,'time'=>$time,'endTime'=>'','status'=>'Planlandı','clinician'=>$who];
$state->appointments=[$appointment('a1','09:00','ayşe yilmaz')];
ok($slots('mem-a')===['09:30'=>'Ayşe Yılmaz'],'Dolu personel aynı saatte yeniden randevu almamalı (yazım farkı da eşleşmeli)');
ok($slots('mem-m')===['09:00'=>'Mehmet Kara','09:30'=>'Mehmet Kara'],'Bir personelin randevusu diğerini engellememeli');
ok($slots()===['09:00'=>'Mehmet Kara','09:30'=>'Ayşe Yılmaz'],'Fark etmez seçeneği ilk boş kişiye atamalı');
ok(array_keys($booking->slots($site,$draft,'merkez',$day,$state,'mem-a','a1'))===['09:00','09:30'],'Taşınan randevu kendi saatini engellememeli');
$state->appointments[]=$appointment('a2','09:00','Klinik ataması bekleniyor');
ok($slots()===['09:30'=>'Ayşe Yılmaz'] && $slots('mem-m')===['09:30'=>'Mehmet Kara'],'Atanmamış randevu ortak kapasiteden düşmeli');
$db->prepare("INSERT INTO clinic_staff_plan(partner_id,account_id,member_id,branch_id,kind,status,starts,ends,created_by,changed_by) VALUES (?,'acc-m','mem-m','merkez','leave','approved',?,?,'t','t')")
    ->execute([$partner,$day.' 09:30:00',$day.' 12:00:00']);
ok($slots('mem-m')===[] && $slots()===['09:30'=>'Ayşe Yılmaz'],'İzindeki personele saat açılmamalı');
$draft['booking']['staff']['merkez']=[];
ok($booking->staffOptions($site,$draft,'merkez')===[] && array_map(static fn($s)=>$s->clinician,$booking->slots($site,$draft,'merkez',$day,$state))===['09:30'=>'Klinik ataması bekleniyor'],'Liste boşsa eski tek takvim davranışı sürmeli');
echo "PASS Personele göre web randevusu: ayrı takvimler, fark etmez ataması, atanmamış kapasite, izin, taşıma\n";
