<?php
declare(strict_types=1);
// Paket özellikleri ve aylık SMS/WhatsApp sınırı: paket kapatınca herkes için kapalı, personel izni ayrıca kapatabilir,
// izin verilmemiş yeni özellik varsayılan açık, hasta sahibi portalı yeni bölümler, telefon kuyruğu aylık sınırı.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,ClinicAccess,Commerce,PhoneGateway,AddonPackages,SaasPayment};
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
catch (RuntimeException $e) { ok($e->getCode()===429 && str_contains($e->getMessage(),'SMS hakkınız bitmiştir'),'Sınır hatası yanlış: '.$e->getMessage()); }
$gw->enqueue($partner,'whatsapp','05551112233','WA','manual','limit-wa',0,$now);
$gw->enqueue($partner,'sms','05551112233','Test','test','limit-test',0,$now); // deneme mesajı engellenmez ama sayılır
$u=$gw->monthlyUsage($partner,$now);
ok($u['sms']['used']===3 && $u['sms']['limit']===2 && $u['whatsapp']['used']===1 && $u['whatsapp']['limit']===null,'Aylık kullanım yanlış: '.json_encode($u));
// Gönderim geçmişi telefon hattından gidenleri gösterir (bayi yöneticisine: telefon, mesaj metni, tarih-saat)
$h=$gw->history($partner,'sms');
ok(count($h)===3 && $h[0]['phone']==='+905551112233' && $h[0]['body']==='Test' && preg_match('/\A\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\z/',$h[0]['created_at']) && in_array('test',array_column($h,'kind'),true) && count($gw->history($partner,''))===4,'Telefon gönderim geçmişi yanlış: '.json_encode($h));
$today=$gw->usedSince($partner,$now-60);
ok($today['sms']===3 && $today['whatsapp']===1,'Günlük kullanım yanlış');
// Ek paket: aylık hak bitti → kredi yokken durur; kredi tanımlanınca devam eder; başarısız mesajın kredisi iade edilir
$addon=new AddonPackages($db);
ok($addon->balance($partner,'sms')===0,'Başlangıç kredisi sıfır değil');
$addon->add($partner,'sms',2,'Test kredisi','test',$now);
$gw->enqueue($partner,'sms','05551112233','Ekten 1','manual','limit-4',0,$now);
$gw->enqueue($partner,'sms','05551112233','Ekten 1','manual','limit-4',0,$now); // tekrar: ikinci kez düşülmez
ok($addon->balance($partner,'sms')===1,'Ek kredi düşülmedi / iki kez düşüldü: '.$addon->balance($partner,'sms'));
$failed=$gw->enqueue($partner,'sms','05551112233','Ekten 2','manual','limit-5',0,$now);
ok($addon->balance($partner,'sms')===0,'İkinci ek kredi düşülmedi');
try { $gw->enqueue($partner,'sms','05551112233','Ekten 3','manual','limit-6',0,$now); throw new LogicException('Kredi bitince gönderim durmadı'); }
catch (RuntimeException $e) { ok($e->getCode()===429,'Kredi bitti hatası yanlış'); }
$db->prepare("UPDATE phone_outbox SET status='claimed',device_id='d',claimed_at=? WHERE id=?")->execute([$now,$failed]);
(fn() => $this->finish($this->db->query('SELECT * FROM phone_outbox WHERE id='.(int)$failed)->fetch(PDO::FETCH_ASSOC),'failed','hata',$now))->call($gw);
ok($addon->balance($partner,'sms')===1,'Başarısız mesajın kredisi iade edilmedi');
(fn() => $this->finish($this->db->query('SELECT * FROM phone_outbox WHERE id='.(int)$failed)->fetch(PDO::FETCH_ASSOC),'failed','hata',$now))->call($gw);
ok($addon->balance($partner,'sms')===1,'İade iki kez yapıldı');
// Havale ile ek paket siparişi → yönetici onayı → kredi tanımlanır; kullanıcı ek paketi sınıra eklenir
$db->prepare("INSERT INTO center_management(id,kind,payload) VALUES ('00000000000000000000000000000099','shop_bank',?)")->execute([json_encode(['enabled'=>'yes','beneficiary'=>'VetZimo','iban'=>'TR000000000000000000000000'])]);
$pay=new SaasPayment($db,str_repeat('k',32));
$o=$pay->addonOrder($actor+['name'=>'Bayi'],(object)['requestId'=>'11111111-2222-3333-4444-555555555555','packageId'=>'sms-1000','method'=>'bank'],'127.0.0.1','https://x',$now);
ok($o['status']==='pending' && !str_contains($o['instruction'],'[ek:'),'Ek paket siparişi oluşmadı');
$pay->review((object)['id'=>$o['id'],'action'=>'approved','verified'=>true],$now);
ok($addon->balance($partner,'sms')===1001,'Onaylanan ek paket krediye dönmedi');
try { $pay->review((object)['id'=>$o['id'],'action'=>'approved','verified'=>true],$now); throw new LogicException('Ödenen sipariş ikinci kez onaylandı'); } catch (RuntimeException) {}
ok($addon->balance($partner,'sms')===1001,'Kredi iki kez tanımlandı');
// Gizleme anahtarı ve uygunluk: gizliyken sipariş alınmaz; ücretli paketli bayi uygundur
ok($addon->eligible($partner),'Ücretli paketli bayi ek paket göremiyor');
$addon->saveCatalog((object)['hidden'=>true,'packages'=>array_map(static fn($r)=>(object)$r,AddonPackages::defaults())]);
ok($addon->hidden() && !$addon->eligible($partner),'Gizleme çalışmadı');
try { $pay->addonOrder($actor+['name'=>'Bayi'],(object)['requestId'=>'11111111-2222-3333-4444-555555555556','packageId'=>'sms-1000','method'=>'bank'],'127.0.0.1','https://x',$now); throw new LogicException('Gizliyken ek paket satıldı'); } catch (RuntimeException $e) { ok($e->getCode()===403,'Gizli ek paket hatası yanlış'); }
$addon->saveCatalog((object)['hidden'=>false,'packages'=>array_map(static fn($r)=>(object)$r,AddonPackages::defaults())]);
ok(!$addon->eligible('baska-bayi-yok'),'Aboneliği olmayan bayi ek paket görüyor');
$addon->add($partner,'users',1,'Test','test-u',$now);
ok($addon->raise($partner,['users'=>2,'branches'=>null])===['users'=>3,'branches'=>null],'Ek kullanıcı sınıra eklenmedi');
ok(count($addon->ledger($partner))>=3 && $addon->ledger($partner)[0]['created_at']!=='','Kredi hareketleri listelenmedi');
echo "PASS paket özellikleri: paket/rol/varsayılan izinleri, hasta sahibi bölümleri, aylık SMS/WhatsApp sınırı\n";
