<?php
declare(strict_types=1);
// Personel yetkileri gerçekten uygulanıyor mu: kapalı modül/özellik verisi gelmez, kaydedilemez; görev şablonları
// düzenlenir, kaydedilir, personele uygulanınca üyeliğin izni olur ve oturumu kapanır; doğrulamasız izin değişmez.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicAccess,ClinicApi,IdentityApi};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) { fwrite(STDERR,"HATA: $message\n"); exit(1); } }
function rejected(int $code,callable $callback,string $message): void { try{$callback();}catch(RuntimeException $e){if($e->getCode()===$code)return;fwrite(STDERR,"HATA: $message (".$e->getCode().' '.$e->getMessage().")\n");exit(1);} fwrite(STDERR,"HATA: $message (izin verildi)\n");exit(1); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Perm Test','05551000041','perm@example.test','Perm-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('p',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$cookies=fn(array $l)=>[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$dealer=$cookies($login->signIn('05551000041','Perm-test-secret-42','192.0.2.40',$now));
$actor=$identity->actor($dealer,$now); $scope=$actor['membership_id'];
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Sahip','phone'=>'05551000042']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Mia','owner'=>'c1','species'=>'Kedi']];
$state->appointments=[(object)['id'=>'a1','branch'=>'merkez','client'=>'c1','patient'=>'p1','date'=>'2026-12-01','time'=>'10:00','service'=>'Kontrol','status'=>'Planlandı']];
$state->surgeries=[(object)['id'=>'s1','branch'=>'merkez','patient'=>'p1','date'=>'2026-11-01','procedure'=>'Kısırlaştırma']];
$state->tasks=[(object)['id'=>'t1','branch'=>'merkez','title'=>'Stok sayımı','status'=>'Yapılacak']];
$state->sales=[(object)['id'=>'x1','branch'=>'merkez','client'=>'c1','date'=>'2026-11-01','amount'=>'100','paid'=>'100','detail'=>'Muayene','method'=>'Nakit',
  'items'=>json_encode([['name'=>'Muayene','quantity'=>'1','price'=>'100','vat'=>'0','taxMode'=>'KDV Dahil','stock'=>'Hayır']]),'stockAllocations'=>'[]']];
$api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]);

// 1) Hazır şablonlar: kapalı-varsayılan, eksik izin yok
$presets=$identity->rolePresets($actor);
ok(count($presets)>=4 && in_array('Kasa personeli',array_column($presets,'label'),true),'hazır şablonlar gelmeli');
$cashier=array_values(array_filter($presets,fn($p)=>$p['id']==='cashier'))[0];
ok($cashier['modules']['sales']==='write' && $cashier['modules']['patients']==='read' && $cashier['modules']['taskBoard']==='write' && $cashier['modules']['inbox']==='none','kasa şablonu izinleri');

// 2) Şablon adını ve iznini değiştir, kaydet (bayi); yeni şablon ekle
$saved=$identity->saveRolePreset($actor,$scope,(object)['id'=>'cashier','label'=>'Kasa ve Tahsilat','modules'=>(object)(['appointments'=>'read','sales'=>'write','taskBoard'=>'none'])],$now);
$row=array_values(array_filter($saved['presets'],fn($p)=>$p['id']==='cashier'))[0];
ok($row['label']==='Kasa ve Tahsilat' && $row['modules']['patients']==='none' && $row['modules']['taskBoard']==='none','şablon adı/izni kaydedilmeli; belirtilmeyen izin kapalı olmalı');
ok(count($saved['presets'])===count($presets),'ilk düzenlemede diğer hazır şablonlar korunmalı');
$new=$identity->saveRolePreset($actor,$scope,(object)['label'=>'Yalnız randevu','modules'=>(object)['appointments'=>'write']],$now);
ok(count($new['presets'])===count($presets)+1,'yeni şablon eklenmeli');
rejected(422,fn()=>$identity->saveRolePreset($actor,$scope,(object)['id'=>'cashier','label'=>'','modules'=>(object)[]],$now),'boş şablon adı reddedilmeli');

// 3) Personel: kasa şablonuyla davet (randevu okuma, satış yazma; hasta, ameliyat, iş takibi kapalı)
$link=$identity->invite($actor,$scope,(object)['phone'=>'05551000043','name'=>'Kasa','role'=>'staff','branchId'=>'merkez','customerId'=>'','method'=>'in-person','verifiedInPerson'=>true,'modules'=>(object)$row['modules']],$now)['link'];
$identity->redeem((object)['token'=>explode('/',$link)[2] ?? substr($link,strrpos($link,'/')+1),'password'=>'Kasa-secret-4242'],$now);
$staff=$cookies($login->signIn('05551000043','Kasa-secret-4242','192.0.2.41',$now));
$staffActor=$identity->actor($staff,$now);
$view=$work->visibleFor($staffActor); // API ile personele giden veri bu süzgeçten geçer
ok(count($view['state']->appointments)===1 && count($view['state']->sales)===1,'izinli listeler görünmeli');
ok($view["state"]->patients===[] && $view['state']->surgeries===[] && $view['state']->tasks===[],'kapalı listeler (hasta, ameliyat, iş takibi) gelmemeli');
$patch=fn(array $p)=>(object)['revision'=>$work->read($staff,$now)['revision'],'patch'=>json_decode(json_encode($p))];
rejected(403,fn()=>$api->save($staff,$staffActor['membership_id'],$now,$patch(['tasks'=>['prepend'=>[['id'=>'t2','branch'=>'merkez','title'=>'X','status'=>'Yapılacak']],'update'=>[],'append'=>[]]])),'iş takibi kapalıyken görev eklenmemeli');
rejected(403,fn()=>$api->save($staff,$staffActor['membership_id'],$now,$patch(['appointments'=>['prepend'=>[['id'=>'a2','branch'=>'merkez','date'=>'2026-12-02','time'=>'11:00','service'=>'Kontrol','status'=>'Planlandı']],'update'=>[],'append'=>[]]])),'okuma izniyle randevu eklenmemeli');
ok(!ClinicAccess::allowed($staffActor,'surgeries') && !ClinicAccess::allowed($staffActor,'tasks') && ClinicAccess::allowed($staffActor,'sales',true),'izin kontrolü tutarlı olmalı');

// 4) Şablonu uygula: doğrulama gerekli; sonra üyelik izni şablon olur ve oturum kapanır
$member=$staffActor['membership_id'];
$db->prepare('UPDATE identity_session SET reauth_at=? WHERE membership_id=?')->execute([$now-3600,$scope]);
$stale=$identity->actor($dealer,$now);
rejected(403,fn()=>$identity->applyRolePreset($stale,$scope,(object)['id'=>'reception','membershipIds'=>[$member]],$now),'kimlik doğrulaması olmadan izin değişmemeli');
rejected(403,fn()=>$identity->manage($stale,$scope,'permissions',(object)['membershipId'=>$member,'modules'=>(object)[]],$now),'doğrulamasız izin kaydı reddedilmeli');
$db->prepare('UPDATE identity_session SET reauth_at=? WHERE membership_id=?')->execute([$now,$scope]);
$fresh=$identity->actor($dealer,$now);
ok($identity->applyRolePreset($fresh,$scope,(object)['id'=>'reception','membershipIds'=>[$member]],$now)===1,'şablon uygulanmalı');
$modules=json_decode((string)$db->query("SELECT modules FROM identity_membership WHERE id=".$db->quote($member))->fetchColumn(),true);
ok($modules['appointments']==='write' && $modules['sales']==='read' && $modules['expenses']==='none','uygulanan şablon üyeliğe yazılmalı');
ok((int)$db->query("SELECT COUNT(*) FROM identity_session WHERE membership_id=".$db->quote($member))->fetchColumn()===0,'izin değişince oturum kapanmalı');
rejected(403,fn()=>$identity->saveRolePreset($staffActor,$member,(object)['label'=>'X','modules'=>(object)[]],$now),'personel şablon düzenleyememeli');
echo "permissions ok\n";
