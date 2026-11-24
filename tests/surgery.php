<?php
declare(strict_types=1);
// Ameliyat kayıtları: kaydedilir ve geri okunur, hasta zorunludur, ameliyat listesini bilmeyen eski istemci kayıtları silemez,
// çıktı şablonları tüm kliniği yüklemeden yalnız ilgili hasta/sahip satırlarını okur.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,ClinicRecords,PrintTemplates,ClinicAccess};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Surgery Test','05551000056','surgery@example.test','Surgery-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('c',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000056','Surgery-test-secret-42','192.0.2.60',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id']; $partner=$actor['partner_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Sahip','phone'=>'05551000057'],(object)['id'=>'c2','branch'=>'merkez','name'=>'Başka Sahip','phone'=>'05551000058']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Minnoş','species'=>'Kedi','owner'=>'c1'],(object)['id'=>'p2','branch'=>'merkez','name'=>'Karabaş','species'=>'Köpek','owner'=>'c2']];
$state->surgeries=[(object)['id'=>'s1','branch'=>'merkez','patient'=>'p1','date'=>'2026-12-01','time'=>'10:30','procedure'=>'Kısırlaştırma','surgeon'=>'Dr. Test','status'=>'Planlandı','asa'=>'ASA I','consent'=>'Alındı']];
$saved=$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$data=$work->read($dealer,$now);
ok(count($data['state']->surgeries??[])===1 && $data['state']->surgeries[0]->procedure==='Kısırlaştırma','Ameliyat kaydı saklanmadı');
// Hasta zorunlu
$bad=clone $data['state']; $bad->surgeries=[$data['state']->surgeries[0],(object)['id'=>'s2','branch'=>'merkez','patient'=>'','date'=>'2026-12-02','procedure'=>'Diş','status'=>'Planlandı']];
try { $api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$bad]); throw new LogicException('hastasız ameliyat kabul edildi'); } catch (RuntimeException $e) { ok(str_contains($e->getMessage(),'Hasta'),'Beklenmeyen hata: '.$e->getMessage()); }
// Eski istemci: listeyi göndermez, kayıt korunur
$old=clone $data['state']; unset($old->surgeries); $old->clients[0]->phone='05551000059';
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$old]);
$data=$work->read($dealer,$now);
ok(count($data['state']->surgeries??[])===1,'Ameliyat listesini göndermeyen istemci kayıtları sildi');
// Çıktı için hafif okuma
$slice=(new ClinicRecords($db))->printSlice('partner:'.$partner,['surgery'=>'s1']);
ok($slice!==null && array_column($slice->surgeries,'id')===['s1'] && array_column($slice->patients,'id')===['p1'] && array_column($slice->clients,'id')===['c1'],'Çıktı okuması yalnız ilgili kayıtları getirmeli');
$listing=(new PrintTemplates($db))->listing($actor,ClinicAccess::visible($slice,$actor));
ok(in_array('surgery',$listing['allowed'],true) && count($listing['records']['surgery'])===1 && count(array_filter($listing['templates'],static fn($t)=>$t['category']==='surgery'))===3,'Ameliyat çıktı şablonları eksik');
echo "PASS Ameliyat kayıtları: saklama, zorunlu hasta, eski istemci koruması, hafif çıktı okuması ve üç ameliyat belgesi\n";
