<?php
declare(strict_types=1);
// Yoğun bakım: vital ve CRI kayıtları yatışa eklenir, personel/saat sunucuda mühürlenir, geçmiş değiştirilemez,
// infüzyon yalnız bir kez durdurulur, eski istemci alanları göndermese de kayıtlar korunur, talimat uygulanır.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
function fails(callable $fn,string $message): void { try { $fn(); } catch (RuntimeException $e) { return; } throw new LogicException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Icu Test','05551000066','icu@example.test','Icu-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('d',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000066','Icu-test-secret-42','192.0.2.61',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$scope=$identity->actor($dealer,$now)['membership_id'];
$save=function(object $state) use($api,$work,$dealer,$scope,$now){ $data=$work->read($dealer,$now); $api->save($dealer,$scope,$now,(object)['revision'=>$data['revision'],'state'=>$state]); return $work->read($dealer,$now)['state']; };
$start=gmdate('Y-m-d\TH:i',$now-7200); $at=gmdate('Y-m-d\TH:i',$now-3600); $due=gmdate('Y-m-d\TH:i',$now-1800);
$state=$work->read($dealer,$now)['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe','phone'=>'05551000067']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','species'=>'Köpek','owner'=>'c1']];
$state->stays=[(object)['id'=>'y1','branch'=>'merkez','patient'=>'p1','kind'=>'Hospitalizasyon','room'=>'K-2','status'=>'Yatışta','start'=>$start,
  'careOrders'=>json_encode([['id'=>'o1','due'=>$due,'text'=>'Sefazolin 22 mg/kg IV','status'=>'pending']])]];
$state=$save($state);
// Vital ekleme: personel ve kayıt saati mühürlenir, sahte "by" alanı yok sayılır
$stay=$state->stays[0];
$stay->icuVitals=json_encode([['id'=>'v1','at'=>$at,'temp'=>'39.6','hr'=>'150','note'=>'Huzursuz','by'=>'Sahte']]);
$stay->icuInfusions=json_encode([['id'=>'i1','start'=>$at,'drug'=>'Fentanil','dose'=>'3 mcg/kg/sa','rate'=>'2.5','volume'=>'50']]);
$state=$save($state);
$v=json_decode($state->stays[0]->icuVitals)[0]; $i=json_decode($state->stays[0]->icuInfusions)[0];
ok($v->temp==='39.6' && $v->by!=='Sahte' && $v->by!=='' && isset($v->createdAt),'Vital mühürlenmedi');
ok($i->drug==='Fentanil' && $i->rate==='2.5' && !isset($i->stop),'İnfüzyon saklanmadı');
// Geçmiş vital değiştirilemez, silinemez
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuVitals); $x[0]->temp='38.5'; $bad->stays[0]->icuVitals=json_encode($x);
fails(fn()=>$save($bad),'Geçmiş vital değiştirilebildi');
$bad=json_decode(json_encode($state)); $bad->stays[0]->icuVitals='[]';
fails(fn()=>$save($bad),'Vital silinebildi');
// Aralık dışı değer ve ileri tarih reddedilir
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuVitals); $x[]=['id'=>'v2','at'=>$at,'temp'=>'80']; $bad->stays[0]->icuVitals=json_encode($x);
fails(fn()=>$save($bad),'Aralık dışı ateş kabul edildi');
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuVitals); $x[]=['id'=>'v3','at'=>gmdate('Y-m-d\TH:i',$now+5*86400),'hr'=>'90']; $bad->stays[0]->icuVitals=json_encode($x);
fails(fn()=>$save($bad),'İleri tarihli vital kabul edildi');
// Eski istemci alanları göndermez: kayıtlar korunur
$old=json_decode(json_encode($state)); unset($old->stays[0]->icuVitals,$old->stays[0]->icuInfusions); $old->stays[0]->room='K-3';
$state=$save($old);
ok(count(json_decode($state->stays[0]->icuVitals))===1 && count(json_decode($state->stays[0]->icuInfusions))===1 && $state->stays[0]->room==='K-3','Eski istemci yoğun bakım kayıtlarını sildi');
// İnfüzyon durdurma (bir kez) ve talimat uygulama
$next=json_decode(json_encode($state)); $x=json_decode($next->stays[0]->icuInfusions); $x[0]->stop=gmdate('Y-m-d\TH:i',$now-600); $next->stays[0]->icuInfusions=json_encode($x);
$o=json_decode($next->stays[0]->careOrders); $o[0]->status='done'; $next->stays[0]->careOrders=json_encode($o);
$state=$save($next);
$i=json_decode($state->stays[0]->icuInfusions)[0]; $o=json_decode($state->stays[0]->careOrders)[0];
ok(isset($i->stop,$i->stoppedBy) && $o->status==='done' && isset($o->closedBy),'Durdurma veya talimat uygulama saklanmadı');
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuInfusions); $x[0]->stop=gmdate('Y-m-d\TH:i',$now-300); $bad->stays[0]->icuInfusions=json_encode($x);
fails(fn()=>$save($bad),'Durmuş infüzyonun saati değiştirilebildi');
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuInfusions); $x[0]->rate='9'; $bad->stays[0]->icuInfusions=json_encode($x);
fails(fn()=>$save($bad),'İnfüzyon hızı geriye dönük değiştirilebildi');
// Taburcu sonrası yeni vital eklenemez
$next=json_decode(json_encode($state)); $next->stays[0]->status='Taburcu'; $next->stays[0]->end=gmdate('Y-m-d\TH:i',$now); $state=$save($next);
$bad=json_decode(json_encode($state)); $x=json_decode($bad->stays[0]->icuVitals); $x[]=['id'=>'v4','at'=>$at,'hr'=>'90']; $bad->stays[0]->icuVitals=json_encode($x);
fails(fn()=>$save($bad),'Taburcu hastaya vital eklendi');
echo "PASS Yoğun bakım: vital/CRI mühürleme, değiştirilemez geçmiş, aralık denetimi, eski istemci koruması, durdurma ve talimat uygulama\n";
