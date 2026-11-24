<?php
declare(strict_types=1);
// İş takibi (tasks): kayıt saklanır, kim/ne zaman sunucuda işlenir, listeyi göndermeyen eski istemci görevleri silmez,
// başlıksız görev ve başka şubedeki hastaya bağlantı reddedilir.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Task Test','05551000106','task@example.test','Task-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('t',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000106','Task-test-secret-42','192.0.2.100',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$scope=$identity->actor($dealer,$now)['membership_id'];
$save=function(object $state) use($api,$work,$dealer,$scope,$now){ $data=$work->read($dealer,$now); $api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]); return $work->read($dealer,$now)['state']; };
$state=$work->read($dealer,$now)['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe','phone'=>'05551000107']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','owner'=>'c1']];
$state->tasks=[(object)['id'=>'t1','branch'=>'merkez','title'=>'Aşı dolabı kontrolü','status'=>'Yapılacak','priority'=>'Yüksek','order'=>'1','patient'=>'p1','client'=>'c1']];
$state=$save($state);
ok(count($state->tasks??[])===1 && $state->tasks[0]->title==='Aşı dolabı kontrolü' && isset($state->tasks[0]->createdBy,$state->tasks[0]->updatedAt),'Görev saklanmadı veya damgalanmadı');
$old=json_decode(json_encode($state)); unset($old->tasks); $old->clients[0]->phone='05551000108';
$state=$save($old);
ok(count($state->tasks??[])===1,'Görev listesini göndermeyen istemci görevleri sildi');
$bad=json_decode(json_encode($state)); $bad->tasks[]=(object)['id'=>'t2','branch'=>'merkez','title'=>' ','status'=>'Yapılacak'];
try { $save($bad); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Başlıksız görev kabul edildi');
$bad=json_decode(json_encode($state)); $bad->tasks[]=(object)['id'=>'t3','branch'=>'merkez','title'=>'X','status'=>'Yapılacak','patient'=>'yok'];
try { $save($bad); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Olmayan hastaya bağlı görev kabul edildi');
$next=json_decode(json_encode($state)); $next->tasks[0]->status='Tamamlandı'; $state=$save($next);
ok($state->tasks[0]->status==='Tamamlandı','Görev durumu güncellenmedi');
echo "PASS İş takibi: saklama, damga, eski istemci koruması, başlık ve bağlantı denetimi\n";
