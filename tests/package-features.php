<?php
declare(strict_types=1);
// Paket özellikleri ve aylık SMS/WhatsApp sınırı: paket kapatınca herkes için kapalı, personel izni ayrıca kapatabilir,
// izin verilmemiş yeni özellik varsayılan açık, hasta sahibi portalı yeni bölümler, telefon kuyruğu aylık sınırı.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,ClinicAccess,Commerce,PhoneGateway};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Paket Test','05551000136','paket@example.test','Paket-test-secret-42');
$now=time();
$login=(new DealerLogin($db,str_repeat('p',32)))->signIn('05551000136','Paket-test-secret-42','192.0.2.136',$now);
$actor=(new IdentityApi($db))->actor([VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$login['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$login['device']],$now);
$partner=$actor['partner_id'];
$commerce=new Commerce($db);

// Paket yokken her şey açık (geriye dönük uyum)
ok(ClinicAccess::feature($commerce->packageActor($actor),'inbox',true),'Paketsiz bayi gelen kutusunu kullanamıyor');

// Paket: gelen kutusu kapalı, SMS aylık 2
$caps=(object)array_fill_keys(array_keys(ClinicAccess::FEATURES),true); $caps->inbox=false;
$commerce->savePackage((object)['id'=>'deneme-paket','create'=>true,'name'=>'Deneme','description'=>'Test paketi','published'=>false,'features'=>"A\nB",
    'monthly'=>100000,'yearly'=>null,'terms'=>(object)['sms'=>2],'capabilities'=>$caps,'modules'=>(object)array_fill_keys(array_keys(ClinicAccess::MODULES),'write')]);
$plan=$commerce->catalog()['deneme-paket'];
ok($plan['capabilities']['inbox']===false && $plan['capabilities']['edocs']===true && $plan['features']===['A','B'],'Paket özellikleri yanlış kaydedildi');
$db->beginTransaction();
$commerce->assign((object)['partnerId'=>$partner,'plan'=>'deneme-paket','kind'=>'assigned','starts_on'=>'2020-01-01','ends_on'=>'2099-01-01']);
$db->commit();
$dealer=$commerce->packageActor($actor);
ok(!ClinicAccess::feature($dealer,'inbox') && ClinicAccess::feature($dealer,'edocs',true),'Paket kapatması bayi yöneticisine uygulanmadı');
ok(ClinicAccess::modules($dealer)->inbox==='none' && ClinicAccess::modules($dealer)->edocs==='write','Oturum izinleri istemciye yanlış gidiyor');
ok($dealer['packageLimits']['sms']===2 && $dealer['packageLimits']['whatsapp']===null,'Aylık sınırlar okunamadı');

// Personel: izin verilmeyen yeni özellik açık; açıkça kapatılan kapalı; paketin kapattığını personel açamaz
$staff=['role'=>'staff','partner_id'=>$partner,'modules'=>json_encode(['patients'=>'write','edocs'=>'none','inbox'=>'write']),'packageFeatures'=>$dealer['packageFeatures']];
ok(ClinicAccess::feature($staff,'voice',true),'Varsayılan açık özellik personelde kapalı');
ok(!ClinicAccess::feature($staff,'edocs'),'Personelde kapatılan özellik açık kaldı');
ok(!ClinicAccess::feature($staff,'inbox'),'Paketin kapattığı özelliği personel kullanabiliyor');
$grants=json_decode(IdentityApi::grants('staff',(object)['edocs'=>'read']),true);
ok($grants['edocs']==='read' && $grants['voice']==='write' && $grants['patients']==='none','Yeni personel izin varsayılanları yanlış');
$customer=json_decode(IdentityApi::grants('customer',(object)['vaccines'=>'read']),true);
ok($customer['homeCare']==='read' && $customer['documents']==='read' && $customer['exam']==='none','Hasta sahibi yeni bölüm varsayılanları yanlış');
try { IdentityApi::grants('customer',(object)['vaccines'=>'write']); throw new LogicException('Hasta sahibine yazma izni verildi'); } catch (RuntimeException) {}

// Aylık SMS sınırı: 2 mesajdan sonra 3. reddedilir; aynı kaynak kaydı tekrar sayılmaz; WhatsApp sınırsız
$gw=new PhoneGateway($db);
$gw->enqueue($partner,'sms','05551112233','Mesaj 1','manual','limit-1',0,$now);
$gw->enqueue($partner,'sms','05551112233','Mesaj 2','manual','limit-2',0,$now);
$gw->enqueue($partner,'sms','05551112233','Mesaj 2','manual','limit-2',0,$now); // aynı kayıt: sayılmaz, hata vermez
try { $gw->enqueue($partner,'sms','05551112233','Mesaj 3','manual','limit-3',0,$now); throw new LogicException('Aylık SMS sınırı aşıldı'); }
catch (RuntimeException $e) { ok($e->getCode()===429 && str_contains($e->getMessage(),'aylık SMS'),'Sınır hatası yanlış: '.$e->getMessage()); }
$gw->enqueue($partner,'whatsapp','05551112233','WA','manual','limit-wa',0,$now);
$gw->enqueue($partner,'sms','05551112233','Test','test','limit-test',0,$now); // test mesajı sınırdan muaf
$u=$gw->monthlyUsage($partner,$now);
ok($u['sms']['used']===2 && $u['sms']['limit']===2 && $u['whatsapp']['limit']===null,'Aylık kullanım yanlış: '.json_encode($u));
echo "PASS paket özellikleri: paket/rol/varsayılan izinleri, hasta sahibi bölümleri, aylık SMS/WhatsApp sınırı\n";
