<?php
declare(strict_types=1);
// Merkez ayar kayıtları birbirini ezmez: önceki sürümde ek paket kataloğu "otomatik demo" kaydına (07) yazılmıştı;
// onarım kataloğu kendi kaydına taşır, demo ayarını varsayılana döndürür. Eski paket işareti merkez iletişim kaydını (08) bozmaz.
use VetNet\Cpanel\{Database,Installer,AddonPackages,Commerce,CenterContact};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Ids Test','05551000199','ids@example.test','Ids-test-secret-42');
$db->prepare("REPLACE INTO center_management(id,kind,payload) VALUES ('00000000000000000000000000000007','demo_auto',?)")
  ->execute([json_encode(['packages'=>[['id'=>'sms-x','kind'=>'sms','name'=>'SMS X','quantity'=>10,'price'=>1000,'vat'=>'included','active'=>true,'description'=>'']]])]);
$db->exec("REPLACE INTO center_management(id,kind,payload) VALUES ('00000000000000000000000000000008','legacy_plans','{\"done\":true}')");
$cat=(new AddonPackages($db))->catalog();
ok(count($cat)===1 && $cat[0]['id']==='sms-x','Çakışan katalog taşınmadı');
ok($db->query("SELECT payload FROM center_management WHERE id='00000000000000000000000000000007'")->fetchColumn()==='{}','Demo ayarı onarılmadı');
(new Commerce($db))->catalog();
ok(!$db->query("SELECT 1 FROM center_management WHERE id='00000000000000000000000000000008'")->fetchColumn(),'Eski işaret 08 kaydında kaldı');
$cc=new CenterContact($db,str_repeat('k',32));
$cc->save((object)['phone'=>'0555 100 0999','email'=>'','linePartner'=>'','sms'=>true,'whatsapp'=>false,'mail'=>false]);
ok($cc->settings()['phone']!=='','Merkez iletişim ayarı okunamadı');
(new AddonPackages($db))->saveCatalog((object)['packages'=>[]]);
ok($cc->settings()['phone']!=='' && $db->query("SELECT payload FROM center_management WHERE id='00000000000000000000000000000007'")->fetchColumn()==='{}','Katalog kaydı başka ayarı ezdi');
echo "Ayar kayıtları çakışmıyor\n";
