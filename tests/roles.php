<?php
declare(strict_types=1);
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,WorkspaceRepository,DealerWorkspace,ClinicAccess,ClinicApi,IdentityApi};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function rejected(int $code,callable $callback): void { try{$callback();}catch(RuntimeException $e){if($e->getCode()===$code)return;throw $e;} throw new RuntimeException('Expected '.$code); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Role Test','05551000006','role@example.test','Role-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('x',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
function cookies(array $login): array{return [SessionRepository::SESSION_COOKIE=>$login['token'],SessionRepository::DEVICE_COOKIE=>$login['device']];}
$dealer=cookies($login->signIn('05551000006','Role-test-secret-42','192.0.2.10',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->branches[]=(object)['id'=>'emek','name'=>'Emek','status'=>'Aktif','sharedWith'=>''];
$state->clients=[(object)['id'=>'owner1','branch'=>'merkez','name'=>'Owner A','phone'=>'05551000007'],(object)['id'=>'owner2','branch'=>'merkez','name'=>'Owner B','phone'=>'05551000008'],(object)['id'=>'owner3','branch'=>'emek','name'=>'Owner C','phone'=>'05551000009']];
$state->patients=[(object)['id'=>'pet1','branch'=>'merkez','name'=>'Mia','owner'=>'owner1','privateNotes'=>'NOT FOR PORTAL'],(object)['id'=>'pet2','branch'=>'merkez','name'=>'Luna','owner'=>'owner2'],(object)['id'=>'pet3','branch'=>'emek','name'=>'Emek Pet','owner'=>'owner3']];
$state->followups=[(object)['id'=>'v1','branch'=>'merkez','patient'=>'pet1','title'=>'Aşı','date'=>'2026-01-01','done'=>'2026-01-01','kind'=>'Aşı','status'=>'Tamamlandı']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$invite=function(string $phone,string $role,string $customer,object $modules)use($identity,$actor,$scope,$now):string{
 $result=$identity->invite($actor,$scope,(object)['phone'=>$phone,'name'=>'Role User','role'=>$role,'branchId'=>'merkez','customerId'=>$customer,'method'=>'in-person','verifiedInPerson'=>true,'modules'=>$modules],$now);
 return explode('/',$result['link'])[2];
};
$token=$invite('05551000007','customer','owner1',(object)['vaccines'=>'read','appointments'=>'read','shares'=>'none']);
rejected(422,fn()=>$identity->redeem((object)['token'=>$token,'password'=>'Owner-secret-42'],$now+901));
$identity->redeem((object)['token'=>$token,'password'=>'Owner-secret-42'],$now);
rejected(422,fn()=>$identity->redeem((object)['token'=>$token,'password'=>'Other-secret-42'],$now));
$ownerLogin=$login->signIn('05551000007','Owner-secret-42','192.0.2.11',$now);
ok($ownerLogin['destination']==='/hasta-sahibi','Wrong customer destination');
$owner=cookies($ownerLogin); $ownerActor=$identity->actor($owner,$now);
$portal=$identity->portal($ownerActor);
ok(count($portal['pets'])===1 && $portal['pets'][0]['id']==='pet1','Customer isolation failed');
ok(!isset($portal['pets'][0]['privateNotes']),'Private clinical note leaked');
ok($portal['vaccines'][0]['status']==='done','Vaccine status wrong');
rejected(403,fn()=>$work->read($owner,$now));
rejected(403,fn()=>$identity->select($owner,$ownerActor,$scope,$now));
$staffToken=$invite('05551000010','staff','',(object)['patients'=>'read','appointments'=>'write']);
$identity->redeem((object)['token'=>$staffToken,'password'=>'Staff-secret-42'],$now);
$staff=cookies($login->signIn('05551000010','Staff-secret-42','192.0.2.12',$now));
$staffActor=$identity->actor($staff,$now); $visible=$work->visible($staff,$now);
ok(count($visible['state']->patients)===2,'Staff branch leak');
ok(count($visible['state']->clients)===0,'Denied module leaked');
ok(count($visible['state']->branches)===1,'Other branch leaked');
$copy=json_decode(json_encode($visible['state'])); $copy->patients[0]->name='HACK';
rejected(403,fn()=>$api->save($staff,$staffActor['membership_id'],$now,(object)['revision'=>$visible['revision'],'state'=>$copy]));
$copy=json_decode(json_encode($visible['state']));
$copy->appointments[]=(object)['id'=>'new-appt','branch'=>'merkez','patient'=>'pet1','service'=>'Kontrol','date'=>'2026-11-12'];
$api->save($staff,$staffActor['membership_id'],$now,(object)['revision'=>$visible['revision'],'state'=>$copy]);
$all=$work->read($dealer,$now);
ok(count($all['state']->patients)===3 && count($all['state']->clients)===3,'Staff save deleted hidden records');
$copy=$work->visible($staff,$now); $copy['state']->appointments[0]->branch='emek';
rejected(403,fn()=>$api->save($staff,$staffActor['membership_id'],$now,(object)['revision'=>$copy['revision'],'state'=>$copy['state']]));
rejected(403,fn()=>$identity->directory($staffActor));
$identity->manage($actor,$scope,'permissions',(object)['membershipId'=>$staffActor['membership_id'],'modules'=>(object)['patients'=>'none']],$now);
ok((new SessionRepository($db))->resolve($staff,$now)===null,'Permission change did not revoke session');
$identity->manage($actor,$scope,'revoke',(object)['membershipId'=>$ownerActor['membership_id']],$now);
ok((new SessionRepository($db))->resolve($owner,$now)===null,'Membership revocation did not revoke session');
echo "PASS role activation/replay/expiry, customer privacy, staff branch and module isolation, unauthorized mutations, preservation of hidden records, permission and membership revocation\n";
