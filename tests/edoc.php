<?php
declare(strict_types=1);
// e-Belgeler: satıştan e-Arşiv / e-Fatura / e-SMM yükü, KDV hesabı, çift belge engeli, portal filtresi, tarif adresi kuralı, numaranın işe yazılması.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,MinistryBridge};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function fails(callable $fn,string $message): string { try { $fn(); } catch (RuntimeException $e) { return $e->getMessage(); } throw new LogicException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Edoc Test','05551000126','edoc@example.test','Edoc-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('e',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000126','Edoc-test-secret-42','192.0.2.126',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=$identity->actor($dealer,$now);
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Nur Sahip','phone'=>'05551000127','nationalId'=>'','address'=>'Odunpazarı, Eskişehir'],
  (object)['id'=>'c2','branch'=>'merkez','name'=>'Pati Ltd','phone'=>'05551000128']];
$items=json_encode([['name'=>'Muayene','quantity'=>'1','price'=>'1200','vat'=>'20','taxMode'=>'KDV Dahil'],['name'=>'Mama','quantity'=>'2','price'=>'100','vat'=>'10','taxMode'=>'KDV Hariç']]);
$state->sales=[(object)['id'=>'s1','branch'=>'merkez','client'=>'c1','date'=>'2026-11-20','amount'=>'1420','items'=>$items,'detail'=>'Muayene ve mama'],
  (object)['id'=>'s2','branch'=>'merkez','client'=>'c2','date'=>'2026-11-21','amount'=>'3000','detail'=>'Cerrahi'],
  (object)['id'=>'s3','branch'=>'merkez','client'=>'c1','date'=>'2026-11-21','amount'=>'500','detail'=>'Aşı','invoice'=>'ABC2026000000001'],
  (object)['id'=>'s4','branch'=>'merkez','client'=>'c1','date'=>'2026-11-22','detail'=>'İndirimli','amount'=>'1080','discount'=>'10','discountType'=>'Yüzde','items'=>json_encode([['name'=>'Aşı','quantity'=>'1','price'=>'1200','vat'=>'20','taxMode'=>'KDV Dahil']])]];
foreach($state->sales as $s){ if(!isset($s->items)) $s->items=json_encode([['name'=>$s->detail,'quantity'=>'1','price'=>$s->amount,'vat'=>'20','taxMode'=>'KDV Dahil']]); $s->paid='0'; }
$api->save($dealer,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$b=new MinistryBridge($db);
$token=$b->agentPair($b->pair($actor,$now)['code'],'Klinik PC','1.2.0',$now)['token'];
$agent=$b->agentAuth('Bearer '.$token);
// e-Arşiv: kimlik yoksa 11111111111, KDV dahil fiyat net birim fiyata çevrilir
$j=$b->enqueue($actor,(object)['kind'=>'earsiv','sale'=>'s1'],$now);
$p=$j['payload'];
ok($p['buyer']['taxId']==='11111111111' && $p['buyer']['firstName']==='Ayşe Nur' && $p['buyer']['lastName']==='Sahip','Alıcı bilgisi hatalı');
ok($p['items'][0]['unitPrice']==='1000,00' && $p['items'][0]['vatAmount']==='200,00' && $p['items'][1]['unitPrice']==='100,00' && $p['items'][1]['lineTotal']==='200,00','Kalem hesabı hatalı');
ok($p['total']['net']==='1200,00' && $p['total']['vat']==='220,00' && $p['total']['gross']==='1420,00' && $p['invoice']['date']==='20.11.2026','Toplam hatalı: '.json_encode($p['total']));
// Yüzde indirim: KDV hariç 1000 → %10 iskonto 100, toplam 1080 (satış toplamıyla aynı)
$d=$b->enqueue($actor,(object)['kind'=>'earsiv','sale'=>'s4'],$now)['payload'];
ok($d['items'][0]['discount']==='100,00' && $d['items'][0]['lineTotal']==='900,00' && $d['total']['gross']==='1080,00','İndirim hesabı hatalı: '.json_encode($d['items'][0]).json_encode($d['total']));
ok(\VetNet\Cpanel\Finance::saleTotal($state->sales[3],[])===108000,'Satış toplamı ile belge toplamı farklı');
// Aynı satışa ikinci fatura (e-Fatura dahil) engellenir; e-SMM ayrı belge olduğu için engellenmez
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'efatura','sale'=>'s1','taxId'=>'1234567890','taxOffice'=>'Eskişehir'],$now),'Çift fatura'),'kuyrukta'),'Çift fatura uyarısı yok');
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'earsiv','sale'=>'s3'],$now),'Faturalı satış'),'zaten fatura'),'Mevcut fatura numarası uyarısı yok');
// e-Fatura: VKN ve vergi dairesi zorunlu
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'efatura','sale'=>'s2'],$now),'VKN yok'),'VKN'),'VKN uyarısı yok');
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'efatura','sale'=>'s2','taxId'=>'1234567890'],$now),'VD yok'),'vergi dairesi'),'Vergi dairesi uyarısı yok');
$ef=$b->enqueue($actor,(object)['kind'=>'efatura','sale'=>'s2','taxId'=>'1234567890','taxOffice'=>'Odunpazarı'],$now);
ok($ef['payload']['buyer']['isCompany']==='1' && $ef['payload']['items'][0]['unitPrice']==='2500,00','e-Fatura yükü hatalı');
// e-SMM: firmaya stopaj %20
$sm=$b->enqueue($actor,(object)['kind'=>'esmm','sale'=>'s2','taxId'=>'1234567890','withholding'=>true,'vatRate'=>'20'],$now);
$e=$sm['payload']['esmm'];
ok($e['gross']==='2500,00' && $e['vat']==='500,00' && $e['withholding']==='500,00' && $e['net']==='2500,00','e-SMM hesabı hatalı: '.json_encode($e));
fails(fn()=>$b->enqueue($actor,(object)['kind'=>'esmm','sale'=>'s2'],$now),'Çift e-SMM');
// Portal filtresi: yalnız e-SMM oturumu açıksa e-Arşiv alınmaz
$c=$b->claim($agent,$now,['esmm']);
ok($c['job']['id']===$sm['id'],'Portal filtresi çalışmadı');
ok($b->claim($agent,$now,['ministry'])['job']===null,'Kapalı portalın işi verildi');
$b->progress($agent,(object)['id'=>$sm['id'],'phase'=>'submitting'],$now);
$b->result($agent,(object)['id'=>$sm['id'],'outcome'=>'done','documentNo'=>'SMM2026000000045'],$now);
$c=$b->claim($agent,$now,['gib']);
ok($c['job']['id']===$j['id'] && $c['job']['kind']==='earsiv','e-Arşiv işi alınamadı');
$b->progress($agent,(object)['id'=>$j['id'],'phase'=>'submitting'],$now);
$b->result($agent,(object)['id'=>$j['id'],'outcome'=>'done','documentNo'=>'GIB2026000000123'],$now);
$jobs=array_column($b->status($actor,$now)['jobs'],null,'id');
ok($jobs[$j['id']]['documentNo']==='GIB2026000000123' && $jobs[$sm['id']]['status']==='done' && $jobs[$ef['id']]['status']==='queued','Durum listesi hatalı');
ok(str_contains(fails(fn()=>$b->enqueue($actor,(object)['kind'=>'earsiv','sale'=>'s1'],$now),'Düzenlenmiş satışa tekrar'),'zaten düzenlendi'),'Düzenlendi uyarısı yok');
// Tarif adresi: entegratör alan adı kabul, benzer görünen sahte alan adı ret
$b->saveRecipe($agent,(object)['kind'=>'efatura','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'https://portal.uyumsoft.com.tr/fatura/yeni']]]],$now);
$b->saveRecipe($agent,(object)['kind'=>'session_gib','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'https://earsivportal.efatura.gov.tr/intragiris.html']]]],$now);
fails(fn()=>$b->saveRecipe($agent,(object)['kind'=>'efatura','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'https://uyumsoft.com.tr.kotu.example/']]]],$now),'Sahte alan adı kabul edildi');
fails(fn()=>$b->saveRecipe($agent,(object)['kind'=>'esmm','recipe'=>(object)['steps'=>[(object)['action'=>'goto','url'=>'http://earsivportal.efatura.gov.tr/']]]],$now),'Şifresiz http kabul edildi');
$b->command($actor,'login:gib');
fails(fn()=>$b->command($actor,'login:kotu'),'Geçersiz portal komutu kabul edildi');
echo "PASS e-Belgeler: e-Arşiv/e-Fatura/e-SMM yükü, KDV ve stopaj hesabı, çift belge engeli, portal filtresi, tarif adres kuralı\n";
