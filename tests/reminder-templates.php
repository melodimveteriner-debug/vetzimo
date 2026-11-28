<?php
declare(strict_types=1);
// Otomatik hatırlatma metinleri: aşıda {tarih} yalnız tarihtir (saat yazılmaz), randevuda saatle yazılır; {klinik}
// klinik adıdır (şube adı "Merkez" değil); saatsiz hatırlatmanın kuyruk süresi gün sonudur (10:00'da açılan gönderim
// penceresinde süresi dolmaz); eski tekrar önleme anahtarı korunur (yayından sonra mesaj ikinci kez gitmez); kuyruktaki
// eski metin yenilenir; eşzamanlı çalışmada tek mesaj; WhatsApp bilgisayar programı kapalıysa klinik uyarılır.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,PhoneGateway,AppointmentReminders,ClinicAlerts,Commerce};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$dsn=getenv('VETNET_TEST_DSN');
if (($argv[1] ?? '')==='child') {
    $db=Database::connect($dsn,'root','');
    echo json_encode((new AppointmentReminders($db))->run([],time()));
    exit(0);
}
$zone=new DateTimeZone('Europe/Istanbul');
$now=time();
$day=(new DateTimeImmutable('@'.($now+2*86400)))->setTimezone($zone)->format('Y-m-d');
$dmy=(new DateTimeImmutable($day,$zone))->format('d.m.Y');
$state=fn(array $prefs)=>(object)['preferences'=>(object)($prefs+['clinic'=>'Melodim Veteriner']),
    'branches'=>[(object)['id'=>'merkez','name'=>'Merkez','status'=>'Aktif']],
    'clients'=>[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Yılmaz','phone'=>'05321112233','sms'=>'Var','whatsapp'=>'Var']],
    'patients'=>[(object)['id'=>'p1','branch'=>'merkez','name'=>'HERA','owner'=>'c1','species'=>'Köpek']],
    'followups'=>[(object)['id'=>'f1','branch'=>'merkez','patient'=>'p1','kind'=>'Aşı','status'=>'Planlandı','date'=>$day,'title'=>'İç - Dış Parazit']],
    'appointments'=>[(object)['id'=>'a1','branch'=>'merkez','patient'=>'p1','client'=>'c1','date'=>$day,'time'=>'14:30','status'=>'Planlandı','service'=>'Kontrol']]];
$auto=['customerReminder_followups_mode'=>'auto','customerReminder_followups_schedule'=>'168','customerReminder_followups_whatsapp'=>'Evet','customerReminder_followups_sms'=>'Evet',
    'customerReminder_appointments_mode'=>'auto','customerReminder_appointments_schedule'=>'168','customerReminder_appointments_sms'=>'Evet'];

// ── metinler (veritabanısız)
$jobs=AppointmentReminders::jobs($state($auto),'Bayi Hesabı',$now);
$vac=array_values(array_filter($jobs,fn($j)=>$j['kind']==='followups'))[0];
$app=array_values(array_filter($jobs,fn($j)=>$j['kind']==='appointments'))[0];
ok($vac['message']==="HERA için $dmy tarihinde İç - Dış Parazit aşısı planlandı. Melodim Veteriner",'Aşı metni yanlış: '.$vac['message']);
ok(!preg_match('/\d{2}:\d{2}/',$vac['message']) && $vac['parameters'][1]===$dmy,'Aşı mesajında saat var');
ok($app['message']==="HERA için randevunuz $dmy 14:30. Melodim Veteriner",'Randevu metni yanlış: '.$app['message']);
ok(!str_contains($vac['message'].$app['message'],'Merkez'),'Klinik adı yerine şube adı yazıldı');
ok($vac['due']===$day.' 09:00' && $vac['expires']===$day.' 21:00' && $app['expires']===$day.' 14:30','Süre/anahtar zamanı yanlış');
// {saat} ayrıca kullanılırsa saat iki kez yazılmaz; {sube} şube adıdır; klinik adı ayarı boşsa bayi hesabı adı
$custom=$state($auto+['clinic'=>'','customerReminder_appointments_text'=>'{hasta}: {tarih} saat {saat}, {klinik} {sube}','customerReminder_followups_text'=>'{hasta} {tarih} {saat}|']);
$jobs=AppointmentReminders::jobs($custom,'Bayi Hesabı',$now);
$byKind=array_column($jobs,'message','kind');
ok($byKind['appointments']==="HERA: $dmy saat 14:30, Bayi Hesabı Merkez",'Özel randevu şablonu yanlış: '.$byKind['appointments']);
ok($byKind['followups']==="HERA $dmy |",'Aşıda {saat} boş olmalı: '.$byKind['followups']);

// ── uçtan uca: WhatsApp otomatik + SMS telefon hattı
$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('Hatırlatma Test','05551000311','hat@example.test','Hatirlatma-test-42');
$login=new DealerLogin($db,str_repeat('h',32)); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000311','Hatirlatma-test-42','192.0.2.150',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor((new IdentityApi($db))->actor($cookies,$now));
$partner=$actor['partner_id'];
$data=$work->read($cookies,$now); $s=$data['state']; $t=$state($auto);
$s->preferences=(object)array_merge((array)$s->preferences,(array)$t->preferences);
foreach (['clients','patients','followups','appointments'] as $c) $s->$c=$t->$c;
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$s]);
$gw=new PhoneGateway($db);
$hour=(int)(new DateTimeImmutable('@'.$now))->setTimezone($zone)->format('G');
$gw->saveSettings($actor,(object)['sms'=>true,'simSlot'=>'','smsInterval'=>75,'smsPerDay'=>200,'whatsapp'=>'auto','waRiskAccepted'=>true,'waInterval'=>120,'waPerDay'=>150,
    'sendStart'=>sprintf('%02d:00',($hour+23)%24),'sendHours'=>3],$now);
$gw->agentPair($gw->pair($actor,$now)['code'],'Telefon','1.0.0','',$now);

// 6 süreç aynı anda çalışır → her kanal için tek mesaj
$procs=[];$pipes=[];
for ($k=0;$k<6;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child'],[1=>['pipe','w'],2=>['pipe','w']],$pipes[$k],null,['VETNET_TEST_DSN'=>$dsn]);
foreach ($procs as $k=>$p) { stream_get_contents($pipes[$k][1]); $err=stream_get_contents($pipes[$k][2]); proc_close($p); ok($err==='','Alt süreç hatası: '.$err); }
$rows=$db->query("SELECT channel,body,expires_at,source_ref FROM phone_outbox WHERE source='reminder' ORDER BY channel,id")->fetchAll(PDO::FETCH_ASSOC);
ok(count($rows)===3,'Kuyrukta 3 mesaj olmalı (aşı SMS+WhatsApp, randevu SMS): '.count($rows));
$wa=array_values(array_filter($rows,fn($r)=>$r['channel']==='whatsapp'))[0];
ok($wa['body']==="HERA için $dmy tarihinde İç - Dış Parazit aşısı planlandı. Melodim Veteriner",'WhatsApp metni yanlış: '.$wa['body']);
ok((int)$wa['expires_at']===strtotime($day.' 21:00 +03:00'),'Aşı mesajı gün sonuna kadar geçerli olmalı');
// Eski anahtar korunur: yayından önce kuyruğa girmiş hatırlatma ikinci kez eklenmez
$legacy=hash('sha256',json_encode([$partner,'merkez','f1',$day.' 09:00','whatsapp','followups'],JSON_THROW_ON_ERROR));
ok($wa['source_ref']===$legacy,'Tekrar önleme anahtarı değişti (eski hatırlatmalar yeniden gider)');

// Kuyruktaki eski metin ve 09:00 süresi yenilenir; gönderilmiş mesaja dokunulmaz
$db->prepare("UPDATE phone_outbox SET body='HERA için 29.11.2026 09:00 ... Merkez',expires_at=? WHERE source='reminder' AND channel='whatsapp'")->execute([strtotime($day.' 09:00 +03:00')]);
$db->exec("UPDATE phone_outbox SET status='sent',body='gönderildi' WHERE source='reminder' AND channel='sms' AND body LIKE '%randevunuz%'");
(new AppointmentReminders($db))->run([],time());
$wa2=$db->query("SELECT body,expires_at FROM phone_outbox WHERE source='reminder' AND channel='whatsapp'")->fetch(PDO::FETCH_ASSOC);
ok($wa2['body']===$wa['body'] && (int)$wa2['expires_at']===(int)$wa['expires_at'],'Kuyruktaki eski mesaj yenilenmedi');
ok($db->query("SELECT COUNT(*) FROM phone_outbox WHERE body='gönderildi'")->fetchColumn()==1,'Gönderilmiş mesaj değiştirildi');
ok((int)$db->query("SELECT COUNT(*) FROM phone_outbox WHERE source='reminder'")->fetchColumn()===3,'Tekrar çalışmada mesaj çoğaldı');

// ── WhatsApp bilgisayar programı yok/kapalı → klinik uyarılır; hazırsa uyarı yok
$db->exec("UPDATE phone_outbox SET created_at=created_at-3600");
$alerts=new ClinicAlerts($db);
$titles=fn()=>array_column($alerts->list($actor,time())['items'] ?? $alerts->list($actor,time()),'title');
ok(in_array('WhatsApp otomatik gönderim durdu',$titles(),true),'Program kapalıyken uyarı yok: '.json_encode($titles()));
$agentId=bin2hex(random_bytes(8));
$gw->waSync(['partner_id'=>$partner,'id'=>$agentId],(object)['state'=>'qr'],time());
ok(in_array('WhatsApp otomatik gönderim durdu',$titles(),true),'QR bekleyen oturumda uyarı yok');
$gw->waSync(['partner_id'=>$partner,'id'=>$agentId],(object)['state'=>'ready'],time());
ok(!in_array('WhatsApp otomatik gönderim durdu',$titles(),true),'Program hazırken uyarı çıktı');
echo "Hatırlatma şablon testleri geçti\n";
