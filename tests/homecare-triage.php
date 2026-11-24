<?php
declare(strict_types=1);
// Evden takip ön değerlendirmesi: kural vakaları, kayıt, inceleme sırası, bildirim ve iletişim bilgisi.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,HomeCare,HomeCareTriage};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }

// 1) Ortak vaka dosyası (tarayıcı motoru da aynı dosyayla denetlenir: homecare-triage.mjs)
$cases=json_decode((string)file_get_contents(__DIR__.'/homecare-triage-cases.json'),true,16,JSON_THROW_ON_ERROR);
foreach ($cases as $case) {
    $result=HomeCareTriage::evaluate($case['observation']??'routine',$case['details']??[],$case['note']);
    ok($result['level']===$case['level'],'Seviye yanlış: '.$case['note'].' → '.$result['level']);
    foreach ($case['has'] as $code) ok(in_array($code,$result['reasons'],true),'Neden eksik: '.$case['note'].' → '.$code);
}

// 2) Uçtan uca akış
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Triage Test','05551000026','triage@example.test','Triage-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('z',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
function cookies(array $login): array{return [SessionRepository::SESSION_COOKIE=>$login['token'],SessionRepository::DEVICE_COOKIE=>$login['device']];}
$dealer=cookies($login->signIn('05551000026','Triage-test-secret-42','192.0.2.30',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->branches[0]->phone='0222 111 22 33';
$state->preferences->emergencyPhone='0532 999 88 77';
$state->clients=[(object)['id'=>'own1','branch'=>'merkez','name'=>'Sahip','phone'=>'05551000027']];
$state->patients=[(object)['id'=>'cat1','branch'=>'merkez','name'=>'Pamuk','owner'=>'own1'],(object)['id'=>'dog1','branch'=>'merkez','name'=>'Karabaş','owner'=>'own1']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$token=explode('/',$identity->invite($actor,$scope,(object)['phone'=>'05551000027','name'=>'Sahip','role'=>'customer','branchId'=>'merkez','customerId'=>'own1','method'=>'in-person','verifiedInPerson'=>true,'modules'=>(object)['vaccines'=>'read','appointments'=>'read','shares'=>'none']],$now)['link'])[2];
$identity->redeem((object)['token'=>$token,'password'=>'Owner-secret-42'],$now);
$owner=$identity->actor(cookies($login->signIn('05551000027','Owner-secret-42','192.0.2.31',$now)),$now);
$care=new HomeCare($db);
foreach (['cat1','dog1'] as $pet) $care->patient($actor,$pet,(object)['action'=>'plan','active'=>true,'instructions'=>'Günde iki kez yara kontrolü']);
$uuid=static fn()=>sprintf('%08x-%04x-%04x-%04x-%012x',random_int(0,0xffffffff),random_int(0,0xffff),random_int(0,0xffff),random_int(0,0xffff),random_int(0,0xffffffffffff));
$send=function(string $pet,string $observation,string $note,array $details=[],array $extra=[]) use($care,$owner,$uuid): array {
    $id=$uuid();
    $care->patient($owner,$pet,(object)(['action'=>'observe','id'=>$id,'observation'=>$observation,'note'=>$note,'details'=>(object)$details]+$extra));
    return [$id,$care->patient($owner,$pet,null)];
};
[$routineId]=$send('dog1','routine','Mamasını yedi, oyun oynadı');
[$soonId]=$send('dog1','change','Bugün iki kez kustu');
// Tarayıcıdan "rutin" diye gelse bile seviye sunucuda hesaplanır.
[$urgentId,$view]=$send('cat1','change','Kedim çiş yapamıyor, kumda zorlanıyor',[],['triage'=>'routine']);
$saved=array_column($view['items'],null,'id');
ok($saved[$urgentId]['triage']==='urgent' && in_array('urinary',$saved[$urgentId]['triage_reasons'],true),'Acil gözlem kayda acil geçmedi');
ok($view['contact']['phone']==='0222 111 22 33' && $view['contact']['emergency']==='0532 999 88 77','Hasta sahibine klinik ve acil telefonu dönmedi');
$dogView=array_column($care->patient($owner,'dog1',null)['items'],null,'id');
ok($dogView[$soonId]['triage']==='soon' && $dogView[$routineId]['triage']==='routine','Öncelikli/rutin seviyesi yanlış');

// 3) Klinik inceleme sırası: acil önce, sayaçlar doğru
$queue=$care->queue($actor,'merkez');
ok($queue['urgentCount']===1 && $queue['soonCount']===1 && $queue['total']===3,'Sıra sayaçları yanlış');
ok($queue['items'][0]['triage']==='urgent' && $queue['items'][0]['patient_id']==='cat1','Acil gözlem sıranın başında değil');
ok($queue['items'][1]['triage']==='soon','Öncelikli gözlem ikinci sırada değil');
$clinicView=$care->patient($actor,'dog1',null);
ok($clinicView['items'][0]['id']===$soonId,'Hasta dosyasında öncelikli gözlem önce gelmeli');

// 4) Kliniğe bildirim: acil ve öncelikli gözlemler bildirilir, rutin bildirilmez
$titles=$db->query("SELECT title FROM clinic_delivery_notice WHERE kind='clinic' AND title LIKE 'Evden Takip%'")->fetchAll(PDO::FETCH_COLUMN);
ok(in_array('Evden Takip · ACİL gözlem',$titles,true) && in_array('Evden Takip · Öncelikli gözlem',$titles,true) && count($titles)===2,'Bildirimler yanlış: '.implode(', ',$titles));

// 5) İnceleme sonrası sıradan çıkar
$care->patient($actor,'cat1',(object)['action'=>'review','id'=>$urgentId,'decision'=>'called','response'=>'Hemen gelmesini söyledik.']);
$queue=$care->queue($actor,'merkez');
ok($queue['urgentCount']===0 && $queue['total']===2,'İncelenen acil gözlem sıradan çıkmadı');
echo 'PASS evden takip ön değerlendirmesi: '.count($cases)." kural vakası, kayıt seviyesi sunucuda, acil önce sıralama, bildirimler, klinik ve acil telefonu\n";
