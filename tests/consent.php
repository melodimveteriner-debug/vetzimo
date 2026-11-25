<?php
declare(strict_types=1);
// Dijital onam: klinik hazırlar, metin mühürlenir; hasta sahibi yalnız kendi formunu görür ve imzalar;
// imzalı form tekrar imzalanamaz/iptal edilemez; başka sahip erişemez; klinikte imza ve reddetme çalışır.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,ClinicConsent};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function fails(callable $fn,string $message,?int $code=null): void { try { $fn(); } catch (RuntimeException $e) { if($code!==null && $e->getCode()!==$code) throw new LogicException($message.' (kod '.$e->getCode().': '.$e->getMessage().')'); return; } throw new LogicException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Consent Test','05551000076','consent@example.test','Consent-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('e',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$cookies=static fn(array $l)=>[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$dealer=$cookies($login->signIn('05551000076','Consent-test-secret-42','192.0.2.70',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Sahip','phone'=>'05551000077'],(object)['id'=>'c2','branch'=>'merkez','name'=>'Başka','phone'=>'05551000078']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Minnoş','species'=>'Kedi','owner'=>'c1'],(object)['id'=>'p2','branch'=>'merkez','name'=>'Karabaş','species'=>'Köpek','owner'=>'c2']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$owner=function(string $phone,string $customer,string $secret) use($identity,$actor,$scope,$now,$login,$cookies){
  $token=explode('/',$identity->invite($actor,$scope,(object)['phone'=>$phone,'name'=>'Sahip','role'=>'customer','branchId'=>'merkez','customerId'=>$customer,'method'=>'in-person','verifiedInPerson'=>true,'modules'=>(object)['vaccines'=>'read','appointments'=>'read','shares'=>'read']],$now)['link'])[2];
  $identity->redeem((object)['token'=>$token,'password'=>$secret],$now);
  return $identity->actor($cookies($login->signIn($phone,$secret,'192.0.2.71',$now)),$now);
};
$o1=$owner('05551000077','c1','Owner-secret-42'); $o2=$owner('05551000078','c2','Owner-secret-43');
$c=new ClinicConsent($db);
$png='data:image/png;base64,'.base64_encode((function(){ $i=imagecreatetruecolor(400,150); imagefill($i,0,0,0xffffff); imageline($i,10,100,380,40,0); ob_start(); imagepng($i); return ob_get_clean(); })());
$f=$c->create($actor,(object)['patient'=>'p1','recordType'=>'surgery','recordId'=>'s1','title'=>'Ameliyat ve anestezi onamı','body'=>"Minnoş için kısırlaştırma.\nRiskler anlatıldı."],$now);
ok($f['status']==='pending' && $f['customer']==='c1' && $f['intact']===true && strlen($f['hash'])===64,'Onam oluşturulamadı');
fails(fn()=>$c->create($actor,(object)['patient'=>'yok','title'=>'X','body'=>'Y'],$now),'Olmayan hasta için onam açıldı',404);
ok(count($c->list($actor,['patient'=>'p1'])['items'])===1 && !isset($c->list($actor,[])['items'][0]['signature']),'Klinik listesi hatalı');
// Sahip: yalnız kendi formu
ok(count($c->ownerList($o1))===1 && count($c->ownerList($o2))===0,'Sahip listesi başka sahibin formunu gösterdi');
fails(fn()=>$c->get($o2,$f['id']),'Başka sahip formu açtı',404);
fails(fn()=>$c->ownerDecide($o2,$f['id'],(object)['decision'=>'sign','signerName'=>'Kötü Niyet','agree'=>true,'signature'=>$png,'hash'=>$f['hash']],$now,[]),'Başka sahip imzaladı',404);
// Eksik imza / okumadım / sürüm uyuşmazlığı reddedilir
fails(fn()=>$c->ownerDecide($o1,$f['id'],(object)['decision'=>'sign','signerName'=>'Ayşe Sahip','agree'=>true,'signature'=>'','hash'=>$f['hash']],$now,[]),'İmzasız onay kabul edildi',422);
fails(fn()=>$c->ownerDecide($o1,$f['id'],(object)['decision'=>'sign','signerName'=>'Ayşe Sahip','agree'=>false,'signature'=>$png,'hash'=>$f['hash']],$now,[]),'Okudum onayı olmadan kabul edildi',422);
fails(fn()=>$c->ownerDecide($o1,$f['id'],(object)['decision'=>'sign','signerName'=>'Ayşe Sahip','agree'=>true,'signature'=>$png,'hash'=>str_repeat('0',64)],$now,[]),'Farklı sürüm imzalandı',409);
$s=$c->ownerDecide($o1,$f['id'],(object)['decision'=>'sign','signerName'=>'Ayşe Sahip','agree'=>true,'signature'=>$png,'hash'=>$f['hash']],$now,['REMOTE_ADDR'=>'192.0.2.71','HTTP_USER_AGENT'=>'Test']);
ok($s['status']==='signed' && $s['channel']==='portal' && $s['signerIp']==='192.0.2.71' && $s['signature']===$png,'İmza saklanmadı');
fails(fn()=>$c->ownerDecide($o1,$f['id'],(object)['decision'=>'decline','signerName'=>'Ayşe Sahip'],$now,[]),'İmzalı form yeniden yanıtlandı',409);
fails(fn()=>$c->cancel($actor,$f['id'],$now),'İmzalı form iptal edildi',409);
// Metin veritabanında değiştirilirse bütünlük bozuk görünür
$db->prepare('UPDATE clinic_consent SET body=CONCAT(body,"!") WHERE id=?')->execute([$f['id']]);
ok($c->get($actor,$f['id'])['intact']===false,'Değiştirilmiş metin fark edilmedi');
// Klinikte imza ve reddetme, iptal
$g=$c->create($actor,(object)['patient'=>'p2','recordType'=>'stay','title'=>'Yatış onamı','body'=>'Yatış koşulları.'],$now);
$g=$c->signInClinic($actor,$g['id'],(object)['decision'=>'sign','signerName'=>'Başka Sahip','agree'=>true,'signature'=>$png,'hash'=>$g['hash']],$now,[]);
ok($g['status']==='signed' && $g['channel']==='clinic','Klinikte imza çalışmadı');
$h=$c->create($actor,(object)['patient'=>'p1','title'=>'Genel tedavi onamı','body'=>'Tedavi.'],$now);
$h=$c->ownerDecide($o1,$h['id'],(object)['decision'=>'decline','signerName'=>'Ayşe Sahip','reason'=>'Ücreti düşünmek istiyorum'],$now,[]);
ok($h['status']==='declined' && $h['note']==='Ücreti düşünmek istiyorum','Reddetme saklanmadı');
$k=$c->create($actor,(object)['patient'=>'p1','title'=>'İptal edilecek','body'=>'X'],$now);
ok($c->cancel($actor,$k['id'],$now)['status']==='cancelled' && count($c->ownerList($o1))===2,'İptal edilen form sahibe görünüyor');
fails(fn()=>$c->get($o1,$k['id']),'İptal formu sahip açtı',404);
// SMS bağlantısı (hat yok → bağlantı elle paylaşılır), hesapsız imza, tek kullanım; yüz yüze imza
$c=new ClinicConsent($db,'https://klinik.example');
$m=$c->create($actor,(object)['patient'=>'p2','recordType'=>'surgery','title'=>'Ameliyat onamı','body'=>'Riskler.','method'=>'sms'],$now);
ok($m['delivery']['status']==='manual' && preg_match('~\Ahttps://klinik\.example/k/([A-Za-z0-9]{10})\z~',$m['delivery']['url'],$mm) && str_contains($m['delivery']['share'],'klinik.example/k/'),'SMS bağlantısı üretilmedi');
$open=$c->openLink($mm[1],$now);
ok($open['title']==='Ameliyat onamı' && $open['hash']===$m['hash'] && str_contains(ClinicConsent::linkPage($open),'pmForm'),'Bağlantı sayfası açılmadı');
fails(fn()=>$c->decideLink($mm[1],(object)['decision'=>'sign','signerName'=>'Başka Sahip','read'=>false,'signature'=>$png,'hash'=>$m['hash']],$now,[]),'Okumadan imza kabul edildi',422);
ok($c->decideLink($mm[1],(object)['decision'=>'sign','signerName'=>'Başka Sahip','read'=>true,'signature'=>$png,'hash'=>$m['hash']],$now,['REMOTE_ADDR'=>'192.0.2.9'])['status']==='signed','Bağlantıyla imza olmadı');
ok($c->get($actor,$m['id'])['channel']==='sms','İmza kanalı yanlış');
fails(fn()=>$c->openLink($mm[1],$now),'Kullanılmış bağlantı yeniden açıldı',404);
fails(fn()=>$c->create($actor,(object)['patient'=>'p2','title'=>'E','body'=>'E','method'=>'email'],$now)['delivery'],'E-postasız sahibe e-posta gönderildi',422);
$e=$c->create($actor,(object)['patient'=>'p2','title'=>'E-posta onamı','body'=>'Metin.'],$now);
$sent=$c->sendLink($actor,$e['id'],'email',(object)['email'=>'sahip@example.test'],$now);
ok(in_array($sent['status'],['email_sent','email_failed'],true),'E-posta yolu çalışmadı');
$c->openLink(substr($sent['url'],-10),$now+5);
fails(fn()=>$c->openLink(substr($sent['url'],-10),$now+ClinicConsent::LINK_TTL+1),'Süresi dolmuş bağlantı açıldı',410);
$y=$c->create($actor,(object)['patient'=>'p2','title'=>'Yüz yüze','body'=>'Metin.','method'=>'in-person'],$now);
fails(fn()=>$c->signInClinic($actor,$y['id'],(object)['decision'=>'sign','inPerson'=>true,'signerName'=>'Başka Sahip','agree'=>true,'signature'=>$png,'hash'=>$y['hash']],$now,[]),'Kimlik doğrulaması olmadan yüz yüze imza',422);
$y=$c->signInClinic($actor,$y['id'],(object)['decision'=>'sign','inPerson'=>true,'verifiedInPerson'=>true,'signerName'=>'Başka Sahip','agree'=>true,'signature'=>$png,'hash'=>$y['hash']],$now,[]);
ok($y['channel']==='in-person' && str_starts_with($y['note'],'Kimlik yüz yüze doğrulandı'),'Yüz yüze imza kaydı yanlış');
echo "PASS Dijital onam: mühürlü metin, sahip yalıtımı, imza doğrulama, sürüm denetimi, değişmezlik, klinikte imza, red ve iptal\n";
