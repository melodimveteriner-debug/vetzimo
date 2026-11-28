<?php
declare(strict_types=1);
// Şifremi unuttum: yalnız telefon numarası; kayıtlı/kayıtsız numaraya aynı yanıt; bağlantı 30 dk ve tek kullanımlık;
// yeni şifreyle giriş olur, eski oturumlar kapanır; aktivasyon bağlantısı akışı bozulmaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,PasswordResets,ClinicAlerts};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
function fails(callable $f,int $code): bool { try { $f(); return false; } catch (RuntimeException $e) { return $e->getCode()===$code; } }
if (($argv[1] ?? '')==='child') {
    $db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
    (new IdentityApi($db))->recover((object)['phone'=>'05557000111'],(int)$argv[2],['origin'=>'https://ornek.test']); exit(0);
}
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Şifre Test','05551000199','reset@example.test','Reset-test-secret-4242');
$now=time();$api=new IdentityApi($db);$login=new DealerLogin($db,str_repeat('r',32));
$first=$login->signIn('05551000199','Reset-test-secret-4242','192.0.2.199',$now);
ok(isset($first['token']),'İlk giriş yok');

$known=$api->recover((object)['phone'=>'0555 100 01 99'],$now,['origin'=>'https://ornek.test']);
$unknown=$api->recover((object)['phone'=>'05551112299'],$now,['origin'=>'https://ornek.test']);
ok($known===$unknown,'Kayıtlı ve kayıtsız numaraya farklı yanıt (numara açığa çıkıyor)');
ok(fails(fn()=>$api->recover((object)['phone'=>'123'],$now,[]),422),'Geçersiz numara kabul edildi');
ok((int)$db->query('SELECT COUNT(*) FROM identity_password_reset WHERE used=0')->fetchColumn()===1,'Yenileme bağlantısı oluşmadı');
$api->recover((object)['phone'=>'05551000199'],$now+30,[]);
ok((int)$db->query('SELECT COUNT(*) FROM identity_password_reset')->fetchColumn()===1,'2 dakika içinde ikinci bağlantı üretildi');

// Bilinen belirteçle yenileme (SMS'teki bağlantı yerine)
$account=$db->query("SELECT id FROM identity_account WHERE identifier='+905551000199'")->fetchColumn();
$token=bin2hex(random_bytes(32));
$db->prepare('UPDATE identity_password_reset SET used=1')->execute();
$db->prepare('INSERT INTO identity_password_reset(token_hash,account_id,created,expires) VALUES (?,?,?,?)')->execute([hash('sha256',$token),$account,$now,$now+1800]);
ok(fails(fn()=>$api->redeem((object)['token'=>$token,'password'=>'kısa'],$now),422),'Kısa şifre kabul edildi');
$api->redeem((object)['token'=>$token,'password'=>'Yeni-sifre-uzun-42'],$now);
ok((int)$db->query("SELECT COUNT(*) FROM identity_session WHERE account_id=".$db->quote($account))->fetchColumn()===0,'Eski oturumlar kapanmadı');
ok($login->signIn('05551000199','Reset-test-secret-4242','192.0.2.199',$now+5)===null,'Eski şifre hâlâ geçerli');
ok(isset($login->signIn('05551000199','Yeni-sifre-uzun-42','192.0.2.199',$now+6)['token']),'Yeni şifreyle giriş olmadı');
ok(fails(fn()=>$api->redeem((object)['token'=>$token,'password'=>'Baska-sifre-uzun-42'],$now+10),422),'Bağlantı ikinci kez kullanıldı');
$late=bin2hex(random_bytes(32));
$db->prepare('INSERT INTO identity_password_reset(token_hash,account_id,created,expires) VALUES (?,?,?,?)')->execute([hash('sha256',$late),$account,$now,$now+1800]);
ok(fails(fn()=>$api->redeem((object)['token'=>$late,'password'=>'Baska-sifre-uzun-42'],$now+1801),422),'Süresi dolan bağlantı kabul edildi');

// ── İstek durumu ve klinik tarafı: hasta sahibi "Şifremi unuttum" der; telefon hattı yok → klinikte uyarı + tek dokunuş
$p=(string)$db->query("SELECT id FROM partner_account LIMIT 1")->fetchColumn();
$db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES ('acc-own','phone','+905557000111',?,?)")->execute([password_hash('Eski-sifre-uzun-42',PASSWORD_ARGON2ID),$now]);
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status) VALUES ('m-own','acc-own',?,'customer','merkez','c-own','Ayşe Kaya','{}','active')")->execute([$p]);
$t0=$now+1000;
// 6 süreç aynı anda "Şifremi unuttum" → tek istek, tek geçerli bağlantı
$procs=[];for ($k=0;$k<6;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child',(string)$t0],[1=>['pipe','w'],2=>['pipe','w']],$pp[$k],null,['VETNET_TEST_DSN'=>getenv('VETNET_TEST_DSN')]);
foreach ($procs as $k=>$pr) { stream_get_contents($pp[$k][1]); $e=stream_get_contents($pp[$k][2]); proc_close($pr); ok($e==='','Alt süreç hatası: '.$e); }
ok((int)$db->query("SELECT COUNT(*) FROM identity_reset_request WHERE account_id='acc-own'")->fetchColumn()===1,'Eşzamanlı isteklerde birden çok kayıt açıldı');
ok((int)$db->query("SELECT COUNT(*) FROM identity_password_reset WHERE account_id='acc-own' AND used=0")->fetchColumn()===1,'Birden çok geçerli bağlantı');
$acc=(string)$db->query("SELECT id FROM identity_account WHERE identifier='+905551000199'")->fetchColumn();
$dealer=['role'=>'dealer','partner_id'=>$p,'membership_id'=>'d','account_id'=>$acc,'branch_id'=>'','name'=>'Bayi'];
$staff=['role'=>'staff','partner_id'=>$p,'membership_id'=>'s','account_id'=>$acc,'branch_id'=>'merkez','name'=>'Personel','modules'=>json_encode(['clients'=>'write'])];
$staffRead=$staff; $staffRead['modules']=json_encode(['clients'=>'read']);
$other=$staff; $other['branch_id']='sube2';
$r=new PasswordResets($db);
$items=$r->list($staff,['client'=>'c-own'],$t0+5);
ok(count($items)===1 && $items[0]['status']==='nogateway' && $items[0]['canSend'],'Hat yokken durum yanlış: '.json_encode($items));
ok(count($r->list($other,[],$t0+5))===0,'Başka şube isteği gördü');
ok(!$r->list($staffRead,[],$t0+5)[0]['canSend'],'Okuma yetkili personel gönderebilir görünüyor');
$titles=fn(array $a,int $t)=>array_column((new ClinicAlerts($db))->list($a,$t)['items'],'title');
ok(in_array('Şifre yenileme isteği bekliyor',$titles($staff,$t0+5),true),'SMS gidemeyince klinik uyarısı yok');
// Ekip hesabının (bayi) isteğini personel göremez
$api->recover((object)['phone'=>'05551000199'],$t0+500,['origin'=>'https://ornek.test']);
ok(count(array_filter($r->list($staff,[],$t0+501),fn($i)=>$i['role']!=='customer'))===0,'Personel ekip hesabının isteğini gördü');
ok(count(array_filter($r->list($dealer,[],$t0+501),fn($i)=>$i['role']==='dealer'))>=1,'Bayi ekip isteğini göremedi');
// Tek dokunuş: SMS (hat yok → açık hata), WhatsApp (bağlantı açılır, durum "paylaşıldı")
$id=$items[0]['id'];
ok(fails(fn()=>$r->send($staff,$id,'sms','https://ornek.test',$t0+30),409),'Hat yokken SMS gönderildi sayıldı');
ok(fails(fn()=>$r->send($staffRead,$id,'whatsapp','https://ornek.test',$t0+30),403),'Okuma yetkili personel gönderdi');
ok(fails(fn()=>$r->send($other,$id,'whatsapp','https://ornek.test',$t0+30),404),'Başka şube gönderdi');
$res=$r->send($staff,$id,'whatsapp','https://ornek.test',$t0+40);
ok(str_starts_with($res['link'],'https://wa.me/905557000111?text=') && str_contains(urldecode($res['link']),'#yenile/'),'WhatsApp bağlantısı yanlış');
ok(fails(fn()=>$r->send($staff,$id,'whatsapp','https://ornek.test',$t0+45),429),'Arka arkaya gönderim sınırı yok');
ok($r->list($staff,['client'=>'c-own'],$t0+50)[0]['status']==='shared','Durum paylaşıldı olmadı');
ok(!in_array('Şifre yenileme isteği bekliyor',$titles($staff,$t0+50),true),'Paylaşıldıktan sonra uyarı sürüyor');
// Hasta sahibi WhatsApp'taki bağlantıyla şifresini yeniler → "Şifre yenilendi"; eski bağlantı geçersiz
preg_match('~yenile/([a-f0-9]{64})~',urldecode($res['link']),$tm);
$api->redeem((object)['token'=>$tm[1],'password'=>'Yeni-sahip-sifre-42'],$t0+60);
$done=$r->list($staff,['client'=>'c-own'],$t0+70)[0];
ok($done['status']==='done' && $done['label']==='Şifre yenilendi','Şifre yenilendi durumu yok: '.json_encode($done));
ok(!$done['canSend'] && fails(fn()=>$r->send($staff,$id,'whatsapp','https://ornek.test',$t0+90),409),'Yenilenmiş isteğe yeniden gönderilebildi');

// ── Telefon hattı bağlı: SMS sıraya girer → 10 dk sırada kalırsa "iletilemedi" uyarısı → gönderilince "SMS gönderildi"
$db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES ('acc-2','phone','+905557000222',?,?)")->execute([password_hash('Eski-sifre-uzun-42',PASSWORD_ARGON2ID),$now]);
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status) VALUES ('m-2','acc-2',?,'customer','merkez','c-2','Can Er','{}','active')")->execute([$p]);
$gw=new VetNet\Cpanel\PhoneGateway($db);
$gw->saveSettings($dealer,(object)['sms'=>true,'simSlot'=>'','smsInterval'=>75,'smsPerDay'=>200,'whatsapp'=>'off','waRiskAccepted'=>false,'waInterval'=>120,'waPerDay'=>150,'sendStart'=>'00:00','sendHours'=>16],$now);
$gw->agentPair($gw->pair($dealer,$now)['code'],'Telefon','1.0.0','',$now);
$t1=$t0+5000;
$api->recover((object)['phone'=>'05557000222'],$t1,['origin'=>'https://ornek.test']);
$it=$r->list($staff,['client'=>'c-2'],$t1+5)[0];
ok($it['status']==='queued','Hat bağlıyken SMS sıraya girmedi: '.$it['status']);
$sms=$db->query("SELECT body FROM phone_outbox WHERE phone='+905557000222'")->fetchColumn();
ok(is_string($sms) && str_contains($sms,'https://ornek.test/app#yenile/'),'SMS bağlantısı yok');
ok(!in_array('Şifre yenileme isteği bekliyor',$titles($staff,$t1+60),true),'Sırada beklerken hemen uyarı çıktı');
ok($r->list($staff,['client'=>'c-2'],$t1+700)[0]['status']==='stuck' && in_array('Şifre yenileme isteği bekliyor',$titles($staff,$t1+700),true),'10 dk sırada kalan SMS uyarısı yok');
$db->exec("UPDATE phone_outbox SET status='sent' WHERE phone='+905557000222'");
ok($r->list($staff,['client'=>'c-2'],$t1+710)[0]['status']==='sent','Gönderilen SMS durumu yanlış');
$db->exec("UPDATE phone_outbox SET status='failed' WHERE phone='+905557000222'");
ok($r->list($staff,['client'=>'c-2'],$t1+720)[0]['status']==='failed' && in_array('Şifre yenileme isteği bekliyor',$titles($staff,$t1+720),true),'Başarısız SMS uyarısı yok');
$again=$r->send($staff,$it['id'],'sms','https://ornek.test',$t1+730);
ok($again['ok'] && $r->list($staff,['client'=>'c-2'],$t1+735)[0]['status']==='queued','Tek dokunuşla SMS yeniden sıraya girmedi');
echo "Şifre yenileme testleri geçti\n";
