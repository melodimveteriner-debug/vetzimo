<?php
declare(strict_types=1);
// İndirme sayacı: toplam / günlük benzersiz / QR / bot ayrımı, ajanlar yalnız ücretli bayi; otomatik demo: kod telefona
// kuyruklanır, yanlış kod sayılır, doğru kod + imzalı sözleşme ile bayi + 14 günlük demo açılır, ikinci kez açılmaz.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,Commerce,AppDownloads,DemoAuto,PhoneGateway,Center,SessionRepository};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('İndirme Test','05551000301','indir@example.test','Indir-test-secret-42');
$now=time(); $secret=str_repeat('d',32);
$l=(new DealerLogin($db,$secret))->signIn('05551000301','Indir-test-secret-42','192.0.2.31',$now);
$actor=(new IdentityApi($db))->actor([SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']],$now);
$p=$actor['partner_id'];

// Sayaç
$root=sys_get_temp_dir().'/vz-dl-'.bin2hex(random_bytes(4));
mkdir($root.'/public/download/agents',0777,true);
file_put_contents($root.'/public/download/manifest.json',json_encode(['files'=>[
    'android'=>['file'=>'a.apk','version'=>'1.0.0','size'=>3,'sha256'=>str_repeat('a',64)],
    'agent'=>['file'=>'agent.zip','version'=>'1.3.0','size'=>3,'sha256'=>str_repeat('b',64)]]]));
$d=new AppDownloads($db,$root,$secret);
$ua='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
ok($d->count('android','qr','198.51.100.1',$ua,$now),'Sayım yapılmadı');
$d->count('android','qr','198.51.100.1',$ua,$now);
$d->count('android','web','198.51.100.2','Mozilla/5.0 (Windows NT 10.0)',$now);
ok(!$d->count('android','web','198.51.100.3','WhatsApp/2.23',$now),'Bağlantı önizlemesi sayıldı');
ok(!$d->count('yok','web','198.51.100.3',$ua,$now),'Bilinmeyen uygulama sayıldı');
$s=$d->stats(30,$now);
$a=array_values(array_filter($s['apps'],fn($x)=>$x['key']==='android'))[0];
ok($a['total']===3 && $a['unique']===2 && $a['qr']===2 && $a['web']===1,'Sayaç yanlış: '.json_encode($a));
ok($s['clients']['ios']===2 && $s['clients']['windows']===1,'Cihaz dağılımı yanlış');
ok(!isset($d->publicCatalog()['agent']) && isset($d->publicCatalog()['android']),'Ajan herkese açık katalogda görünüyor');
// Ajan: deneme/abonelik yok → kapalı; ücretli dönem → açık
ok($d->agents($actor)['paid']===false && $d->agents($actor)['items']===[],'Ücretsiz hesapta ajan bağlantısı verildi');
$plan=(string)array_key_first((new Commerce($db))->catalog());
$day=date('Y-m-d',$now);
$db->prepare("INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,'trial',?,?)")->execute([$p,$plan,'Deneme',date('Y-m-d',$now-86400),date('Y-m-d',$now+86400*5)]);
ok($d->agents($actor)['paid']===false,'Deneme (demo) hesabına ajan açıldı');
$db->prepare("UPDATE clinic_subscription SET kind='paid' WHERE partner_id=?")->execute([$p]);
$ag=$d->agents($actor);
ok($ag['paid'] && $ag['manager'] && count($ag['items'])===1 && $ag['items'][0]['url']==='/download/agent?src=panel','Ücretli bayide ajan bağlantısı yok: '.json_encode($ag));
ok(!$d->agentAccess(null),'Oturumsuz ajan erişimi açık');

// Otomatik demo
$db->prepare("INSERT INTO center_management(id,kind,payload) VALUES ('00000000000000000000000000000007','demo_auto',?)")->execute([json_encode(['enabled'=>true,'days'=>14,'plan'=>'','linePartner'=>$p])]);
$lead='11111111-2222-4333-8444-555555555555';
(new Commerce($db))->submit((object)['requestId'=>$lead,'read'=>'on','notice'=>'basvuru-v1','kind'=>'trial','billing'=>'monthly','plan'=>'',
    'name'=>'Deneme Kişi','clinic'=>'Otomatik Klinik','email'=>'oto@example.test','phone'=>'0555 100 0399'],$secret);
$auto=new DemoAuto($db,$secret);
$r=$auto->start($lead,new PhoneGateway($db),$now);
ok($r['verify']===true && str_ends_with($r['phone'],'99'),'Kod gönderimi başlamadı: '.json_encode($r));
$body=(string)$db->query("SELECT body FROM phone_outbox WHERE source_ref LIKE 'demo:$lead%'")->fetchColumn();
ok((bool)preg_match('/(\d{6})/',$body,$m),'Kod SMS kuyruğunda yok');
$code=$m[1];
try { $auto->verify((object)['reference'=>$lead,'code'=>$code==='000000'?'111111':'000000'],new Center($db,[]),new Commerce($db),'1.1.1.1','ua',$now); ok(false,'Yanlış kod kabul edildi'); }
catch (RuntimeException $e) { ok(str_contains($e->getMessage(),'hatalı'),'Yanlış kod hatası beklenmiyor: '.$e->getMessage()); }
ok((int)$db->query("SELECT attempts FROM demo_verification WHERE lead_id='$lead'")->fetchColumn()===1,'Hatalı deneme sayılmadı');
$png="\x89PNG\r\n\x1a\n".str_repeat("\0",300);
$res=$auto->verify((object)['reference'=>$lead,'code'=>$code,'agreement'=>(object)['accepted'=>true,'name'=>'Deneme Kişi','title'=>'','signature'=>'data:image/png;base64,'.base64_encode($png)]],
    new Center($db,[]),new Commerce($db),'1.1.1.1','ua',$now);
ok(str_starts_with($res['activation'],'/app#aktivasyon/') && $res['days']===14,'Demo açılmadı: '.json_encode($res));
$sub=$db->query("SELECT s.kind,s.starts_on,s.ends_on FROM clinic_subscription s JOIN demo_verification v ON v.partner_id=s.partner_id WHERE v.lead_id='$lead'")->fetch();
ok($sub && $sub['kind']==='trial' && intdiv(strtotime($sub['ends_on'])-strtotime($sub['starts_on']),86400)===13,'Demo dönemi 14 gün değil: '.json_encode($sub));
ok((int)$db->query("SELECT COUNT(*) FROM dealer_agreement a JOIN demo_verification v ON v.partner_id=a.partner_id WHERE v.lead_id='$lead'")->fetchColumn()===1,'Sözleşme imzası kaydedilmedi');
ok($db->query("SELECT stage FROM clinic_lead WHERE id='$lead'")->fetchColumn()==='won','Başvuru kazanıldı olmadı');
try { $auto->verify((object)['reference'=>$lead,'code'=>$code],new Center($db,[]),new Commerce($db),'1.1.1.1','ua',$now); ok(false,'Demo ikinci kez açıldı'); }
catch (RuntimeException $e) { ok(str_contains($e->getMessage(),'zaten'),'İkinci açılış hatası beklenmiyor: '.$e->getMessage()); }
// Aynı telefonla yeni başvuru otomatik açılmaz
$lead2='11111111-2222-4333-8444-666666666666';
(new Commerce($db))->submit((object)['requestId'=>$lead2,'read'=>'on','notice'=>'basvuru-v1','kind'=>'demo','billing'=>'monthly','plan'=>'',
    'name'=>'Deneme Kişi','clinic'=>'Otomatik Klinik 2','email'=>'oto2@example.test','phone'=>'0555 100 0399'],$secret);
ok($auto->start($lead2,new PhoneGateway($db),$now)['verify']===false,'Aynı telefonla ikinci otomatik demo başladı');
echo "İndirme sayacı ve otomatik demo testleri geçti\n";
