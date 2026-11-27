<?php
declare(strict_types=1);
// Satır düzeyinde otomatik birleştirme: aynı klinikte farklı kişiler eski revizyona dayanarak farklı satırları kaydederse
// "Kayıt alanı güncellendi" (409) yerine birleştirilir; aynı satırda çakışma 409 olarak kalır; hiçbir yazım kaybolmaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,WorkspaceRepository,ClinicChanges,ClinicRecords};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) { fwrite(STDERR,"HATA: $message\n"); exit(1); } }
$dsn=(string)getenv('VETNET_TEST_DSN');
function cookies(array $login): array{return [SessionRepository::SESSION_COOKIE=>$login['token'],SessionRepository::DEVICE_COOKIE=>$login['device']];}

// Alt süreç: verilen oturumla, başlangıçta okunan (zamanla eskiyen) revizyondan yamalarla müşteri ekler.
if(($argv[1]??'')==='worker'){
    [$w,$count,$token,$device]=[(int)$argv[2],(int)$argv[3],$argv[4],$argv[5]];
    $db=Database::connect($dsn,'root',''); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
    $who=[SessionRepository::SESSION_COOKIE=>$token,SessionRepository::DEVICE_COOKIE=>$device];
    $actor=(new IdentityApi($db))->actor($who,time());
    $rev=(new WorkspaceRepository($db))->revision('partner:'.$actor['partner_id']); $conflicts=0;
    for($k=0;$k<$count;$k++){
        $patch=(object)['clients'=>(object)['prepend'=>[(object)['id'=>sprintf('m%02d%03d',$w,$k),'branch'=>'merkez','name'=>"Eş $w-$k",'phone'=>'05551112233']]]];
        for($try=0;$try<50;$try++){
            try { $u=[]; $rev=$api->save($who,$actor['membership_id'],time(),(object)['revision'=>$rev,'patch'=>$patch],$u); break; }
            catch(RuntimeException $e){ if($e->getCode()!==409) throw $e; $conflicts++; $rev=(new WorkspaceRepository($db))->revision('partner:'.$actor['partner_id']); usleep(random_int(1000,10000)); }
        }
    }
    echo $conflicts; exit(0);
}

$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('Merge Test','05551000031','merge@example.test','Merge-test-secret-42');
ClinicChanges::ensure($db);
$now=time(); $login=new DealerLogin($db,str_repeat('m',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work); $repo=new WorkspaceRepository($db);
$signed=$login->signIn('05551000031','Merge-test-secret-42','192.0.2.30',$now); $dealer=cookies($signed);
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id']; $workspace='partner:'.$actor['partner_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
for($k=1;$k<=5;$k++) $state->clients[]=(object)['id'=>"c$k",'branch'=>'merkez','name'=>"Sahip $k",'phone'=>sprintf('055510000%02d',$k)];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Mia','owner'=>'c1']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$save=function(int $rev,object $patch,?ClinicApi &$used=null) use($work,$dealer,$scope,$now){
    $used=new ClinicApi($work); $u=[];
    try { return ['revision'=>$used->save($dealer,$scope,$now,(object)['revision'=>$rev,'patch'=>json_decode(json_encode($patch))],$u),'updates'=>$u,'sync'=>$used->sync]; }
    catch(RuntimeException $e){ return ['error'=>$e->getCode()]; }
};
$row=fn(string $id,string $name)=>(object)['id'=>$id,'branch'=>'merkez','name'=>$name,'phone'=>'05551000099'];

// 1) İki cihaz aynı revizyondan farklı müşterileri günceller → ikisi de kaydedilir, ikinci cihaz ilkinin değişikliğini alır
$r0=$repo->revision($workspace);
$a=$save($r0,(object)['clients'=>['update'=>[$row('c1','Sahip 1 (A)')]]]);
$b=$save($r0,(object)['clients'=>['update'=>[$row('c2','Sahip 2 (B)')]]]);
ok(isset($a['revision'],$b['revision']),'farklı satırlar birleştirilmeli: '.json_encode([$a['error']??null,$b['error']??null]));
ok($b['revision']===$r0+2,'birleştirilen kayıt güncel revizyonun üstüne yazılmalı');
$names=array_column($repo->load($workspace)['state']->clients,'name','id');
ok($names['c1']==='Sahip 1 (A)' && $names['c2']==='Sahip 2 (B)','iki değişiklik de kalıcı olmalı');
ok(in_array('c1',array_column($b['updates']['clients']??[],'id'),true),'ikinci cihaza aradaki değişiklik gönderilmeli');

// 2) Aynı satır → 409 (sessiz üzerine yazma yok)
$r1=$repo->revision($workspace);
$a=$save($r1,(object)['clients'=>['update'=>[$row('c3','Sahip 3 (A)')]]]);
$b=$save($r1,(object)['clients'=>['update'=>[$row('c3','Sahip 3 (B)')]]]);
ok(isset($a['revision']) && ($b['error']??0)===409,'aynı satır çakışması 409 olmalı');
ok(array_column($repo->load($workspace)['state']->clients,'name','id')['c3']==='Sahip 3 (A)','çakışan yazım ilkini ezmemeli');

// 3) Liste komple değiştirildiyse (replace) birleştirme yok
$r2=$repo->revision($workspace);
$a=$save($r2,(object)['clients'=>['update'=>[$row('c4','Sahip 4 (A)')]]]);
$all=$repo->load($workspace)['state']->clients;
$b=$save($r2,(object)['clients'=>['replace'=>$all]]);
ok(($b['error']??0)===409,'değişmiş listeye replace 409 olmalı');

// 4) Ayar değişikliği + başka cihazdan yeni kayıt → kabul, ayar istemciye gider
$r3=$repo->revision($workspace);
$prefs=$repo->load($workspace)['state']->preferences; $prefs->clinic='Merge Klinik Yeni Ad';
$a=$save($r3,(object)['preferences'=>['replace'=>$prefs]]);
$b=$save($r3,(object)['clients'=>['prepend'=>[$row('c9','Yeni Sahip')]]]);
ok(isset($a['revision'],$b['revision']),'ayar + yeni kayıt birleştirilmeli: '.json_encode([$a['error']??null,$b['error']??null]));
ok(($b['sync']['replace']['preferences']->clinic??'')==='Merge Klinik Yeni Ad','yeni ayarlar istemciye gönderilmeli');
// İkinci ayar değişikliği eski revizyondan → 409
$c=$save($r3,(object)['preferences'=>['replace'=>$prefs]]);
ok(($c['error']??0)===409,'eski revizyondan ayar değişikliği 409 olmalı');

// 5) Silinen kayıt: diğer cihaza "removed" olarak gider
$r4=$repo->revision($workspace);
$deleted=$work->deleteRecord($dealer,$scope,$now,(object)['revision'=>$r4,'collection'=>'clients','id'=>'c5','confirm'=>true]);
$b=$save($r4,(object)['clients'=>['update'=>[$row('c2','Sahip 2 (B2)')]]]);
ok(isset($b['revision']) && in_array('c5',$b['sync']['removed']['clients']??[],true),'silinen kayıt diğer cihaza bildirilmeli: '.json_encode($b));
$b2=$save($r4,(object)['clients'=>['update'=>[$row('c5','Silinmişi güncelle')]]]);
ok(($b2['error']??0)===409,'silinmiş kaydı güncelleme 409 olmalı');

// 6) Günlük eksikse (eski sürümden kalan yazım) temkinli: birleştirme yok
$r5=$repo->revision($workspace);
$a=$save($r5,(object)['clients'=>['update'=>[$row('c1','Sahip 1 (C)')]]]);
$db->prepare('DELETE FROM clinic_change_log WHERE workspace_id=? AND revision=?')->execute([$workspace,$a['revision']]);
$b=$save($r5,(object)['clients'=>['update'=>[$row('c2','Sahip 2 (C)')]]]);
ok(($b['error']??0)===409,'günlüğü olmayan revizyondan taşıma yapılmamalı');

// 7) 10 süreç × 10 kayıt aynı anda, revizyonu yenilemeden: hepsi kaydedilir, kayıp yok
$procs=[];$pipes=[];$t=microtime(true);
for($w=0;$w<10;$w++){ $procs[$w]=proc_open([PHP_BINARY,__FILE__,'worker',(string)$w,'10',$signed['token'],$signed['device']],[1=>['pipe','w'],2=>['pipe','w']],$p,null,['VETNET_TEST_DSN'=>$dsn]); $pipes[$w]=$p; }
$conflicts=0;
foreach($procs as $w=>$proc){ $conflicts+=(int)stream_get_contents($pipes[$w][1]); $err=stream_get_contents($pipes[$w][2]); ok(proc_close($proc)===0,"süreç $w: $err"); }
$clients=(new ClinicRecords($db))->collections($workspace,['clients'])->clients;
$made=array_filter($clients,fn($r)=>preg_match('/\Am\d{5}\z/',$r->id));
ok(count($made)===100,'eşzamanlı kayıtta kayıp: '.count($made).'/100');
ok(count(array_unique(array_column($clients,'id')))===count($clients),'yinelenen kayıt olmamalı');
printf("merge ok · 100 eşzamanlı eski-revizyon kaydı %.1fs, %d yeniden deneme\n",microtime(true)-$t,$conflicts);
