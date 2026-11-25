<?php
declare(strict_types=1);
// Paket sınırları (999999 = sınırsız), üst pakete geçişte kalan günlerin aktarımı, ödeme uyarısının yalnız merkeze gitmesi,
// abonelik hatırlatma aşamaları, merkez ekip hesabı ve hasta sahibi havalesinin onayla kasaya işlenmesi.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,Commerce,SaasPayment,CenterContact,SubscriptionReminders,Center,OwnerPayment,WorkspaceRepository,SessionRepository};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Paket Test','05551000411','paket@example.test','Paket-test-secret-42');
$key=base64_encode(str_repeat('p',32));
$login=(new DealerLogin($db,str_repeat('p',32)))->signIn('05551000411','Paket-test-secret-42','192.0.2.41',time());
$actor=(new IdentityApi($db))->actor([SessionRepository::SESSION_COOKIE=>$login['token'],SessionRepository::DEVICE_COOKIE=>$login['device']],time());
$p=$actor['partner_id'];
$commerce=new Commerce($db);

// 1) Dört paket ve sınırlar
$cat=$commerce->publishedCatalog();
ok(isset($cat['ucretsiz'],$cat['pro'],$cat['plus'],$cat['ozel']) && $cat['ozel']['name']==='Kurumsal' && !isset($cat['profesyonel']),'Dört paket yayında değil: '.implode(',',array_keys($cat)));
ok(Commerce::limit(300)===300 && Commerce::limit(999999)===null && Commerce::limit('unlimited')===null,'Sınır çevirisi yanlış');
$db->beginTransaction();$commerce->assign((object)['partnerId'=>$p,'plan'=>'ucretsiz','kind'=>'assigned','starts_on'=>'2020-01-01','ends_on'=>'2020-01-02']);$db->commit();
$free=$commerce->packageActor(['partner_id'=>$p,'role'=>'dealer']);
$html=$commerce->marketPackages();
ok(substr_count($html,'pk-card')>=4 && str_contains($html,'pk-yes') && str_contains($html,'pk-no') && str_contains($html,'Sınırsız'),'Karşılaştırma tablosu eksik');

// 2) Üst pakete geçiş: Pro yıllık bugün başlar; Plus'a geçince Pro'nun kalan günleri bedel oranında eklenir
$db->exec("UPDATE clinic_package_settings SET settings=JSON_SET(settings,'$.yearly',100000,'$.vat','included') WHERE plan_id='pro'");
$db->exec("UPDATE clinic_package_settings SET settings=JSON_SET(settings,'$.yearly',200000,'$.vat','included') WHERE plan_id='plus'");
$db->exec("INSERT INTO center_management(id,kind,payload) VALUES ('shopbank00000000000000000000test','shop_bank','{\"enabled\":\"yes\",\"beneficiary\":\"VetZimo\",\"iban\":\"TR330006100519786457841326\"}')");
$pay=new SaasPayment($db,$key,[]);
$now=strtotime('2026-12-01 10:00:00 +03:00');
$o1=$pay->order($actor,(object)['requestId'=>'aaaaaaaa-1111-4111-8111-111111111111','planId'=>'pro','period'=>'yearly','method'=>'bank'],'192.0.2.1','https://vetzimo.test',$now);
// Merkez iletişim: yönetici telefonu + hat (bu bayinin hattı); havale bildirimi yalnız merkeze gider
(new CenterContact($db,$key))->save((object)['phone'=>'0555 100 0999','email'=>'','linePartner'=>$p,'sms'=>true,'whatsapp'=>true,'mail'=>false]);
$pay->reference($actor,(object)['id'=>$o1['id'],'reference'=>'EFT-1']);
$sent=$db->query("SELECT channel,phone,source FROM phone_outbox WHERE source='center'")->fetchAll();
ok(count($sent)===2 && $sent[0]['phone']===$sent[1]['phone'],'Yöneticiye SMS+WhatsApp kuyruklanmadı: '.json_encode($sent));
$gw=(new VetNet\Cpanel\PhoneGateway($db))->status($actor,$now);
ok(!array_filter($gw['outbox'],fn($r)=>$r['source']==='center'),'Merkez mesajı bayinin kuyruğunda görünüyor');
ok((int)$db->query("SELECT COUNT(*) FROM app_notification WHERE membership_id<>''")->fetchColumn()===0,'Bayiye ödeme bildirimi gitti');
$pay->review((object)['id'=>$o1['id'],'action'=>'approved','verified'=>true],$now);
$t=$db->query("SELECT plan_id,starts_on,ends_on FROM clinic_subscription WHERE partner_id='$p' AND kind='paid'")->fetch();
ok($t['plan_id']==='pro' && $t['starts_on']==='2026-12-01' && $t['ends_on']==='2027-11-30','Pro dönemi yanlış: '.json_encode($t));
$later=strtotime('2027-06-01 10:00:00 +03:00');
$o2=$pay->order($actor,(object)['requestId'=>'bbbbbbbb-1111-4111-8111-111111111111','planId'=>'plus','period'=>'yearly','method'=>'bank'],'192.0.2.1','https://vetzimo.test',$later);
$pay->review((object)['id'=>$o2['id'],'action'=>'approved','verified'=>true],$later);
$rows=$db->query("SELECT plan_id,starts_on,ends_on FROM clinic_subscription WHERE partner_id='$p' AND kind='paid' ORDER BY starts_on")->fetchAll();
ok(count($rows)===2 && $rows[0]['ends_on']==='2027-05-31' && $rows[1]['plan_id']==='plus' && $rows[1]['starts_on']==='2027-06-01','Üst pakete geçiş yanlış: '.json_encode($rows));
// Pro'nun kalan 183 günü (bedeli yarı) → Plus'ta ~91 gün eklenir
$bonus=(int)(new DateTimeImmutable('2028-05-31'))->diff(new DateTimeImmutable($rows[1]['ends_on']))->days;
ok($bonus>=90 && $bonus<=92,'Aktarılan gün sayısı beklenenden farklı: '.$rows[1]['ends_on']);

// 3) Abonelik hatırlatmaları: dönem bitimine 20 gün → "30d" aşaması; demo'ya 3 ay uyarısı gitmez, 48 saatte veri silme uyarısı
$rem=new SubscriptionReminders($db,$key,'https://vetzimo.test');
$soon=strtotime('2028-05-10 10:00:00 +03:00');
// Plus dönemi Pro ile ~1,5 yıl; 2028-05-10'da bitişe ≤30 gün varsa 30d gelmeli
$out=$rem->run(strtotime($rows[1]['ends_on'].' 10:00:00 +03:00')-20*86400,true);
ok(count($out)===1 && $out[0]['stage']==='30d' && str_contains($out[0]['text'],'gün'),'30 günlük hatırlatma yok: '.json_encode($out,JSON_UNESCAPED_UNICODE));
$msg=$rem->message(['name'=>'Demo Klinik','ends_on'=>'2026-12-10','kind'=>'trial','plan_name'=>'Plus','paid_terms'=>0],'48h',3600);
ok(str_contains($msg[1],'silinecektir'),'Demo 48 saat uyarısında veri silme yok');

// 4) Merkez ekip hesabı (destek)
$owner=$db->query("SELECT a.id FROM identity_account a JOIN identity_center c ON c.account_id=a.id WHERE c.is_owner=1")->fetchColumn();
if (!$owner) {
    $owner='center-owner-test';
    $db->prepare("INSERT INTO identity_account(id,kind,identifier,totp_seed) VALUES (?,'center','merkez@vetzimo.test','x')")->execute([$owner]);
    $db->prepare("INSERT INTO identity_center(account_id,workspace_id,is_owner) VALUES (?,'center',1)")->execute([$owner]);
}
$center=new Center($db,['encryptionKey'=>$key,'rateSecret'=>str_repeat('p',32)]);
$r=$center->teamAction(['account_id'=>$owner],(object)['op'=>'create','email'=>'destek@vetzimo.test','department'=>'support'],time());
ok(str_starts_with($r['created']['uri'],'otpauth://totp/') && strlen($r['created']['password'])>=12,'Ekip hesabı bilgileri eksik');
ok($db->query("SELECT department FROM identity_center c JOIN identity_account a ON a.id=c.account_id WHERE a.identifier='destek@vetzimo.test'")->fetchColumn()==='support','Departman kaydedilmedi');

// 5) Hasta sahibi havalesi → klinik onayı → kasaya tahsilat
$repo=new WorkspaceRepository($db);
$data=$repo->load('partner:'.$p);$state=$data['state'];
$branch=$state->branches[0]->id;
$state->clients[]=(object)['id'=>'c900','branch'=>$branch,'name'=>'Ayşe Sahibi','phone'=>'05551000900'];
$state->sales[]=(object)['id'=>'s900','branch'=>$branch,'date'=>'2026-11-01','client'=>'c900','amount'=>'250.00','paid'=>'0','items'=>'[]','detail'=>'Muayene'];
ok($repo->save('partner:'.$p,$data['revision'],$state)!==null,'Satış kaydedilemedi');
$db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES ('acc-own9','phone','+905551000900')")->execute();
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,modules,status) VALUES ('m-own9','acc-own9',?,'customer',?,'c900','{}','active')")->execute([$p,$branch]);
$cust=['partner_id'=>$p,'customer_id'=>'c900','role'=>'customer','membership_id'=>'m-own9','branch_id'=>$branch,'name'=>'Ayşe'];
$op=new OwnerPayment($db,$key,[]);
try { $op->saveSettings($actor,(object)['bank'=>true,'iban'=>'TR000000000000000000000000','beneficiary'=>'Klinik']); ok(false,'Geçersiz IBAN kabul edildi'); } catch (RuntimeException $e) { ok(str_contains($e->getMessage(),'IBAN'),'IBAN hatası beklenmiyor'); }
$op->saveSettings($actor,(object)['bank'=>true,'iban'=>'TR33 0006 1005 1978 6457 8413 26','beneficiary'=>'Paket Test Kliniği']);
$info=$op->owner($cust);
ok($info['debt']===25000 && $info['bank'] && !$info['card'],'Borç/ödeme seçenekleri yanlış: '.json_encode($info));
$b=$op->start($cust,(object)['method'=>'bank','amount'=>25000],'192.0.2.9','https://vetzimo.test',time());
ok($b['method']==='bank' && strlen($b['code'])===8,'Havale talimatı yok');
$op->notifyBank($cust,(object)['id'=>$b['id'],'reference'=>'HAVALE-9']);
$op->decide($actor,(object)['id'=>$b['id'],'action'=>'approve','verified'=>true],time());
$after=$repo->load('partner:'.$p)['state'];
$col=array_values(array_filter($after->collections,fn($c)=>($c->sale ?? '')==='s900'));
ok(count($col)===1 && $col[0]->amount==='250.00' && $col[0]->method==='Havale/EFT','Tahsilat işlenmedi: '.json_encode($col));
ok($op->owner($cust)['debt']===0,'Borç sıfırlanmadı');
echo "Paket, ödeme ve merkez testleri geçti\n";
