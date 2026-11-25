<?php
declare(strict_types=1);
// Telefon Bağlantısı: eşleştirme, sessiz saat ve hız sınırları, hatırlatma/toplu mesaj/gelen kutusu yanıtlarının
// kliniğin kendi hattına yönlenmesi, gelen SMS'in gelen kutusuna düşmesi, yarı otomatik ve otomatik WhatsApp,
// sonuç bildirmeyen işin tekrar gönderilmemesi, süresi geçen hatırlatma ve yetki ayrımı.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,PhoneGateway,OmniInbox,AppointmentReminders,BulkClinicMessages,Commerce};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Phone Test','05551000136','phone@example.test','Phone-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('p',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000136','Phone-test-secret-42','192.0.2.130',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor($identity->actor($cookies,$now)); $actor['name']='Dr. Ayşe';
$partner=$actor['partner_id'];
$zone=new DateTimeZone('Europe/Istanbul');
$appt=(new DateTimeImmutable('@'.($now+5*3600)))->setTimezone($zone);
$data=$work->read($cookies,$now); $state=$data['state'];
$state->preferences=(object)array_merge((array)($state->preferences??[]),['customerReminder_appointments_mode'=>'auto','customerReminder_appointments_schedule'=>'24',
  'customerReminder_appointments_sms'=>'Evet','customerReminder_appointments_whatsapp'=>'Evet']);
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Yılmaz','phone'=>'0532 111 22 33','sms'=>'Var','whatsapp'=>'Var'],
  (object)['id'=>'c2','branch'=>'merkez','name'=>'Cem Er','phone'=>'05443334455','sms'=>'Var','whatsapp'=>'Var']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','owner'=>'c1','species'=>'Kedi']];
$state->appointments=[(object)['id'=>'a1','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>$appt->format('Y-m-d'),'time'=>$appt->format('H:i'),'status'=>'Planlandı','service'=>'Aşı']];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$gw=new PhoneGateway($db); $inbox=new OmniInbox($db,base64_encode(str_repeat('k',32)),'https://klinik.example');
$hourNow=(int)(new DateTimeImmutable('@'.$now))->setTimezone($zone)->format('G');
$open=['sendStart'=>sprintf('%02d:00',($hourNow+23)%24),'sendHours'=>3];
$closed=['sendStart'=>sprintf('%02d:00',($hourNow+3)%24),'sendHours'=>1];
$settings=static fn(array $x)=>(object)array_merge(['sms'=>true,'simSlot'=>'','smsInterval'=>75,'smsPerDay'=>200,'whatsapp'=>'assist','waRiskAccepted'=>false,'waInterval'=>120,'waPerDay'=>150],$open,$x);

// ── eşleştirme ve yönlendirme
ok($gw->route($partner,'sms')===false,'Ayar yokken SMS telefona yönlendi');
$gw->saveSettings($actor,$settings([]),$now);
ok($gw->route($partner,'sms')===false,'Bağlı telefon yokken SMS telefona yönlendi');
$staff=$actor; $staff['role']='staff'; $staff['modules']=json_encode(['clients'=>'write']);
try { $gw->pair($staff,$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Personel telefon eşleştirebildi');
$code=$gw->pair($actor,$now)['code'];
try { $gw->agentPair('AAAAA-BBBBB','x','1','',$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Yanlış kodla eşleşildi');
$token=$gw->agentPair($code,'Redmi Note','1.0.0','Termux',$now)['token'];
try { $gw->agentPair($code,'x','1','',$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Aynı kod iki kez kullanıldı');
$device=$gw->agentAuth('Bearer '.$token);
ok($gw->route($partner,'sms')===true && $gw->route($partner,'whatsapp')==='assist','Yönlendirme yanlış');
ok(!str_contains((string)$db->query("SELECT token_hash FROM phone_device")->fetchColumn(),$token),'Anahtar düz saklandı');

// ── hatırlatmalar kliniğin hattına
$stats=(new AppointmentReminders($db))->run([],$now);
ok($stats['accepted']===2,'Hatırlatmalar kuyruğa girmedi: '.json_encode($stats));
(new AppointmentReminders($db))->run([],$now);
ok((int)$db->query("SELECT COUNT(*) FROM phone_outbox WHERE source='reminder'")->fetchColumn()===2,'Hatırlatma iki kez kuyruğa girdi');
$rem=$db->query("SELECT * FROM phone_outbox WHERE source='reminder' AND channel='sms'")->fetch(PDO::FETCH_ASSOC);
ok($rem['phone']==='+905321112233' && str_contains($rem['body'],'Pamuk') && (int)$rem['expires_at']>$now,'Hatırlatma içeriği yanlış');

// ── gönderim penceresi dışında yalnız öncelikli (test/gelen kutusu) işler gider
$gw->saveSettings($actor,$settings($closed),$now);
$gw->act($actor,(object)['action'=>'test','channel'=>'sms','phone'=>'05551000137','text'=>'Deneme'],$now);
$r=$gw->sync($device,(object)['version'=>'1.0.0','battery'=>80],$now,$inbox);
ok(count($r['jobs'])===1 && $r['jobs'][0]['body']==='Deneme','Sessiz saatte yalnız deneme mesajı verilmeliydi');
$test=$r['jobs'][0]['id'];
$gw->saveSettings($actor,$settings([]),$now);
$r=$gw->sync($device,(object)['results'=>[(object)['id'=>$test,'status'=>'sent']]],$now+30,$inbox);
ok(count($r['jobs'])===0 && $r['interval']>=3,'Mesaj arası bekleme uygulanmadı');
$r=$gw->sync($device,(object)[],$now+100,$inbox);
ok(count($r['jobs'])===1 && $r['jobs'][0]['id']===(int)$rem['id'],'Bekleme sonrası hatırlatma verilmedi');
$r2=$gw->sync($device,(object)[],$now+101,$inbox);
ok(count($r2['jobs'])===0,'Aynı iş iki kez verildi veya aralık aşıldı');
$gw->sync($device,(object)['results'=>[(object)['id'=>(int)$rem['id'],'status'=>'sent']]],$now+102,$inbox);
ok($db->query("SELECT status FROM phone_outbox WHERE id=".$rem['id'])->fetchColumn()==='sent','Gönderim sonucu işlenmedi');

// ── gelen SMS gelen kutusuna, müşteriyle eşleşir; kısa numaralar atlanır
$in=[(object)['id'=>501,'number'=>'05321112233','body'=>'Yarın gelebilir miyiz?','at'=>$now-30],(object)['id'=>502,'number'=>'4040','body'=>'Kampanya']];
$r=$gw->sync($device,(object)['inbound'=>$in],$now+3,$inbox);
$gw->sync($device,(object)['inbound'=>$in],$now+4,$inbox);
$conv=$inbox->list($actor,['channel'=>'sms'],$now)['items'];
ok($r['received']===1 && count($conv)===1 && $conv[0]['client']==='c1' && $conv[0]['unread']===1,'Gelen SMS alınmadı, tekrarlandı veya eşleşmedi');
$t=$inbox->act($actor,(object)['action'=>'reply','id'=>$conv[0]['id'],'text'=>'Elbette, 10:00 uygun.'],$now+5);
$out=array_values(array_filter($t['messages'],static fn($m)=>$m['direction']==='out'));
ok(count($out)===1 && $out[0]['status']==='queued' && !isset($t['warning']),'Gelen kutusu yanıtı telefona kuyruklanmadı');
$r=$gw->sync($device,(object)[],$now+200,$inbox);
ok(count($r['jobs'])>=1 && str_starts_with($r['jobs'][0]['body'],"Elbette, 10:00 uygun.\n— "),'Gelen kutusu yanıtı öncelikli verilmedi veya personel imzası eklenmedi');
$gw->sync($device,(object)['results'=>[(object)['id'=>$r['jobs'][0]['id'],'status'=>'sent']]],$now+201,$inbox);
$t=$inbox->thread($actor,$conv[0]['id'],$now);
ok(array_values(array_filter($t['messages'],static fn($m)=>$m['direction']==='out'))[0]['status']==='sent','Gelen kutusundaki mesaj durumu güncellenmedi');

// ── yarı otomatik WhatsApp: bildirim → açıldı
$r=$gw->sync($device,(object)[],$now+202,$inbox);
ok(count($r['assist'])===1 && str_starts_with($r['assist'][0]['link'],'https://wa.me/905321112233?text='),'WhatsApp bildirimi hazırlanmadı');
$gw->sync($device,(object)['opened'=>[$r['assist'][0]['id']]],$now+203,$inbox);
ok($db->query("SELECT status FROM phone_outbox WHERE channel='whatsapp' AND source='reminder'")->fetchColumn()==='sent','Açılan WhatsApp mesajı gönderildi sayılmadı');

// ── otomatik WhatsApp (bilgisayardaki WhatsApp Web)
try { $gw->saveSettings($actor,$settings(['whatsapp'=>'auto']),$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Risk onayı olmadan otomatik WhatsApp açıldı');
$gw->saveSettings($actor,$settings(['whatsapp'=>'auto','waRiskAccepted'=>true]),$now);
$gw->act($actor,(object)['action'=>'test','channel'=>'whatsapp','phone'=>'05443334455','text'=>'WhatsApp denemesi'],$now);
$agent=['id'=>'agent1','partner_id'=>$partner];
$w=$gw->waSync($agent,(object)['state'=>'qr'],$now,$inbox);
ok($w['jobs']===[],'WhatsApp oturumu açılmadan iş verildi');
$w=$gw->waSync($agent,(object)['state'=>'ready','inbound'=>[(object)['id'=>'false_905443334455@c.us_ABC','phone'=>'905443334455','name'=>'Cem','body'=>'Merhaba, mama var mı?','at'=>$now]]],$now,$inbox);
ok(count($w['jobs'])===1 && $w['jobs'][0]['body']==='WhatsApp denemesi' && $w['received']===1,'Otomatik WhatsApp işi veya gelen mesaj işlenmedi');
$gw->waSync($agent,(object)['state'=>'ready','results'=>[(object)['id'=>$w['jobs'][0]['id'],'status'=>'sent']]],$now,$inbox);
$wc=$inbox->list($actor,['channel'=>'whatsapp'],$now)['items'];
ok(count($wc)===1 && $wc[0]['client']==='c2' && $wc[0]['window']===null,'WhatsApp Web konuşması eşleşmedi veya 24 saat kuralı uygulandı');
$t=$inbox->act($actor,(object)['action'=>'reply','id'=>$wc[0]['id'],'text'=>'Evet, stokta var.'],$now+10);
ok(!isset($t['warning']),'WhatsApp Web yanıtı kuyruklanmadı');

// ── toplu mesaj: kredi ve onaylı şablon gerekmeden kliniğin numarasından
$bulk=new BulkClinicMessages($db,['rateSecret'=>str_repeat('h',32),'appointmentReminderConnections'=>[]]);
$req=['channel'=>'whatsapp','branchId'=>'merkez','templateId'=>'','iysfilter'=>'0','message'=>'Sayın {sahip}, kliniğimiz bayramda açıktır.','targets'=>[(object)['client'=>'c1','patient'=>'','vaccine'=>'']]];
$pre=$bulk->bulk($actor,(object)$req,true);
ok($pre['results'][0]['status']==='ready' && $pre['results'][0]['units']===0,'Toplu WhatsApp önizlemesi telefon için hazırlanmadı');
$req['requestId']='req-'.bin2hex(random_bytes(8)); $req['confirm']=true; $req['targets'][0]->proof=$pre['results'][0]['proof'];
$sent=$bulk->bulk($actor,(object)$req,false);
ok($sent['results'][0]['status']==='queued','Toplu mesaj kredi olmadan kuyruğa girmedi: '.json_encode($sent['results'][0],JSON_UNESCAPED_UNICODE));
$bulk->deliver();
ok((int)$db->query("SELECT COUNT(*) FROM phone_outbox WHERE source='bulk'")->fetchColumn()===1,'Toplu mesaj telefon kuyruğuna aktarılmadı');

// ── sonuç bildirmeyen iş tekrar gönderilmez; süresi geçen hatırlatma düşer
$gw->act($actor,(object)['action'=>'test','channel'=>'sms','phone'=>'05551000138','text'=>'Kayıp sonuç'],$now);
$r=$gw->sync($device,(object)[],$now+300,$inbox);
$lost=array_values(array_filter($r['jobs'],static fn($j)=>$j['body']==='Kayıp sonuç'))[0]['id'];
$gw->sync($device,(object)[],$now+300+1000,$inbox);
ok($db->query("SELECT status FROM phone_outbox WHERE id=$lost")->fetchColumn()==='unknown','Sonuçsuz iş belirsiz işaretlenmedi');
try { $gw->act($actor,(object)['action'=>'retry','id'=>$lost],$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Belirsiz iş onaysız yeniden gönderildi');
$gw->act($actor,(object)['action'=>'retry','id'=>$lost,'checked'=>true],$now);
$id=$gw->enqueue($partner,'sms','05551000139','Geçmiş hatırlatma','reminder','old-key',1,$now,$now-10);
$gw->sync($device,(object)[],$now+1300,$inbox);
ok($db->query("SELECT status FROM phone_outbox WHERE id=$id")->fetchColumn()==='expired','Süresi geçen hatırlatma düşmedi');

// ── yetki ve ayrım
$foreign=$actor; $foreign['partner_id']=str_repeat('f',32);
try { $gw->act($foreign,(object)['action'=>'cancel','id'=>$id],$now); $leak=true; } catch (RuntimeException) { $leak=false; }
ok(!$leak,'Başka klinik kuyruğa erişti');
$status=$gw->status($actor,$now+1300);
ok(count($status['devices'])===1 && $status['devices'][0]['battery']===80 && isset($status['counts']['sms']),'Durum ekranı eksik');
$gw->revoke($actor,(object)['id'=>$device['id']],$now);
try { $gw->agentAuth('Bearer '.$token); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Kaldırılan telefon bağlanmaya devam etti');
echo "phone gateway ok\n";
