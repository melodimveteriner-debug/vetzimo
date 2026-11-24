<?php
declare(strict_types=1);
// Seçici kaydetme (PartialSave) her istekte tam yükleme yoluyla aynı kararı ve aynı sonucu üretmelidir.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,PartialSave,WorkspaceRepository,WorkspaceStream};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
final class StopBeforeWrite extends Exception { public function __construct(public object $next,public array $updates,public bool $partial){parent::__construct('stop');} }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Partial Test','05551000016','partial@example.test','Partial-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('y',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work); $repo=new WorkspaceRepository($db);
function cookies(array $login): array{return [SessionRepository::SESSION_COOKIE=>$login['token'],SessionRepository::DEVICE_COOKIE=>$login['device']];}
$dealer=cookies($login->signIn('05551000016','Partial-test-secret-42','192.0.2.20',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id']; $workspace='partner:'.$actor['partner_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->branches[]=(object)['id'=>'emek','name'=>'Emek','status'=>'Aktif','sharedWith'=>''];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Sahip A','phone'=>'05551000017'],(object)['id'=>'c2','branch'=>'merkez','name'=>'Sahip B','phone'=>'05551000018'],(object)['id'=>'c3','branch'=>'emek','name'=>'Sahip C','phone'=>'05551000019']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Mia','owner'=>'c1'],(object)['id'=>'p2','branch'=>'merkez','name'=>'Luna','owner'=>'c2'],(object)['id'=>'p3','branch'=>'emek','name'=>'Emek','owner'=>'c3'],(object)['id'=>'p4','branch'=>'merkez','name'=>'Boş','owner'=>'c2']];
$state->exams=[(object)['id'=>'e1','branch'=>'merkez','patient'=>'p1','date'=>'2026-01-02','title'=>'Muayene','status'=>'Tamamlandı','clinician'=>'Hekim','next'=>'2026-12-20','nextTime'=>'10:00']];
$state->appointments=[(object)['id'=>'a1','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>'2026-12-20','time'=>'10:00','service'=>'Kontrol','status'=>'Planlandı','controlExamId'=>'e1','clinician'=>'Hekim'],
  (object)['id'=>'a2','branch'=>'emek','patient'=>'p3','client'=>'c3','date'=>'2026-12-21','time'=>'11:00','service'=>'Aşı','status'=>'Planlandı']];
$items=fn($amount)=>json_encode([['name'=>'Hizmet','quantity'=>'1','price'=>$amount,'vat'=>'0','taxMode'=>'KDV Dahil','stock'=>'Hayır']]);
$state->sales=[(object)['id'=>'s1','branch'=>'merkez','client'=>'c1','date'=>'2026-01-02','detail'=>'Muayene','amount'=>'500','paid'=>'100','method'=>'Nakit','items'=>$items('500'),'stockAllocations'=>'[]']];
$state->collections=[(object)['id'=>'k1','branch'=>'merkez','sale'=>'s1','date'=>'2026-01-03','amount'=>'300']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$staffToken=explode('/',$identity->invite($actor,$scope,(object)['phone'=>'05551000020','name'=>'Personel','role'=>'staff','branchId'=>'merkez','customerId'=>'','method'=>'in-person','verifiedInPerson'=>true,'modules'=>(object)['patients'=>'read','appointments'=>'write']],$now)['link'])[2];
$identity->redeem((object)['token'=>$staffToken,'password'=>'Staff-secret-42'],$now);
$staff=cookies($login->signIn('05551000020','Staff-secret-42','192.0.2.21',$now));
$staffScope=$identity->actor($staff,$now)['membership_id'];

$attempt=function(array $who,string $whoScope,object $patch,bool $partial) use($api,$repo,$workspace,$now): array {
    PartialSave::$enabled=$partial;
    ClinicApi::$beforeWrite=static function($next,$updates,$used){ throw new StopBeforeWrite($next,$updates,$used); };
    try { $api->save($who,$whoScope,$now,(object)['revision'=>$repo->revision($workspace),'patch'=>json_decode(json_encode($patch))]); return ['error'=>'yazmaya ulaşmadı']; }
    catch (StopBeforeWrite $stop) { return ['next'=>$stop->next,'updates'=>$stop->updates,'partial'=>$stop->partial]; }
    catch (RuntimeException $error) { return ['error'=>$error->getCode().' '.$error->getMessage()]; }
    finally { ClinicApi::$beforeWrite=null; PartialSave::$enabled=true; }
};
$checked=0;
$same=function(string $name,array $who,string $whoScope,object $patch,?bool $usesPartial=true) use($attempt,$api,$repo,$workspace,$now,&$checked) {
    $full=$attempt($who,$whoScope,$patch,false); $part=$attempt($who,$whoScope,$patch,true);
    ok(($full['error']??null)===($part['error']??null),"$name: tam '".($full['error']??'kabul')."', seçici '".($part['error']??'kabul')."'");
    $checked++;
    if(getenv('VERBOSE')) echo str_pad($name,48).($part['error']??('kabul'.(($part['partial']??false)?' · seçici':' · tam yol')))."\n";
    if(isset($full['error'])) return;
    if($usesPartial!==null) ok($part['partial']===$usesPartial,"$name: seçici yol ".($part['partial']?'beklenmedik':'kullanılmadı'));
    $before=$repo->load($workspace)['state'];
    foreach($full['next'] as $key=>$rows) {
        if(!is_array($rows)||!array_is_list($rows)) { ok(json_encode($rows)===json_encode($part['next']->$key??null),"$name: $key üst verisi farklı"); continue; }
        $f=array_column($rows,null,'id'); $p=array_column($part['next']->$key??[],null,'id'); $o=array_column($before->$key??[],null,'id');
        foreach($p as $id=>$row) ok(isset($f[$id]) && $f[$id]==$row,"$name: $key/$id farklı");
        foreach($f as $id=>$row) if(!isset($o[$id])||$o[$id]!=$row) ok(isset($p[$id]),"$name: $key/$id seçici sonuçta yok");
    }
    ok($full['updates']==$part['updates'],"$name: istemci güncellemeleri farklı");
    $api->save($who,$whoScope,$now,(object)['revision'=>$repo->revision($workspace),'patch'=>json_decode(json_encode($patch))]);
    $after=$repo->load($workspace)['state'];
    foreach($full['next'] as $key=>$rows) if(is_array($rows)&&array_is_list($rows)&&$key!=='activity') ok(json_encode($after->$key??[])===json_encode($rows),"$name: kayıttan sonra $key tam yoldan farklı");
};

$same('yeni randevu',$dealer,$scope,(object)['appointments'=>['prepend'=>[(object)['id'=>'a3','branch'=>'merkez','patient'=>'p2','client'=>'c2','date'=>'2026-12-22','time'=>'09:00','service'=>'Kontrol','status'=>'Planlandı']]]]);
$same('liste sonuna ekleme',$dealer,$scope,(object)['weights'=>['append'=>[(object)['id'=>'w1','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-01','weight'=>'4.1']]]]);
$same('kontrol randevusu muayeneyle uyumsuz',$dealer,$scope,(object)['appointments'=>['update'=>[(object)['id'=>'a1','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>'2026-12-23','time'=>'10:00','service'=>'Kontrol','status'=>'Planlandı','controlExamId'=>'e1','clinician'=>'Hekim']]]]);
$same('muayene kontrol tarihi bağlı randevuyla birlikte',$dealer,$scope,(object)[
    'exams'=>['update'=>[(object)['id'=>'e1','branch'=>'merkez','patient'=>'p1','date'=>'2026-01-02','title'=>'Muayene','status'=>'Tamamlandı','clinician'=>'Hekim','next'=>'2026-12-24','nextTime'=>'12:00']]],
    'appointments'=>['update'=>[(object)['id'=>'a1','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>'2026-12-24','time'=>'12:00','service'=>'Kontrol','status'=>'Planlandı','controlExamId'=>'e1','clinician'=>'Hekim']]]]);
$same('ikinci kontrol randevusu',$dealer,$scope,(object)['appointments'=>['prepend'=>[(object)['id'=>'a4','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>'2026-12-24','time'=>'12:00','service'=>'Kontrol','status'=>'Planlandı','controlExamId'=>'e1','clinician'=>'Hekim']]]]);
$same('açık bakiyeyi aşan tahsilat',$dealer,$scope,(object)['collections'=>['prepend'=>[(object)['id'=>'k2','branch'=>'merkez','sale'=>'s1','date'=>'2026-01-04','amount'=>'101']]]]);
$same('açık bakiyeye uygun tahsilat',$dealer,$scope,(object)['collections'=>['prepend'=>[(object)['id'=>'k3','branch'=>'merkez','sale'=>'s1','date'=>'2026-01-04','amount'=>'100']]]]);
$same('başka şubedeki hastaya bağlama',$dealer,$scope,(object)['exams'=>['prepend'=>[(object)['id'=>'e2','branch'=>'merkez','patient'=>'p3','date'=>'2026-01-05','title'=>'Muayene']]]]);
$same('hasta sahibi değişir (tam yol)',$dealer,$scope,(object)['patients'=>['update'=>[(object)['id'=>'p4','branch'=>'merkez','name'=>'Boş','owner'=>'c1','protocol'=>'HT-p4']]]],false);
$same('personel randevu ekler',$staff,$staffScope,(object)['appointments'=>['prepend'=>[(object)['id'=>'a5','branch'=>'merkez','patient'=>'p2','date'=>'2026-12-26','time'=>'15:00','service'=>'Kontrol','status'=>'Planlandı']]]]);
$same('personel hasta değiştiremez',$staff,$staffScope,(object)['patients'=>['update'=>[(object)['id'=>'p1','branch'=>'merkez','name'=>'Değişti','owner'=>'c1','protocol'=>'HT-p1']]]]);
$same('personel başka şubeye yazamaz',$staff,$staffScope,(object)['appointments'=>['prepend'=>[(object)['id'=>'a6','branch'=>'emek','patient'=>'p3','date'=>'2026-12-26','time'=>'16:00','service'=>'Kontrol','status'=>'Planlandı']]]]);
$same('personel başka şubenin kaydını güncelleyemez',$staff,$staffScope,(object)['appointments'=>['update'=>[(object)['id'=>'a2','branch'=>'emek','patient'=>'p3','client'=>'c3','date'=>'2026-12-21','time'=>'11:30','service'=>'Aşı','status'=>'Planlandı']]]]);
$all=$repo->load($workspace)['state'];
ok(count($all->patients)===4 && count($all->clients)===3 && count($all->appointments)===4,'Seçici kayıt gizli kayıtları silmemeli');
ok($all->appointments[0]->id==='a5' && $all->weights[0]->id==='w1','Yeni kayıt sırası korunmalı');
// Akıtılan açılış verisi, eski yoldaki (visibleFor + json) veriyle birebir aynı olmalı.
$db->prepare("UPDATE clinic_record SET record_data=JSON_REMOVE(record_data,'$.protocol') WHERE collection='patients' AND row_key='@p2'")->execute();
foreach ([['hekim',$dealer],['personel',$staff]] as [$label,$who]) {
    $who_actor=$work->actor($who,$now);
    $session=static fn(?object $visible)=>['branches'=>$visible->branches??[],'role'=>$who_actor['role']];
    ob_start();
    ok((new WorkspaceStream($db))->send($who_actor,$session),"$label: akıtma kullanılmadı");
    $streamed=ob_get_clean();
    $data=$work->visibleFor($who_actor);
    $expected=json_encode($data+['session'=>$session($data['state'])],JSON_UNESCAPED_UNICODE);
    ok(json_decode($streamed,true)===json_decode($expected,true),"$label: akıtılan veri eski yoldan farklı");
    ok(!$db->inTransaction(),"$label: okuma işlemi açık kaldı");
}
echo "PASS seçici kaydetme $checked senaryoda tam yolla aynı karar ve aynı sonuç (hekim ve personel, şube yalıtımı, kontrol randevusu, tahsilat bakiyesi, sıra); akıtılan açılış verisi eski yolla aynı\n";
