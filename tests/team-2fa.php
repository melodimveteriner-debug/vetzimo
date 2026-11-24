<?php
declare(strict_types=1);
// Ekip 2FA: kurulum kodla onaylanır; açıkken giriş kod ister; yanlış ve tekrar kullanılan kod reddedilir;
// kurtarma kodu bir kez çalışır; kapatmak için şifre ve kod gerekir; hasta sahibi hesabı kuramaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,TeamTotp,Totp,SessionRepository};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Tfa Test','05551000086','tfa@example.test','Tfa-test-secret-42');
$now=1_800_000_000; $login=new DealerLogin($db,str_repeat('f',32)); $identity=new IdentityApi($db);
$totp=new TeamTotp($db,base64_encode(random_bytes(32)));
$first=$login->signIn('05551000086','Tfa-test-secret-42','192.0.2.80',$now,null,$totp,'');
ok(isset($first['token']),'2FA kapalıyken giriş kod istememeli');
$actor=$identity->actor([SessionRepository::SESSION_COOKIE=>$first['token'],SessionRepository::DEVICE_COOKIE=>$first['device']],$now);
ok($totp->status($actor)['enabled']===false,'Başlangıçta kapalı olmalı');
$setup=$totp->start($actor,'VetZimo');
ok(str_starts_with($setup['uri'],'otpauth://totp/VetZimo') && preg_match('/\A[A-Z2-7]{32}\z/',$setup['secret'])===1,'Kurulum bilgisi hatalı');
try { $totp->confirm($actor,'000000',$now); $bad=true; } catch (RuntimeException) { $bad=false; }
ok(!$bad || Totp::code($setup['secret'],intdiv($now,30))==='000000','Yanlış kodla 2FA açıldı');
$codes=$totp->confirm($actor,Totp::code($setup['secret'],intdiv($now,30)),$now)['recoveryCodes'];
ok(count($codes)===8 && $totp->status($actor)['enabled'],'2FA açılmadı');
// Giriş: kodsuz, yanlış, doğru, tekrar
$later=$now+120;
ok(($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.81',$later,null,$totp,'')['otpRequired']??false)===true,'Kodsuz giriş açıldı');
$wrong=$login->signIn('05551000086','Tfa-test-secret-42','192.0.2.82',$later,null,$totp,'111111');
ok(($wrong['otpRequired']??false) && $wrong['otpInvalid'] || Totp::code($setup['secret'],intdiv($later,30))==='111111','Yanlış kod kabul edildi');
$code=Totp::code($setup['secret'],intdiv($later,30));
ok(isset($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.83',$later,null,$totp,$code)['token']),'Doğru kodla giriş açılmadı');
ok(($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.84',$later,null,$totp,$code)['otpRequired']??false)===true,'Aynı kod ikinci kez kullanıldı');
ok(isset($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.85',$later,null,$totp,strtoupper($codes[0]))['token']),'Kurtarma kodu çalışmadı');
ok(($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.86',$later,null,$totp,$codes[0])['otpRequired']??false)===true,'Kurtarma kodu ikinci kez kullanıldı');
ok($totp->status($actor)['recoveryLeft']===7,'Kalan kurtarma kodu sayısı yanlış');
// Yanlış şifre ile kapatılamaz; şifre + kurtarma koduyla kapanır
try { $totp->disable($actor,'yanlis-sifre',$codes[1],$later); $closed=true; } catch (RuntimeException) { $closed=false; }
ok(!$closed,'Yanlış şifreyle 2FA kapandı');
$totp->disable($actor,'Tfa-test-secret-42',$codes[1],$later);
ok(isset($login->signIn('05551000086','Tfa-test-secret-42','192.0.2.87',$later,null,$totp,'')['token']),'Kapatıldıktan sonra giriş kod istememeli');
// Hasta sahibi kuramaz
try { $totp->start(['role'=>'customer','account_id'=>'x','partner_id'=>'y'],'VetZimo'); $owner=true; } catch (RuntimeException) { $owner=false; }
ok(!$owner,'Hasta sahibi 2FA kurabildi');
echo "PASS Ekip 2FA: kurulum, kodlu giriş, tekrar kullanım engeli, kurtarma kodu, kapatma ve rol sınırı\n";
