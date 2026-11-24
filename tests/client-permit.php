<?php
declare(strict_types=1);
// Müşteri onay formu: tek kullanımlık bağlantı, mühürlü metin, ayrı ayrı ve boş gelen izinler, imza zorunluluğu,
// imzadan sonra bağlantının geçersizleşmesi, süre aşımı, telefondan bağlantı gönderimi ve gönderimde imzalı onayın esas alınması.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,ClientPermit,PhoneGateway,Commerce};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Permit Test','05551000146','permit@example.test','Permit-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('q',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000146','Permit-test-secret-42','192.0.2.140',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor($identity->actor($cookies,$now)); $actor['name']='Dr. Ayşe';
$data=$work->read($cookies,$now); $state=$data['state'];
$state->preferences=(object)array_merge((array)($state->preferences??[]),['clinic'=>'Pati Veteriner Kliniği','phone'=>'0222 111 22 33','address'=>'Odunpazarı / Eskişehir','email'=>'info@pati.example']);
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Yılmaz','phone'=>'0532 111 22 33','sms'=>'Yok','whatsapp'=>'Var','emailPermission'=>'Yok']];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$permits=new ClientPermit($db,'https://klinik.example');
$sign=static function(): string { $im=imagecreatetruecolor(900,300); imagefill($im,0,0,imagecolorallocate($im,255,255,255)); $k=imagecolorallocate($im,10,10,10);
  for($i=0;$i<40;$i++) imageline($im,50+$i*18,150+(int)(60*sin($i/2)),68+$i*18,150+(int)(60*sin(($i+1)/2)),$k); ob_start(); imagepng($im); return 'data:image/png;base64,'.base64_encode((string)ob_get_clean()); };

$r=$permits->create($actor,(object)['client'=>'c1','method'=>'link'],$now);
$token=substr($r['url'],strlen('https://klinik.example/onay/'));
ok(strlen($token)===32 && $r['permit']['status']==='pending','Bağlantı oluşmadı');
ok(!str_contains((string)$db->query("SELECT token_hash FROM clinic_client_permit")->fetchColumn(),$token),'Bağlantı anahtarı düz saklandı');
$open=$permits->open($token,$now);
ok(str_contains($open['doc']['notice'],'Pati Veteriner Kliniği') && str_contains($open['doc']['notice'],'Odunpazarı') && !preg_match('/\{(klinik|adres|telefon|eposta)\}/',$open['doc']['notice']),'Aydınlatma metni klinik bilgisiyle doldurulmadı');
ok(count($open['doc']['platform'])===4 && count($open['doc']['choices'])===4,'Platform metinleri veya izin seçenekleri eksik');
$html=ClientPermit::html($open['doc'],$open['hash'],'sign');
ok(!preg_match('/<input type="checkbox" name="(sms|whatsapp|email|marketing)" checked/',$html) && str_contains($html,'Onay vermiyorum'),'İzinler önceden işaretli geliyor');
$bad=[(object)['decision'=>'sign','signerName'=>'Ayşe Yılmaz','read'=>false,'signature'=>$sign(),'hash'=>$open['hash']],
  (object)['decision'=>'sign','signerName'=>'Ayşe Yılmaz','read'=>true,'signature'=>'data:image/png;base64,AAAA','hash'=>$open['hash']],
  (object)['decision'=>'sign','signerName'=>'A','read'=>true,'signature'=>$sign(),'hash'=>$open['hash']],
  (object)['decision'=>'sign','signerName'=>'Ayşe Yılmaz','read'=>true,'signature'=>$sign(),'hash'=>str_repeat('0',64)]];
foreach ($bad as $i=>$b) { try { $permits->decide($token,$b,$now,[]); $accepted=true; } catch (RuntimeException) { $accepted=false; } ok(!$accepted,'Geçersiz imza kabul edildi #'.$i); }
$out=$permits->decide($token,(object)['decision'=>'sign','signerName'=>'Ayşe Yılmaz','read'=>true,'signature'=>$sign(),'hash'=>$open['hash'],
  'choices'=>(object)['sms'=>true,'whatsapp'=>false,'email'=>true,'marketing'=>false]],$now+60,['REMOTE_ADDR'=>'198.51.100.7','HTTP_USER_AGENT'=>'Tablet']);
ok($out['status']==='signed','İmza kaydedilmedi');
try { $permits->decide($token,(object)['decision'=>'decline','signerName'=>'Başkası'],$now,[]); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Kullanılmış bağlantı ikinci kez kullanıldı');
$doc=$permits->signedDocument($actor,$r['permit']['id']);
ok($doc['ip']==='198.51.100.7' && $doc['agent']==='Tablet' && str_starts_with((string)$doc['signature'],'data:image/png') && $doc['choices']['sms']===true,'İmza kaydı eksik');
$rec=ClientPermit::html($doc['doc'],$doc['hash'],'record',$doc);
ok(str_contains($rec,'İmzalandı') && str_contains($rec,'198.51.100.7') && str_contains($rec,'☑ <b>Onay verildi</b> — SMS'),'Kayıt görünümü eksik');

// ── gönderimde imzalı onay esas alınır
$clients=[(object)['id'=>'c1','sms'=>'Yok','whatsapp'=>'Var','emailPermission'=>'Yok']];
$permits->overlay($actor['partner_id'],$clients);
ok($clients[0]->sms==='Var' && $clients[0]->whatsapp==='Yok' && $clients[0]->emailPermission==='Var' && $clients[0]->marketingConsent==='Yok','İmzalı izinler esas alınmadı');
$fc=$permits->forClient($actor,'c1',$now+61);
ok($fc['effective']['status']==='signed' && $fc['effective']['applied']===false,'Müşteri kartı durumu yanlış');
$permits->act($actor,(object)['action'=>'applied','id'=>$r['permit']['id']],$now+62);
ok($permits->forClient($actor,'c1',$now+63)['effective']['applied']===true,'Karta işlendi bilgisi kaydedilmedi');

// ── telefonla gönderim, tek geçerli bağlantı, süre aşımı
$gw=new PhoneGateway($db);
$gw->saveSettings($actor,(object)['sms'=>true,'whatsapp'=>'assist','smsInterval'=>75,'smsPerDay'=>100,'waInterval'=>120,'waPerDay'=>100,'sendStart'=>'10:00','sendHours'=>9],$now);
$gw->agentPair($gw->pair($actor,$now)['code'],'Tel','1','',$now);
$a=$permits->create($actor,(object)['client'=>'c1','method'=>'sms'],$now);
$job=$db->query("SELECT * FROM phone_outbox WHERE source='manual'")->fetch(PDO::FETCH_ASSOC);
ok($a['sent']==='queued' && (int)$job['priority']===0 && str_contains($job['body'],$a['url']) && $job['phone']==='+905321112233','Onay bağlantısı SMS kuyruğuna girmedi');
$b=$permits->create($actor,(object)['client'=>'c1','method'=>'link'],$now);
$tokA=substr($a['url'],-32);
try { $permits->open($tokA,$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Yeni form oluşturulunca eski bağlantı geçerli kaldı');
$db->exec("UPDATE clinic_client_permit SET expires_at=".($now-1)." WHERE id='".$b['permit']['id']."'");
try { $permits->open(substr($b['url'],-32),$now); $accepted=true; } catch (RuntimeException $e) { $accepted=$e->getCode()!==410; }
ok(!$accepted,'Süresi dolan bağlantı açıldı');
$c=$permits->create($actor,(object)['client'=>'c1','method'=>'clinic'],$now);
$tokC=substr($c['url'],-32);
$permits->decide($tokC,(object)['decision'=>'decline','signerName'=>'Ayşe Yılmaz','hash'=>$permits->open($tokC,$now)['hash']],$now+100,[]);
$clients=[(object)['id'=>'c1','sms'=>'Var','whatsapp'=>'Var']];
$permits->overlay($actor['partner_id'],$clients);
ok($clients[0]->sms==='Yok' && $clients[0]->whatsapp==='Yok','Onay vermeyen müşteriye mesaj izni kaldı');

// ── metin ve yetki
$staff=$actor; $staff['role']='staff'; $staff['modules']=json_encode(['clients'=>'write']);
try { $permits->saveNotice($staff,str_repeat('Metin ',60),$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Personel aydınlatma metnini değiştirdi');
$permits->saveNotice($actor,"## Özel metin\n".str_repeat('Kliniğimiz {klinik} verilerinizi korur. ',10),$now);
$d=$permits->create($actor,(object)['client'=>'c1','method'=>'link'],$now);
ok(str_contains($permits->open(substr($d['url'],-32),$now)['doc']['notice'],'Kliniğimiz Pati Veteriner Kliniği'),'Özel aydınlatma metni kullanılmadı');
ok(str_contains($permits->signedDocument($actor,$r['permit']['id'])['doc']['notice'],'Pati Veteriner Kliniği verilerinizi')===false,'İmzalı eski form yeni metinle değişti');
$foreign=$actor; $foreign['partner_id']=str_repeat('f',32);
try { $permits->signedDocument($foreign,$r['permit']['id']); $leak=true; } catch (RuntimeException) { $leak=false; }
ok(!$leak,'Başka klinik imzalı formu gördü');
echo "client permit ok\n";
