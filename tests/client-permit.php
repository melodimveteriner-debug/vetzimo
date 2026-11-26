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
$token=substr($r['url'],strlen('https://klinik.example/o/'));
ok(str_starts_with($r['url'],'https://klinik.example/o/') && $r['short']==='klinik.example/o/'.$token && strlen($token)===10 && $r['permit']['status']==='pending','Bağlantı oluşmadı');
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
ok($a['sent']==='queued' && (int)$job['priority']===0 && str_contains($job['body'],$a['short']) && $job['phone']==='+905321112233','Onay bağlantısı SMS kuyruğuna girmedi');
$b=$permits->create($actor,(object)['client'=>'c1','method'=>'link'],$now);
$tokA=substr($a['url'],-10);
try { $permits->open($tokA,$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Yeni form oluşturulunca eski bağlantı geçerli kaldı');
$db->exec("UPDATE clinic_client_permit SET expires_at=".($now-1)." WHERE id='".$b['permit']['id']."'");
try { $permits->open(substr($b['url'],-10),$now); $accepted=true; } catch (RuntimeException $e) { $accepted=$e->getCode()!==410; }
ok(!$accepted,'Süresi dolan bağlantı açıldı');
$c=$permits->create($actor,(object)['client'=>'c1','method'=>'clinic'],$now);
$tokC=substr($c['url'],-10);
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
ok(str_contains($permits->open(substr($d['url'],-10),$now)['doc']['notice'],'Kliniğimiz Pati Veteriner Kliniği'),'Özel aydınlatma metni kullanılmadı');
ok(str_contains($permits->signedDocument($actor,$r['permit']['id'])['doc']['notice'],'Pati Veteriner Kliniği verilerinizi')===false,'İmzalı eski form yeni metinle değişti');
$foreign=$actor; $foreign['partner_id']=str_repeat('f',32);
try { $permits->signedDocument($foreign,$r['permit']['id']); $leak=true; } catch (RuntimeException) { $leak=false; }
ok(!$leak,'Başka klinik imzalı formu gördü');
// ── hoş geldin SMS'i: tek mesaj, telefon hattından, şifre ve silinemeyen kısa onay bağlantısıyla
$db->exec("UPDATE phone_device SET revoked_at=NULL");
$state2=$work->read($cookies,$now);
$st=$state2['state']; $st->clients[]=(object)['id'=>'c9','branch'=>'merkez','name'=>'Yeni Müşteri','phone'=>'0544 999 88 77','sms'=>'Var'];
$st->preferences->customerReminder_welcome_text='Sayın {musteri}, {klinik} ailesine hoş geldiniz.';
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$state2['revision'],'state'=>$st]);
$w=$identity->customerPassword($actor,'c9',(object)['welcomeSms'=>true],$now,['origin'=>'https://www.vetzimo.com','appointmentReminderConnections'=>[]]);
$msg=(string)$db->query("SELECT body FROM phone_outbox WHERE source_ref LIKE 'welcome:c9:%'")->fetchColumn();
ok($w['sms']==='queued' && $w['permit']===true,'Hoş geldin SMS i telefon hattına alınmadı: '.json_encode($w));
ok(!str_contains($msg,'Şifre') && preg_match('~KVKK onayı ve şifre oluşturma: www\.vetzimo\.com/o/([A-Za-z0-9]{10})$~u',$msg,$wm)===1,'Hoş geldin SMS içeriği yanlış: '.$msg);
ok(mb_strlen($msg)<=200,'Hoş geldin SMS i gereksiz uzun: '.mb_strlen($msg));
// ── hoş geldin akışı: önce KVKK onayı (aynı sayfa) → şifre oluşturma → giriş
ok($login->signIn('05449998877','Herhangi-1',' 192.0.2.150',$now)===null,'Şifre oluşturulmadan giriş yapılabildi');
$wo=$permits->open($wm[1],$now);
ok(!empty($wo['doc']['onboard']) && str_contains(ClientPermit::html($wo['doc'],$wo['hash'],'sign'),'Şifremi oluştur ve giriş yap') && str_contains($wo['doc']['legalUrl'],'/yasal/'),'Hoş geldin sayfası şifre adımı veya yasal bağlantı içermiyor');
$wd=$permits->decide($wm[1],(object)['decision'=>'sign','signerName'=>'Yeni Müşteri','read'=>true,'signature'=>$sign(),'hash'=>$wo['hash'],'choices'=>(object)['sms'=>true]],$now+5,[]);
ok($wd['status']==='signed' && preg_match('/\A[a-f0-9]{64}\z/',$wd['setup'] ?? '')===1,'Onaydan sonra şifre anahtarı verilmedi');
foreach ([['kisa1','kisa1'],['sadeceharf','sadeceharf'],['Uygun-sifre1','Farkli-sifre1']] as [$p1,$p2]) {
  try { $permits->setupPassword((object)['setup'=>$wd['setup'],'password'=>$p1,'password2'=>$p2],$now+6); $weak=true; } catch (RuntimeException) { $weak=false; }
  ok(!$weak,'Zayıf/uyuşmayan şifre kabul edildi: '.$p1);
}
$sp=$permits->setupPassword((object)['setup'=>$wd['setup'],'password'=>'Pamuk2026','password2'=>'Pamuk2026'],$now+7);
ok($sp['login']==='/app?telefon=05449998877','Giriş adresi yanlış: '.$sp['login']);
$in=$login->signIn('05449998877','Pamuk2026','192.0.2.151',$now+8);
ok($in!==null,'Oluşturulan şifreyle giriş yapılamadı');
try { $permits->setupPassword((object)['setup'=>$wd['setup'],'password'=>'Baska2026','password2'=>'Baska2026'],$now+9); $reuse=true; } catch (RuntimeException) { $reuse=false; }
ok(!$reuse,'Şifre anahtarı ikinci kez kullanıldı');
// ── ret: üzgün sayfa, şifre anahtarı yok, hesap açılmaz
$state3=$work->read($cookies,$now); $st3=$state3['state'];
$st3->clients[]=(object)['id'=>'c10','branch'=>'merkez','name'=>'Ret Eden','phone'=>'0544 999 88 66','sms'=>'Var'];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$state3['revision'],'state'=>$st3]);
$identity->customerPassword($actor,'c10',(object)['welcomeSms'=>true],$now+10,['origin'=>'https://www.vetzimo.com','appointmentReminderConnections'=>[]]);
preg_match('~/o/([A-Za-z0-9]{10})$~',(string)$db->query("SELECT body FROM phone_outbox WHERE source_ref LIKE 'welcome:c10:%'")->fetchColumn(),$rm);
$ro=$permits->open($rm[1],$now+11);
$rd=$permits->decide($rm[1],(object)['decision'=>'decline','signerName'=>'Ret Eden','hash'=>$ro['hash']],$now+12,[]);
ok($rd['status']==='declined' && !isset($rd['setup']),'Ret sonrası şifre anahtarı verildi');
ok(str_contains(ClientPermit::html($ro['doc'],$ro['hash'],'sign'),'bizden haber alamayacak'),'Üzgün sayfa metni yok');
// ── klinik tarafı kendi isteğiyle şifre oluşturma bağlantısı üretemez
$ca=$permits->act($actor,(object)['action'=>'create','client'=>'c10','method'=>'link','onboard'=>true],$now+13);
$ct=substr($ca['url'],strlen('https://klinik.example/o/'));
ok(empty($permits->open($ct,$now+14)['doc']['onboard']),'Klinik tarafı şifre oluşturma bağlantısı üretebildi');
echo "client permit ok\n";
