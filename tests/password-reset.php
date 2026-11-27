<?php
declare(strict_types=1);
// Şifremi unuttum: yalnız telefon numarası; kayıtlı/kayıtsız numaraya aynı yanıt; bağlantı 30 dk ve tek kullanımlık;
// yeni şifreyle giriş olur, eski oturumlar kapanır; aktivasyon bağlantısı akışı bozulmaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
function fails(callable $f,int $code): bool { try { $f(); return false; } catch (RuntimeException $e) { return $e->getCode()===$code; } }
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
echo "Şifre yenileme testleri geçti\n";
