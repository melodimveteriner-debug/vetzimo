<?php
declare(strict_types=1);
// Abonelik mağazası: kart (PayTR) jetonu, imzalı bildirim, deneme → paket geçişi, yenileme sırası, havale onayı.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,Commerce,SaasPayment,ClinicAccess};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Odeme Test','05551000146','odeme@example.test','Odeme-test-secret-42');
$now=strtotime('2026-12-01 10:00:00 +03:00');
$login=(new DealerLogin($db,str_repeat('o',32)))->signIn('05551000146','Odeme-test-secret-42','192.0.2.146',time());
$actor=(new IdentityApi($db))->actor([VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$login['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$login['device']],time());
$partner=$actor['partner_id'];
$sock=stream_socket_server('tcp://127.0.0.1:0');$port=(int)substr(strrchr(stream_socket_get_name($sock,false),':'),1);fclose($sock);
$srv=proc_open(['php','-S','127.0.0.1:'.$port,__DIR__.'/fixtures/paytr-mock.php'],[1=>['file','/dev/null','w'],2=>['file','/dev/null','w']],$pipes);
usleep(400000);
try {
  $key=base64_encode(str_repeat('k',32));
  $pay=new SaasPayment($db,$key,['paytrEndpoint'=>'http://127.0.0.1:'.$port.'/']);
  $commerce=new Commerce($db);
  $commerce->savePackage((object)['id'=>'protest','create'=>true,'name'=>'Pro','description'=>'Pro paket','published'=>true,'features'=>'',
    'monthly'=>100000,'yearly'=>1000000,'vat'=>'excluded','terms'=>(object)[],'modules'=>(object)array_fill_keys(array_keys(ClinicAccess::MODULES),'write')]);
  ok(SaasPayment::amount($commerce->catalog()['protest'],'yearly')===1200000,'KDV hariç fiyat yanlış');
  // Deneme dönemi
  $db->beginTransaction();$commerce->assign((object)['partnerId'=>$partner,'plan'=>'protest','kind'=>'trial','starts_on'=>'2026-11-20','ends_on'=>'2026-12-20']);$db->commit();
  // Kart kapalıyken sipariş reddedilir
  try { $pay->order($actor,(object)['requestId'=>'11111111-1111-1111-1111-111111111111','planId'=>'protest','period'=>'yearly','method'=>'card'],'192.0.2.1','https://vetzimo.test',$now); throw new LogicException('Kapalı kart kabul edildi'); } catch (RuntimeException) {}
  try { $pay->saveSettings((object)['enabled'=>true,'merchantId'=>'123456']); throw new LogicException('Anahtarsız açıldı'); } catch (RuntimeException) {}
  $pay->saveSettings((object)['enabled'=>true,'merchantId'=>'123456','key'=>'TestKey12345','salt'=>'TestSalt12345','test'=>true]);
  ok($pay->settings()['hasKey'] && !isset($pay->settings()['key']),'Gizli anahtar dışarı sızıyor');
  $stored=$db->query("SELECT payload FROM center_management WHERE kind='paytr'")->fetchColumn();
  ok(!str_contains($stored,'TestKey12345') && !str_contains($stored,'TestSalt12345'),'Anahtarlar açık metin saklanıyor');
  $r=$pay->order($actor,(object)['requestId'=>'22222222-2222-2222-2222-222222222222','planId'=>'protest','period'=>'yearly','method'=>'card'],'192.0.2.1','https://vetzimo.test',$now);
  ok($r['method']==='card' && str_starts_with($r['iframe'],'https://www.paytr.com/odeme/guvenli/tok'),'PayTR jetonu alınamadı: '.json_encode($r));
  $again=$pay->order($actor,(object)['requestId'=>'22222222-2222-2222-2222-222222222222','planId'=>'protest','period'=>'yearly','method'=>'card'],'192.0.2.1','https://vetzimo.test',$now);
  ok($again['id']===$r['id'],'Aynı istek ikinci sipariş açtı');
  $sign=fn($oid,$st,$tot)=>base64_encode(hash_hmac('sha256',$oid.'TestSalt12345'.$st.$tot,'TestKey12345',true));
  try { $pay->callback(['merchant_oid'=>$r['id'],'status'=>'success','total_amount'=>'1200000','hash'=>'sahte'],$now); throw new LogicException('Sahte imza kabul edildi'); } catch (RuntimeException $e) { ok($e->getCode()===400,'İmza hatası kodu'); }
  ok($pay->callback(['merchant_oid'=>$r['id'],'status'=>'success','total_amount'=>'1100000','hash'=>$sign($r['id'],'success','1100000')],$now)==='OK','Eksik tutar yanıtı');
  ok($pay->orders($partner)[0]['status']==='failed','Eksik tutarlı ödeme abonelik açtı');
  // Yeni sipariş: tam tutar → deneme bugün biter, yıllık paket bugün başlar
  $r=$pay->order($actor,(object)['requestId'=>'33333333-3333-3333-3333-333333333333','planId'=>'protest','period'=>'yearly','method'=>'card'],'192.0.2.1','https://vetzimo.test',$now);
  ok($pay->callback(['merchant_oid'=>$r['id'],'status'=>'success','total_amount'=>'1200000','hash'=>$sign($r['id'],'success','1200000')],$now)==='OK','Ödeme bildirimi');
  $pay->callback(['merchant_oid'=>$r['id'],'status'=>'success','total_amount'=>'1200000','hash'=>$sign($r['id'],'success','1200000')],$now); // tekrar bildirim: çift dönem açmaz
  $terms=$db->query("SELECT kind,starts_on,ends_on FROM clinic_subscription WHERE partner_id=".$db->quote($partner)." ORDER BY starts_on")->fetchAll(PDO::FETCH_ASSOC);
  ok(count($terms)===2 && $terms[0]['kind']==='trial' && $terms[0]['ends_on']==='2026-11-30' && $terms[1]['kind']==='paid' && $terms[1]['starts_on']==='2026-12-01' && $terms[1]['ends_on']==='2027-11-30','Deneme → paket geçişi yanlış: '.json_encode($terms));
  // Havale: aylık yenileme ücretli dönemin bitiminden başlar
  $pay->saveSettings((object)['enabled'=>true,'merchantId'=>'123456','test'=>true]); // anahtarlar korunur
  $db->exec("INSERT INTO center_management(id,kind,payload) VALUES ('".str_repeat('b',32)."','shop_bank','".json_encode(['enabled'=>'yes','beneficiary'=>'Zimo Soft','iban'=>'TR000000000000000000000001'])."')");
  $b=$pay->order($actor,(object)['requestId'=>'44444444-4444-4444-4444-444444444444','planId'=>'protest','period'=>'monthly','method'=>'bank'],'192.0.2.1','https://vetzimo.test',$now);
  ok($b['method']==='bank' && str_contains($b['instruction'],'TR000000000000000000000001'),'Havale talimatı yok');
  $pay->reference($actor,(object)['id'=>$b['id'],'reference'=>'DEKONT-1']);
  try { $pay->review((object)['id'=>$b['id'],'action'=>'approved'],$now); throw new LogicException('Doğrulamasız onay'); } catch (RuntimeException) {}
  $pay->review((object)['id'=>$b['id'],'action'=>'approved','verified'=>true],$now);
  $last=$db->query("SELECT starts_on,ends_on FROM clinic_subscription WHERE partner_id=".$db->quote($partner)." ORDER BY starts_on DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
  ok($last['starts_on']==='2027-12-01' && $last['ends_on']==='2027-12-31','Yenileme sırası yanlış: '.json_encode($last));
  $an=(new VetNet\Cpanel\CenterAnalytics($db))->get(true,$now);
  ok($an['totals']['partners']===1 && $an['totals']['saasRevenue']===1200000+120000 && count($an['months'])===12 && $an['partners'][0]['plan']==='Pro','Panel verisi yanlış: '.json_encode($an['totals']));
  echo "PASS abonelik mağazası: PayTR jetonu ve imzalı bildirim, deneme→paket geçişi, yenileme sırası, havale onayı, şifreli anahtar\n";
} finally { proc_terminate($srv); }
