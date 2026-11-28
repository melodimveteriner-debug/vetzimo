<?php
declare(strict_types=1);
// Aşı devamları: aktarımdan gelen yenileme birimleri ("aylık", "yil") tanınır; son yapılan dozdan sonra planlı doz
// yoksa Aşı Listesi aralığına göre sonraki aşı oluşturulur; planlı olan, iptal, pasif hasta, 1 yıldan eski gecikme
// atlanır; kimliksiz aktarılan aşı ada (ve hastanın türüne) göre eşlenir; tekrar çalıştırmak ve eşzamanlı
// çalıştırmak çift kayıt oluşturmaz; aktarım (ExternalImport) devamları kendiliğinden oluşturur.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,Commerce,VaccineContinuation,WorkspaceRepository};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$dsn=getenv('VETNET_TEST_DSN');
if (($argv[1] ?? '')==='child') {
    $db=Database::connect($dsn,'root','');
    $actor=json_decode($argv[2],true);
    try { echo json_encode(VaccineContinuation::run($db,new WorkspaceRepository($db),$actor,true,time())); }
    catch (RuntimeException $e) { echo 'E'.$e->getCode(); }
    exit(0);
}
// Birimler ve tarih hesabı
foreach (['aylık'=>'Ay','Ay'=>'Ay','ay'=>'Ay','AYLIK'=>'Ay','month'=>'Ay','yıllık'=>'Yıl','yil'=>'Yıl','Yıl'=>'Yıl','gün'=>'Gün','gunluk'=>'Gün','hafta'=>'Hafta','haftalık'=>'Hafta','x'=>''] as $in=>$out)
    ok(VaccineContinuation::unit($in)===$out,"Birim '$in' → ".VaccineContinuation::unit($in));
ok(VaccineContinuation::next('2026-01-31',1,'aylık')==='2026-02-28','Ay sonu taşması');
ok(VaccineContinuation::next('2024-02-29',1,'yıllık')==='2025-02-28','Artık yıl');
ok(VaccineContinuation::next('2026-03-10',2,'hafta')==='2026-03-24' && VaccineContinuation::next('2026-03-10',0,'Ay')==='','Hafta/0 aralık');

$today='2026-11-28';
$st=fn()=>(object)[
  'branches'=>[(object)['id'=>'merkez','name'=>'Merkez']],
  'patients'=>[(object)['id'=>'p1','branch'=>'merkez','name'=>'ÇİLEK','species'=>'Kedi'],(object)['id'=>'p2','branch'=>'merkez','name'=>'Pasif','species'=>'Kedi','status'=>'Pasif'],(object)['id'=>'p3','branch'=>'merkez','name'=>'Karabaş','species'=>'Köpek']],
  'vaccineCatalog'=>[(object)['id'=>'v1','branch'=>'merkez','name'=>'İç - Dış Parazit','species'=>'Kedi','renewEvery'=>'2','renewUnit'=>'aylık'],
     (object)['id'=>'v2','branch'=>'merkez','name'=>'Karma 1 Aşısı','species'=>'Kedi','renewEvery'=>'0','renewUnit'=>''],
     (object)['id'=>'v3','branch'=>'merkez','name'=>'Kuduz Aşısı','species'=>'Kedi','renewEvery'=>'1','renewUnit'=>'yıllık'],
     (object)['id'=>'v4','branch'=>'merkez','name'=>'Kuduz Aşısı','species'=>'Köpek','renewEvery'=>'6','renewUnit'=>'Ay']],
  'followups'=>[
     // parazit: yapıldı 16.11.2026 → 16.01.2027
     (object)['id'=>'f1','branch'=>'merkez','patient'=>'p1','kind'=>'Aşı','title'=>'İç - Dış Parazit','vaccine'=>'v1','date'=>'2026-09-04','done'=>'2026-09-04','status'=>'Tamamlandı'],
     (object)['id'=>'f2','branch'=>'merkez','patient'=>'p1','kind'=>'Aşı','title'=>'İç - Dış Parazit','vaccine'=>'v1','date'=>'2026-11-04','done'=>'2026-11-16','status'=>'Tamamlandı'],
     // karma: yenilenmez
     (object)['id'=>'f3','branch'=>'merkez','patient'=>'p1','kind'=>'Aşı','title'=>'Karma 1 Aşısı','vaccine'=>'v2','date'=>'2026-09-11','done'=>'2026-09-12','status'=>'Tamamlandı'],
     // kuduz: kimliksiz aktarıldı, ada göre (kedi tanımı 1 yıl) → 23.11.2026 + 1 yıl
     (object)['id'=>'f4','branch'=>'merkez','patient'=>'p1','kind'=>'Aşı','title'=>'kuduz  aşısı','vaccine'=>'','date'=>'2026-11-23','done'=>'2026-11-23','status'=>'Tamamlandı'],
     // köpek kuduz: ada göre köpek tanımı (6 ay); zaten planlı devamı var → eklenmez
     (object)['id'=>'f5','branch'=>'merkez','patient'=>'p3','kind'=>'Aşı','title'=>'Kuduz Aşısı','vaccine'=>'','date'=>'2026-06-01','done'=>'2026-06-01','status'=>'Tamamlandı'],
     (object)['id'=>'f6','branch'=>'merkez','patient'=>'p3','kind'=>'Aşı','title'=>'Kuduz Aşısı','vaccine'=>'','date'=>'2026-12-01','status'=>'Planlandı'],
     // pasif hasta → atlanır; çok eski (2023) → atlanır; iptal sayılmaz
     (object)['id'=>'f7','branch'=>'merkez','patient'=>'p2','kind'=>'Aşı','title'=>'İç - Dış Parazit','vaccine'=>'v1','date'=>'2026-10-01','done'=>'2026-10-01','status'=>'Tamamlandı'],
     (object)['id'=>'f8','branch'=>'merkez','patient'=>'p3','kind'=>'Aşı','title'=>'İç - Dış Parazit','vaccine'=>'v1','date'=>'2023-01-01','done'=>'2023-01-01','status'=>'Tamamlandı'],
     (object)['id'=>'f9','branch'=>'merkez','patient'=>'p3','kind'=>'Aşı','title'=>'Karma 1 Aşısı','vaccine'=>'v2','date'=>'2026-01-01','status'=>'İptal'],
     // sihirbazdan kayıtlı aralık (kayıt > liste): 3 hafta
     (object)['id'=>'f10','branch'=>'merkez','patient'=>'p3','kind'=>'Aşı','title'=>'Özel','date'=>'2026-11-20','done'=>'2026-11-20','status'=>'Tamamlandı','renewEvery'=>'3','renewUnit'=>'Hafta'],
  ]];
$plan=VaccineContinuation::plan($st(),$today);
$by=[];foreach ($plan['add'] as $r) $by[$r->previousId]=$r;
ok(isset($by['f2']) && $by['f2']->date==='2027-01-16' && $by['f2']->status==='Planlandı' && $by['f2']->kind==='Aşı','Parazit devamı yanlış: '.json_encode($by['f2'] ?? null));
ok(!isset($by['f1']),'Eski doz için devam oluştu (yalnız son doz)');
ok(isset($by['f4']) && $by['f4']->date==='2027-11-23','Ada/türe göre kuduz devamı yanlış: '.json_encode($by['f4'] ?? null));
ok(!isset($by['f5']),'Planlı devamı olan aşı için yeniden oluştu');
ok(!isset($by['f3']),'Yenilenmeyen aşı için devam oluştu');
ok(!isset($by['f7']),'Pasif hasta için devam oluştu');
ok(!isset($by['f8']) && $plan['skippedOld']===1,'1 yıldan eski gecikme oluşturuldu');
ok(isset($by['f10']) && $by['f10']->date==='2026-12-11','Kayıttaki aralık (sihirbaz) kullanılmadı');
ok(count($plan['add'])===3,'Toplam devam sayısı: '.count($plan['add']));
ok($plan['units']===['v1'=>'Ay','v3'=>'Yıl'],'Birim düzeltmesi: '.json_encode($plan['units']));
$s=$st(); $r1=VaccineContinuation::apply($s,$today); $r2=VaccineContinuation::apply($s,$today);
ok($r1['added']===3 && $r2['added']===0 && $s->vaccineCatalog[0]->renewUnit==='Ay','Tekrar uygulamada çift kayıt/birim yanlış');

// Uçtan uca: çalışma alanı + 6 eşzamanlı uygulama → bir kez eklenir; yetki
$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('Aşı Test','05551000411','asi@example.test','Asi-test-secret-4242');
$now=time();$login=new DealerLogin($db,str_repeat('v',32));$work=new DealerWorkspace($db);$api=new ClinicApi($work);
$l=$login->signIn('05551000411','Asi-test-secret-4242','192.0.2.160',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor((new IdentityApi($db))->actor($cookies,$now));
$data=$work->read($cookies,$now); $w=$data['state']; $t=$st();
foreach (['patients','followups'] as $c) $w->$c=$t->$c;
foreach ($t->vaccineCatalog as $c) $w->vaccineCatalog[]=$c;
foreach ($w->followups as $f) $f->done=$f->done ?? '';
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$w]);
$prev=$work->vaccineContinuations($cookies,'',$now,false);
ok($prev['count']===3 && $prev['units']===2,'Önizleme yanlış: '.json_encode($prev));
$procs=[];$pp=[];
for ($k=0;$k<6;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child',json_encode($actor)],[1=>['pipe','w'],2=>['pipe','w']],$pp[$k],null,['VETNET_TEST_DSN'=>$dsn]);
$outs=[];foreach ($procs as $k=>$p) { $outs[]=stream_get_contents($pp[$k][1]); $e=stream_get_contents($pp[$k][2]); proc_close($p); ok($e==='','Alt süreç: '.$e); }
$after=$work->read($cookies,$now)['state'];
$vc=array_filter($after->followups,fn($f)=>str_starts_with($f->id,'vc-'));
ok(count($vc)===3,'Eşzamanlı uygulamada '.count($vc).' devam oluştu: '.implode(' ',$outs));
ok($work->vaccineContinuations($cookies,'',$now,false)['count']===0,'Uygulamadan sonra hâlâ eksik görünüyor');
$read=$actor; $read['role']='staff'; $read['branch_id']='merkez'; $read['modules']=json_encode(['followups'=>'read']);
try { VaccineContinuation::run($db,new WorkspaceRepository($db),$read,true,$now); $x=true; } catch (RuntimeException $e) { $x=$e->getCode()!==403; }
ok(!$x,'Okuma yetkili personel devam oluşturdu');
echo "Aşı devamı testleri geçti\n";
