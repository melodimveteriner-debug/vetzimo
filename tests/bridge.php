<?php
declare(strict_types=1);
// Bakanlık köprüsü: eşleştirme, yetki, kuyruk, eşleştirme hafızası, çift kayıt güvenliği ve kullanıcı kararları.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,MinistryBridge};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function fails(callable $fn,string $message): string { try { $fn(); } catch (RuntimeException $e) { return $e->getMessage(); } throw new LogicException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Bridge Test','05551000116','bridge@example.test','Bridge-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('b',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000116','Bridge-test-secret-42','192.0.2.110',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=$identity->actor($dealer,$now);
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Sahip','phone'=>'05551000117','nationalId'=>'11111111110']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','species'=>'Kedi','owner'=>'c1','chip'=>'900123456789012'],
  (object)['id'=>'p2','branch'=>'merkez','name'=>'Çipsiz','species'=>'Köpek','owner'=>'c1']];
$state->prescriptions=[(object)['id'=>'r1','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-20','kind'=>'Ayaktan tedavi','drug'=>'Amoksisilin 250','dose'=>'1 tb','stockMode'=>'Hayır','quantity'=>'2'],
  (object)['id'=>'r2','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-20','kind'=>'Ayaktan tedavi','drug'=>'Metronidazol','dose'=>'1/2 tb','stockMode'=>'Hayır'],
  (object)['id'=>'r3','branch'=>'merkez','patient'=>'p2','date'=>'2026-11-20','kind'=>'Ayaktan tedavi','drug'=>'Amoksisilin 250','dose'=>'1 tb','stockMode'=>'Hayır'],
  (object)['id'=>'r4','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-21','kind'=>'Ayaktan tedavi','drug'=>'Amoksisilin 250','dose'=>'1 tb','stockMode'=>'Hayır']];
$state->followups=[(object)['id'=>'v1','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-20','kind'=>'Aşı','title'=>'Kuduz','status'=>'Tamamlandı','done'=>'2026-11-20']];
$api->save($dealer,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$b=new MinistryBridge($db);
// Eşleştirme
$pair=$b->pair($actor,$now);
ok(preg_match('/\A[A-Z2-9]{5}-[A-Z2-9]{5}\z/',$pair['code'])===1,'Eşleştirme kodu biçimi hatalı');
fails(fn()=>$b->agentPair('AAAAA-AAAAA','PC','1',$now),'Yanlış kodla eşleşti');
$token=$b->agentPair($pair['code'],'Klinik PC','1.0.0',$now)['token'];
fails(fn()=>$b->agentPair($pair['code'],'PC','1',$now),'Kod ikinci kez kullanıldı');
$agent=$b->agentAuth('Bearer '.$token);
fails(fn()=>$b->agentAuth('Bearer '.str_repeat('0',64)),'Sahte anahtar kabul edildi');
ok($b->status($actor,$now)['agent']['online']===true,'Ajan çevrimiçi görünmüyor');
// Kuyruk doğrulamaları
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r1','r2']],$now),'Eşleştirmesiz gönderildi'),'karşılığı'),'Eşleştirme uyarısı yok');
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r3'],'map'=>(object)['r3'=>(object)['name'=>'AMOKSİSİLİN 250 MG']]],$now),'Çipsiz hasta gönderildi'),'mikroçip'),'Çip uyarısı yok');
fails(fn()=>$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r1','r4'],'map'=>(object)[]],$now),'Farklı günler tek reçete oldu');
$job=$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r2','r1'],'map'=>(object)['r1'=>(object)['name'=>'AMOKSİSİLİN 250 MG 20 TABLET'],'r2'=>(object)['name'=>'METRONİDAZOL 250 MG']]],$now);
fails(fn()=>$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r1','r2']],$now),'Aynı reçete iki kez kuyruğa girdi');
// Eşleştirme hafızası: aynı ilaç tekrar sorulmaz
$job4=$b->enqueue($actor,(object)['kind'=>'prescription','records'=>['r4']],$now);
// Ajan alır, dolduruyor iken oturum düşerse kuyruğa döner
$claim=$b->claim($agent,$now);
ok($claim['job']['id']===$job['id'] && count($claim['job']['payload']['items'])===2 && $claim['job']['payload']['patient']['chip']==='900123456789012' && $claim['job']['payload']['owner']['nationalId']==='11111111110','İş yükü eksik');
$b->progress($agent,(object)['id'=>$job['id'],'phase'=>'filling'],$now);
ok($b->result($agent,(object)['id'=>$job['id'],'outcome'=>'retry','error'=>'Oturum kapandı'],$now)['status']==='retry','Kaydetmeden önceki hata kuyruğa dönmedi');
// Kaydet'ten sonra ret göstermeyen hata → belirsiz (asla otomatik tekrar yok)
$claim=$b->claim($agent,$now);
$b->progress($agent,(object)['id'=>$claim['job']['id'],'phase'=>'submitting'],$now);
ok($b->result($agent,(object)['id'=>$claim['job']['id'],'outcome'=>'retry','error'=>'bağlantı koptu'],$now)['status']==='uncertain','Kaydet sonrası iş yeniden kuyruğa döndü');
$uncertain=$claim['job']['id'];
fails(fn()=>$b->resolve($actor,(object)['action'=>'resend','id'=>$uncertain],$now),'Kontrol onayı olmadan yeniden gönderildi');
$b->resolve($actor,(object)['action'=>'link','id'=>$uncertain,'documentNo'=>'VR-2026-555'],$now);
$jobs=array_column($b->status($actor,$now)['jobs'],null,'id');
ok($jobs[$uncertain]['status']==='done' && $jobs[$uncertain]['documentNo']==='VR-2026-555','Belge bağlanamadı');
// Ajan çökerse: kaydetme öncesi → kuyruk, kaydetme sırasında → belirsiz
$c=$b->claim($agent,$now); $b->progress($agent,(object)['id'=>$c['job']['id'],'phase'=>'submitting'],$now);
$later=$now+700; $b->status($actor,$later);
ok(array_column($b->status($actor,$later)['jobs'],null,'id')[$c['job']['id']]['status']==='uncertain','Kopan kaydetme belirsiz olmadı');
$b->resolve($actor,(object)['action'=>'resend','id'=>$c['job']['id'],'checked'=>true],$later);
$c=$b->claim($agent,$later); ok($c['job']['id']===$job4['id'],'Kontrol edilen iş yeniden kuyruğa girmedi');
$b->result($agent,(object)['id'=>$c['job']['id'],'outcome'=>'done','documentNo'=>'VR-2026-777'],$later);
// Aşı: parti numarası zorunlu
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'vaccine','records'=>['v1'],'map'=>(object)['v1'=>(object)['name'=>'KUDUZ AŞISI']]],$now),'Partisiz aşı gönderildi'),'parti'),'Parti uyarısı yok');
$v=$b->enqueue($actor,(object)['kind'=>'vaccine','records'=>['v1'],'lot'=>'L2026A','dose'=>'1'],$now);
// Tarif yalnız gov.tr adreslerine gidebilir
fails(fn()=>$b->saveRecipe($agent,(object)['kind'=>'prescription','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'https://kotu.example.com/']]]],$now),'Dış adresli tarif kabul edildi');
$b->saveRecipe($agent,(object)['kind'=>'prescription','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'https://vetbis.tarimorman.gov.tr/recete'],(object)['action'=>'submit','selectors'=>['#kaydet']]]]],$now);
ok(isset($b->recipes($agent)['recipes']['prescription']),'Tarif kaydedilmedi');
// Erişim kaldırılınca ajan reddedilir
$b->revoke($actor,$now);
fails(fn()=>$b->agentAuth('Bearer '.$token),'Kaldırılan ajan çalışmaya devam etti');
echo "PASS Bakanlık köprüsü: eşleştirme, yük, eşleştirme hafızası, çift kayıt güvenliği, belirsiz iş kararı, aşı partisi, tarif güvenliği, erişim kaldırma\n";
