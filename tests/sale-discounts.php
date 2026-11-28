<?php
declare(strict_types=1);
// Kalanı indirimle kapatma (sunucuda): gerçek kalan tüm kayıtlardan hesaplanır; tarayıcı eski olsa da kapanmış satış
// atlanır, diğerleri kapanır ("Ödeme toplamı açık bakiyeyi aşamaz" çıkmaz); kasaya para girmez; 6 eşzamanlı istekte
// her satış bir kez kapanır; yetkisiz personel kapatamaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,Commerce,SaleDiscounts,WorkspaceRepository};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$dsn=getenv('VETNET_TEST_DSN');
if (($argv[1] ?? '')==='child') {
    $db=Database::connect($dsn,'root','');
    try { echo json_encode(SaleDiscounts::close($db,new WorkspaceRepository($db),json_decode($argv[2],true),['s1','s2','s3'],time())); } catch (RuntimeException $e) { echo 'E'.$e->getCode(); }
    exit(0);
}
$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('İndirim Test','05551000511','ind@example.test','Indirim-test-4242');
$now=time();$login=new DealerLogin($db,str_repeat('d',32));$work=new DealerWorkspace($db);$api=new ClinicApi($work);
$l=$login->signIn('05551000511','Indirim-test-4242','192.0.2.170',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor((new IdentityApi($db))->actor($cookies,$now));
$data=$work->read($cookies,$now);$st=$data['state'];
$st->clients[]=(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Kaya','phone'=>'05321112233'];
$sale=fn($id,$amt,$paid)=>(object)['id'=>$id,'branch'=>'merkez','client'=>'c1','date'=>'2026-11-01','amount'=>$amt,'paid'=>$paid,'detail'=>'Muayene','method'=>'Nakit',
  'items'=>json_encode([['name'=>'Muayene','quantity'=>'1','price'=>$amt,'vat'=>'0','taxMode'=>'KDV Dahil','stock'=>'Hayır']]),'stockAllocations'=>'[]'];
$st->sales[]=$sale('s1','1000','900');   // 100 indirim
$st->sales[]=$sale('s2','500','0');      // tahsilatla kısmen ödendi (aşağıda)
$st->sales[]=$sale('s3','300','100');    // kalanı başka cihazda tahsil edilecek → tarayıcı eski kalır
$st->sales[]=$sale('s4','200','0');      // hiç ödenmemiş: aday değil (gerçek borç)
$st->collections[]=(object)['id'=>'k1','branch'=>'merkez','sale'=>'s2','date'=>'2026-11-02','amount'=>'450','method'=>'Nakit'];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$st]);
$list=SaleDiscounts::list(new WorkspaceRepository($db),$actor);
ok($list['count']===3 && array_column($list['items'],'remaining','id')==['s2'=>5000,'s1'=>10000,'s3'=>20000],'Adaylar yanlış: '.json_encode($list['items']));
// "Başka cihaz": s3'ün kalanı tahsil edildi (tarayıcının bilmediği kayıt)
$d=$work->read($cookies,$now);$st=$d['state'];$st->collections[]=(object)['id'=>'k2','branch'=>'merkez','sale'=>'s3','date'=>'2026-11-03','amount'=>'200','method'=>'Kart'];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$d['revision'],'state'=>$st]);
// Yetkisiz personel
$staff=$actor;$staff['role']='staff';$staff['branch_id']='merkez';$staff['modules']=json_encode(['sales'=>'write','collections'=>'write']);
try { SaleDiscounts::close($db,new WorkspaceRepository($db),$staff,['s1'],$now); $x=true; } catch (RuntimeException $e) { $x=$e->getCode()!==403; }
ok(!$x,'Yetkisiz personel indirimle kapattı');
// 6 eşzamanlı istek, eski seçim (s1,s2,s3): s3 atlanır, s1 ve s2 bir kez kapanır
$procs=[];$pp=[];for($k=0;$k<6;$k++)$procs[]=proc_open([PHP_BINARY,__FILE__,'child',json_encode($actor)],[1=>['pipe','w'],2=>['pipe','w']],$pp[$k],null,['VETNET_TEST_DSN'=>$dsn]);
$outs=[];foreach($procs as $k=>$p){$outs[]=stream_get_contents($pp[$k][1]);$e=stream_get_contents($pp[$k][2]);proc_close($p);ok($e==='','Alt süreç: '.$e);}
$after=$work->read($cookies,$now)['state'];
$disc=array_values(array_filter($after->collections,fn($c)=>($c->method??'')==='İndirim'));
ok(count($disc)===2 && array_column($disc,'amount','sale')==['s1'=>'100.00','s2'=>'50.00'],'Kapanış yanlış: '.json_encode($disc).' '.implode(' ',$outs));
ok(array_sum(array_map(fn($o)=>json_decode($o,true)['closed'] ?? 0,$outs))===2,'Toplam kapatılan sayısı yanlış: '.implode(' ',$outs));
ok((int)$db->query("SELECT COALESCE(SUM(amount_cents),-1) FROM finance_entry WHERE source_id LIKE 'ind-%'")->fetchColumn()===0,'İndirim kasaya para girdi');
ok(SaleDiscounts::list(new WorkspaceRepository($db),$actor)['count']===0,'Kapanmış satış hâlâ listede');
// Kapanmış satışlara normal kayıt hâlâ yapılabiliyor (doğrulama bozulmadı)
$d=$work->read($cookies,$now);$st=$d['state'];$st->clients[0]->name='Ayşe Kaya Y';$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$d['revision'],'state'=>$st]);
echo "Satış indirimi testleri geçti\n";
