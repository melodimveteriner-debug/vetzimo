<?php
declare(strict_types=1);
// Cihaz entegrasyonu: cihaz ekleme, ajandan sonuç, mikroçip/protokol/ad+sahip ile otomatik eşleştirme, aynı adlı hastalarda
// onaya düşme ve elle atama, tekrar gelen sonucun atlanması, parçalı dosya, "sonuç hazır" bildirimi, içe aktarıldı işareti.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,MinistryBridge,DeviceHub};
require __DIR__.'/bootstrap.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Cihaz Test','05551000188','cihaz@example.test','Cihaz-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('d',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000188','Cihaz-test-secret-42','192.0.2.188',$now);
$dealer=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($dealer,$now));
$data=$work->read($dealer,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Yılmaz','phone'=>'05551000189'],(object)['id'=>'c2','branch'=>'merkez','name'=>'Mehmet Kaya','phone'=>'05551000190'],
  (object)['id'=>'c3','branch'=>'merkez','name'=>'Zeynep Demir','phone'=>'05551000191']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','species'=>'Kedi','owner'=>'c1','chip'=>'900123456789012'],
  (object)['id'=>'p2','branch'=>'merkez','name'=>'Pamuk','species'=>'Köpek','owner'=>'c2'],
  (object)['id'=>'p3','branch'=>'merkez','name'=>'Paşa','species'=>'Köpek','owner'=>'c3']];
$api->save($dealer,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
$protocol=$db->query("SELECT protocol_key FROM clinic_record WHERE collection='patients' AND record_id='p2'")->fetchColumn();
ok(is_string($protocol) && $protocol!=='','Protokol numarası indekslenmedi');
$hub=new DeviceHub($db);
$devices=$hub->save($actor,(object)['name'=>'Mindray BC-30','kind'=>'hematology','connection'=>'tcp','settings'=>(object)['port'=>5600]],$now);
$dev=$devices[0]['id'];
$hub->save($actor,(object)['name'=>'DR Röntgen','kind'=>'xray','connection'=>'dicom','settings'=>(object)['port'=>11112,'aeTitle'=>'vetzimo']],$now);
try { $hub->save($actor,(object)['name'=>'X','kind'=>'xray','connection'=>'tcp','settings'=>(object)['port'=>80]],$now); ok(false,'Geçersiz port kabul edildi'); } catch (RuntimeException $e) {}
$b=new MinistryBridge($db);
$agent=$b->agentAuth('Bearer '.$b->agentPair($b->pair($actor,$now)['code'],'Klinik PC','1.3.0',$now)['token']);
ok(count($hub->agentDevices($agent,$now)['devices'])===2,'Ajan cihazları alamadı');
$params=[(object)['code'=>'WBC','name'=>'WBC','value'=>'24.5','unit'=>'10^9/L','low'=>'6','high'=>'17','flag'=>'H']];
// 1) Mikroçip ile
$r=$hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['chip'=>'900123456789012','name'=>'Bilinmez'],'params'=>$params],$now);
ok($r['status']==='matched' && $r['by']==='chip','Mikroçip eşleşmedi: '.json_encode($r));
// 2) Aynı sonuç tekrar gelirse atlanır
ok(!empty($hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['chip'=>'900123456789012','name'=>'Bilinmez'],'params'=>$params],$now)['duplicate']),'Tekrarlanan sonuç kaydedildi');
// 3) Ad + sahip (Türkçe harf ve büyük/küçük harf farkı)
$r=$hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['name'=>'PAMUK','owner'=>'Mehmet KAYA'],'params'=>$params,'sample'=>'S2'],$now);
ok($r['status']==='matched' && $r['by']==='name+owner','Ad+sahip eşleşmedi: '.json_encode($r));
$row=$db->query("SELECT patient_id FROM clinic_device_result WHERE sample='S2'")->fetchColumn();
ok($row==='p2','Yanlış hastaya bağlandı: '.$row);
// 4) DICOM biçimi "SAHİP^HAYVAN" (sahip alanı yok)
$r=$hub->agentResult($agent,(object)['device'=>$dev,'kind'=>'xray','hint'=>(object)['name'=>'Pamuk','owner'=>'Ayse Yilmaz'],'params'=>[],'summary'=>'Toraks LL'],$now);
ok($r['status']==='matched','Sahipli röntgen eşleşmedi');
// 5) Protokol numarası
$r=$hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['patientId'=>$protocol],'params'=>$params,'sample'=>'S5'],$now);
ok($r['status']==='matched' && $r['by']==='protocol','Protokol eşleşmedi: '.json_encode($r));
// 6) Yalnız ad (iki Pamuk var): onaya düşer, adaylar sahipleriyle gelir; elle atanır
$r=$hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['name'=>'Pamuk'],'params'=>$params,'sample'=>'S6'],$now);
ok($r['status']==='pending' && $r['candidates']===2,'Belirsiz ad onaya düşmedi: '.json_encode($r));
$pending=$hub->inbox($actor,'pending')['items'][0];
ok(count($pending['candidates'])===2 && in_array('Ayşe Yılmaz',array_column($pending['candidates'],'owner'),true),'Adaylar sahip adıyla gelmedi');
$hub->resolve($actor,(object)['id'=>$pending['id'],'action'=>'assign','patient'=>'p1'],$now);
ok($db->query("SELECT status FROM clinic_device_result WHERE sample='S6'")->fetchColumn()==='matched','Elle atama yapılmadı');
// 7) Tek olan ad (Paşa / Pasa) eşleşir
$r=$hub->agentResult($agent,(object)['device'=>$dev,'hint'=>(object)['name'=>'Pasa'],'params'=>$params,'sample'=>'S7'],$now);
ok($r['status']==='matched','Türkçe harfsiz tek ad eşleşmedi: '.json_encode($r));
// 8) Parçalı dosya + sonuç
$file=bin2hex(random_bytes(16)); $bytes=str_repeat('A',100);
$hub->agentChunk($agent,$file,0,2,'pamuk.dcm','application/dicom',substr($bytes,0,60),$now);
try { $hub->agentResult($agent,(object)['device'=>$dev,'file'=>$file,'hint'=>(object)['chip'=>'900123456789012']],$now); ok(false,'Eksik dosya kabul edildi'); } catch (RuntimeException $e) { ok($e->getCode()===409,'Yanlış hata'); }
ok($hub->agentChunk($agent,$file,1,2,'pamuk.dcm','application/dicom',substr($bytes,60),$now)['complete'],'Dosya tamamlanmadı');
$r=$hub->agentResult($agent,(object)['device'=>$dev,'kind'=>'xray','file'=>$file,'hint'=>(object)['chip'=>'900123456789012'],'title'=>'Toraks'],$now);
$f=$hub->file($actor,$file); ob_start(); $hub->streamFile($f['id']); ok(ob_get_clean()===$bytes && (int)$f['size']===100,'Dosya bütün değil');
// 9) "Sonuç hazır" bildirimi kuyruğa düştü; klinik sonuçları alıp içe aktarıldı işaretler
ok((int)$db->query("SELECT COUNT(*) FROM clinic_delivery_notice WHERE title LIKE 'Tetkik sonucu hazır%'")->fetchColumn()>=6,'Sonuç hazır bildirimi yok');
$claim=$hub->claimMatched($actor)['items'];
ok(count($claim)>=6 && in_array('Hemogram',array_column($claim,'labKind'),true) && in_array('Röntgen',array_column($claim,'labKind'),true),'Eşleşen sonuçlar alınamadı');
$hub->imported($actor,(object)['items'=>[(object)['id'=>$claim[0]['id'],'lab'=>'dev-'.$claim[0]['id']]]],$now);
ok($db->query("SELECT status FROM clinic_device_result WHERE id='".$claim[0]['id']."'")->fetchColumn()==='imported','İçe aktarıldı işaretlenmedi');
// 10) Başka bayinin dosyası açılamaz
try { $hub->file(['partner_id'=>'baska'],$file); ok(false,'Başka bayinin dosyası açıldı'); } catch (RuntimeException $e) {}
echo "PASS cihaz entegrasyonu: mikroçip/protokol/ad+sahip eşleşme, belirsiz adda onay ve elle atama, tekrar atlama, parçalı dosya, bildirim, içe aktarma, yalıtım\n";
