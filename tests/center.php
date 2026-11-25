<?php
declare(strict_types=1);
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,WorkspaceRepository,ClinicAccess,IdentityApi,Center,Totp};
require __DIR__.'/bootstrap.php';
function good(bool $test,string $message): void {if(!$test)throw new RuntimeException($message);}
function denied(callable $callback):void {try{$callback();}catch(RuntimeException $e){if(in_array($e->getCode(),[401,403],true))return;throw $e;}throw new RuntimeException('Access unexpectedly granted');}
$secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
foreach([59=>'94287082',1111111109=>'07081804',1111111111=>'14050471',1234567890=>'89005924',2000000000=>'69279037',20000000000=>'65353130'] as $time=>$code) good(Totp::code($secret,intdiv($time,30),8)===$code,'TOTP vector mismatch');
$key=base64_encode(random_bytes(32));$box=Totp::encrypt($secret,$key);good(Totp::decrypt($box,$key)===$secret,'TOTP encryption roundtrip');
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');$now=time();
(new Installer($db,dirname(__DIR__)))->install('Center Test','05551000020','first@example.test','First-password-42',['email'=>'admin@example.test','password'=>'Center-password-42','secret'=>$secret,'otp'=>Totp::code($secret,intdiv($now,30)),'key'=>$key]);
$config=['rateSecret'=>str_repeat('r',32),'encryptionKey'=>$key];$center=new Center($db,$config);
// Setup consumed the current code: reusing it must not sign in.
good($center->login((object)['email'=>'admin@example.test','password'=>'Center-password-42','otp'=>Totp::code($secret,intdiv($now,30))],'192.0.2.20',$now)===null,'Setup code replay accepted');
$now=(intdiv($now,30)+1)*30;
$input=(object)['email'=>'admin@example.test','password'=>'Center-password-42','otp'=>Totp::code($secret,intdiv($now,30))];
$auth=$center->login($input,'192.0.2.20',$now);good($auth!==null,'Center login failed');
good($center->login($input,'192.0.2.20',$now)===null,'Login code replay accepted');
$cookies=[SessionRepository::SESSION_COOKIE=>$auth['token'],SessionRepository::DEVICE_COOKIE=>$auth['device']];$actor=$center->requireOwner($cookies,$now,true);
$created=$center->create($actor,(object)['name'=>'Second Clinic','phone'=>'05551000021','email'=>'second@example.test'],$now);
$identity=new IdentityApi($db);$identity->redeem((object)['token'=>explode('/',$created['link'])[2],'password'=>'Second-password-42','agreement'=>(object)['accepted'=>true,'name'=>'Test Yetkili','signature'=>'data:image/png;base64,'.base64_encode("\x89PNG\r\n\x1a\n".str_repeat("\0",300))]],$now);
$dealer=(new DealerLogin($db,$config['rateSecret']))->signIn('05551000021','Second-password-42','192.0.2.21',$now);
$dealerCookies=[SessionRepository::SESSION_COOKIE=>$dealer['token'],SessionRepository::DEVICE_COOKIE=>$dealer['device']];
denied(fn()=>$center->requireOwner($dealerCookies,$now));
good(count($center->partners($actor))===2,'Dealer creation missing');
good(count($center->details($created['id'])['members'])===1,'Dealer membership missing');
$commerce = new VetNet\Cpanel\Commerce($db);
$term = (object)['partnerId'=>$created['id'],'plan'=>'profesyonel','kind'=>'trial','starts_on'=>'2020-01-01','ends_on'=>'2099-01-01'];
$db->beginTransaction();
$commerce->assign($term);
$db->commit();
good($commerce->subscription($created['id'])['current']['plan_name']==='Profesyonel','Assigned term missing');
$db->beginTransaction();
try {
    $commerce->assign($term);
    throw new RuntimeException('Overlapping term accepted');
} catch (RuntimeException $error) {
    good($error->getCode()===409,'Unexpected term error');
} finally { $db->rollBack(); }
echo "PASS assigned subscription lookup and overlapping term rejection\n";
$center->toggle($actor,(object)['partnerId'=>$created['id'],'active'=>false],$now);
good((new SessionRepository($db))->resolve($dealerCookies,$now)===null,'Disabled dealer kept session');
good((new DealerLogin($db,$config['rateSecret']))->signIn('05551000021','Second-password-42','192.0.2.21',$now)===null,'Disabled dealer logged in');
good(is_array($center->requireOwner($cookies,$now+301,true)),'Center write blocked after 5 minutes');
denied(fn()=>$center->requireOwner($cookies,$now+\VetNet\Cpanel\Center::REAUTH_WINDOW+1,true));
good((int)$db->query('SELECT COUNT(*) FROM center_audit')->fetchColumn()===3,'Center audit incomplete');
echo "PASS TOTP vectors/encryption/replay prevention, administrator setup/login, dealer creation/activation/listing, dealer denial from center, deactivation/session revocation, recent-auth requirement and audit\n";
