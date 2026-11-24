<?php
declare(strict_types=1);
// Evde Hizmet başvurusu: hasta sahibi kendi hayvanı için başvurabilir, başkasının hayvanı için başvuramaz;
// ziyaretçi başvurusu çalışır. Başvuru doğrulaması tüm kliniği yüklemeden yapılır (HomeVisit::accessState).
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,HomeVisit};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function rejected(string $text,callable $callback): void { try{$callback();}catch(RuntimeException $e){ if(str_contains($e->getMessage(),$text)) return; throw $e; } throw new RuntimeException('Reddedilmesi gerekirdi: '.$text); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
$root=dirname(__DIR__);
(new Installer($db,$root))->install('Visit Test','05551000036','visit@example.test','Visit-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('v',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$cookies=static fn(array $l): array=>[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$dealer=$cookies($login->signIn('05551000036','Visit-test-secret-42','192.0.2.40',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id']; $partner=$actor['partner_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'own1','branch'=>'merkez','name'=>'Sahip Bir','phone'=>'05551000037'],(object)['id'=>'own2','branch'=>'merkez','name'=>'Sahip İki','phone'=>'05551000038']];
$state->patients=[(object)['id'=>'pet1','branch'=>'merkez','name'=>'Pamuk','species'=>'Kedi','owner'=>'own1'],(object)['id'=>'pet2','branch'=>'merkez','name'=>'Duman','species'=>'Köpek','owner'=>'own2']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$token=explode('/',$identity->invite($actor,$scope,(object)['phone'=>'05551000037','name'=>'Sahip Bir','role'=>'customer','branchId'=>'merkez','customerId'=>'own1','method'=>'in-person','verifiedInPerson'=>true,'modules'=>(object)['vaccines'=>'read','appointments'=>'read','shares'=>'none']],$now)['link'])[2];
$identity->redeem((object)['token'=>$token,'password'=>'Owner-secret-42'],$now);
$owner=$identity->actor($cookies($login->signIn('05551000037','Owner-secret-42','192.0.2.41',$now)),$now);
$db->prepare('UPDATE identity_account SET phone_verified_at=? WHERE id=?')->execute([$now,$owner['account_id']]);
$db->prepare('INSERT INTO clinic_visit_settings(partner_id,settings) VALUES (?,?)')->execute([$partner,json_encode(['enabled'=>true,'public'=>true,'privacy'=>'Aydınlatma metni','regions'=>[]],JSON_UNESCAPED_UNICODE)]);
$db->exec("INSERT INTO clinic_visit_package(plan_id,enabled) VALUES ('_default',1) ON DUPLICATE KEY UPDATE enabled=1");
$visits=new HomeVisit($db,['rateSecret'=>str_repeat('r',32),'encryptionKey'=>base64_encode(str_repeat('k',32)),'origin'=>'https://example.test']);
$location=new ReflectionMethod(HomeVisit::class,'location');
$province=$location->invoke(null,'provinces')[0][0];
$district=$location->invoke(null,'districts',$province)[0][0];
$neighborhood=$location->invoke(null,'neighborhoods',$district)[0][0];
$service=array_key_first($visits->settings($partner)['services']);
$day=(new DateTimeImmutable('+3 days'))->format('Y-m-d');
$post=static fn(array $extra)=>$extra+['consent'=>'yes','address_confirm'=>'yes','province'=>(string)$province,'district'=>(string)$district,'neighborhood'=>(string)$neighborhood,
    'street'=>'Çınar Sokak','building'=>'5','floor'=>'2','unit'=>'4','landmark'=>'Parkın yanı','address'=>'Çınar Sokak No 5','title'=>'Ev',
    'date'=>$day,'from'=>'10:00','to'=>'11:00','services'=>[$service],'notes'=>'Aşı için evde ziyaret','email'=>'sahip@example.test'];
$mine=$visits->request($partner,$owner,$post(['patient'=>'pet1']));
$row=$db->query("SELECT customer_id,patient_id,status FROM clinic_visit_request WHERE id='$mine'")->fetch();
ok($row['customer_id']==='own1' && $row['patient_id']==='pet1' && $row['status']==='new','Hasta sahibinin kendi hayvanı için başvurusu kaydedilmedi');
rejected('Hasta bu hesaba veya şubeye bağlı değil.',fn()=>$visits->request($partner,$owner,$post(['patient'=>'pet2','date'=>(new DateTimeImmutable('+4 days'))->format('Y-m-d')])));
rejected('Hasta bu hesaba veya şubeye bağlı değil.',fn()=>$visits->request($partner,$owner,$post(['patient'=>'yok','date'=>(new DateTimeImmutable('+5 days'))->format('Y-m-d')])));
$guest=$visits->request($partner,null,$post(['name'=>'Ziyaretçi','phone'=>'05551000039','animal'=>'Tekir','species'=>'Kedi','date'=>(new DateTimeImmutable('+6 days'))->format('Y-m-d')]));
ok((bool)$db->query("SELECT 1 FROM clinic_visit_request WHERE id='$guest' AND customer_id=''")->fetchColumn(),'Ziyaretçi başvurusu kaydedilmedi');
$state=$visits->accessState($partner,$owner,['pet1']);
ok(count($state->clients)===1 && count($state->patients)===1 && $state->branches,'Hafif durum yalnız gereken satırları içermeli');
echo "PASS Evde Hizmet başvurusu: hasta sahibinin kendi hayvanı, başka sahibin hayvanı reddi, ziyaretçi başvurusu, hafif doğrulama durumu\n";
