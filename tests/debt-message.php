<?php
declare(strict_types=1);
// Toplu mesajda {bakiye}: sunucu net açık bakiyeyi hesaplar (satış - peşin - tahsilat); borcu olmayan alıcı atlanır.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,BulkClinicMessages};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Debt Test','05551000096','debt@example.test','Debt-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('g',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000096','Debt-test-secret-42','192.0.2.90',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=$identity->actor($dealer,$now);
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Borçlu Bey','phone'=>'05551000097','sms'=>'Var'],(object)['id'=>'c2','branch'=>'merkez','name'=>'Ödemiş Hanım','phone'=>'05551000098','sms'=>'Var']];
$state->sales=[(object)['id'=>'s1','branch'=>'merkez','client'=>'c1','date'=>'2026-10-01','detail'=>'Muayene','amount'=>'1500.00','paid'=>'200.00','method'=>'Nakit','items'=>json_encode([['name'=>'Muayene','quantity'=>'1','price'=>'1500','vat'=>'0','taxMode'=>'KDV Dahil']])],
  (object)['id'=>'s2','branch'=>'merkez','client'=>'c2','date'=>'2026-10-02','detail'=>'Aşı','amount'=>'400.00','paid'=>'0.00','method'=>'Nakit','items'=>json_encode([['name'=>'Aşı','quantity'=>'1','price'=>'400','vat'=>'0','taxMode'=>'KDV Dahil']])]];
$state->collections=[(object)['id'=>'k1','branch'=>'merkez','sale'=>'s1','date'=>'2026-10-05','amount'=>'65.50','method'=>'Nakit'],(object)['id'=>'k2','branch'=>'merkez','sale'=>'s2','date'=>'2026-10-06','amount'=>'400','method'=>'Nakit']];
$api->save($dealer,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$bulk=new BulkClinicMessages($db,['rateSecret'=>str_repeat('h',32),'appointmentReminderConnections'=>[]]);
$out=$bulk->bulk($actor,(object)['channel'=>'sms','branchId'=>'merkez','templateId'=>'','iysfilter'=>'0','message'=>'Sayın {sahip}, {bakiye} TL açık bakiyeniz var.',
  'targets'=>[(object)['client'=>'c1','patient'=>'','vaccine'=>''],(object)['client'=>'c2','patient'=>'','vaccine'=>'']]],true);
$by=array_column($out['results'],null,'client');
ok(($by['c1']['status']??'')==='ready' && str_contains($by['c1']['body'],'1.234,50 TL'),'Borçlu müşterinin bakiyesi yanlış: '.json_encode($by['c1']??null,JSON_UNESCAPED_UNICODE));
ok(($by['c2']['status']??'')==='skipped','Borcu olmayan müşteri atlanmadı');
echo "PASS Borç hatırlatma: {bakiye} sunucuda hesaplanır, borcu olmayan alıcı atlanır\n";
