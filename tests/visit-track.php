<?php
declare(strict_types=1);
// Evde hizmet canlı rota: yola çıkınca durum "Yola çıkıldı" olur ve hasta sahibine tahmini süreli bildirim gider,
// yaklaşınca ikinci bildirim, hasta sahibi tam konumu görmez, herkese açık bağlantı yalnız süreyi gösterir,
// varışta konum silinir, Google yorum isteği bir kez gider; Google bağlantısı ve Place ID doğrulanır.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,HomeVisit,VisitTracker,ReviewLink,Commerce,Totp,WebBuilder};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Rota Test','05551000199','rota@example.test','Rota-test-secret-42');
$config=['encryptionKey'=>base64_encode(str_repeat('r',32))];
$now=time();
$l=(new DealerLogin($db,str_repeat('r',32)))->signIn('05551000199','Rota-test-secret-42','192.0.2.199',$now);
$actor=(new Commerce($db))->packageActor((new IdentityApi($db))->actor([VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$l['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$l['device']],$now));
$p=$actor['partner_id'];
// Hasta sahibi uygulama hesabı
$db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES ('acc-owner','phone','+905551000200')")->execute();
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,modules,status) VALUES ('m-owner','acc-owner',?,'customer','merkez','c1','{}','active')")->execute([$p]);
// Personel atanmış ziyaret (hedef: Eskişehir Odunpazarı)
$snapshot=Totp::encrypt(WebBuilder::json(['name'=>'Ayşe Yılmaz','phone'=>'05551000200','animal'=>'Pamuk','species'=>'Kedi','location'=>['latitude'=>39.7667,'longitude'=>30.5256,'district'=>'Odunpazarı','province'=>'Eskişehir'],'services'=>[]]),$config['encryptionKey']);
$id=str_repeat('a',32);
$db->prepare("INSERT INTO clinic_visit_request(id,partner_id,branch_id,customer_id,patient_id,status,revision,snapshot,request_hash) VALUES (?,?,?,?,?,'assigned',3,?,?)")->execute([$id,$p,'merkez','c1','p1',$snapshot,str_repeat('h',64)]);
$db->prepare("INSERT INTO clinic_visit_slot(visit_id,partner_id,clinician,assistant,vehicle,starts,ends) VALUES (?,?,?,?,?,NOW(),NOW()+INTERVAL 1 HOUR)")->execute([$id,$p,$actor['membership_id'],'','']);
$visits=new HomeVisit($db,$config);
$t=new VisitTracker($db,$visits,'https://vetzimo.test');
// ETA hesabı: 10 km kuş uçuşu, ölçülen hız yok → şehir içi ortalama
[$road,$eta]=VisitTracker::eta(10000,null);
ok($road===13500 && $eta>1500 && $eta<1900,"ETA hesabı yanlış: $road m $eta sn");
// Yola çık (yaklaşık 6 km uzakta)
$s=$t->start($actor,$id,(object)['lat'=>39.7767,'lng'=>30.4600,'accuracy'=>12,'speed'=>null],$now);
ok($s['active'] && $s['eta']>0 && $s['distance']>5000 && $s['lat']!==null,'Başlatma durumu yanlış: '.json_encode($s));
ok($db->query("SELECT status FROM clinic_visit_request WHERE id='$id'")->fetchColumn()==='departed','Durum yola çıkıldı olmadı');
$n=$db->query("SELECT title,body FROM app_notification WHERE account_id='acc-owner' AND category='homeVisits'")->fetchAll();
ok(count($n)===1 && str_contains($n[0]['title'],'yola çıktı') && str_contains($n[0]['body'],'Tahmini varış'),'Yola çıktı bildirimi yok: '.json_encode($n,JSON_UNESCAPED_UNICODE));
// Tekrar başlatma ikinci bildirim üretmez
$t->start($actor,$id,(object)['lat'=>39.7767,'lng'=>30.4600],$now+1);
ok((int)$db->query("SELECT COUNT(*) FROM app_notification WHERE account_id='acc-owner'")->fetchColumn()===1,'Tekrar başlatma bildirimi çoğalttı');
// Hasta sahibi tam konumu görmez
$owner=['partner_id'=>$p,'customer_id'=>'c1','role'=>'customer','membership_id'=>'m-owner'];
$o=$t->ownerState($owner,$id);
ok(!isset($o['lat']) && !isset($o['lng']) && $o['eta']>0 && $o['statusLabel']==='Yola çıkıldı','Hasta sahibine konum sızdı: '.json_encode($o));
// Yaklaşma (≈ 400 m) → ikinci bildirim, bir kez
$t->update($actor,$id,(object)['lat'=>39.7700,'lng'=>30.5250,'speed'=>8],$now+60);
$t->update($actor,$id,(object)['lat'=>39.7690,'lng'=>30.5252,'speed'=>8],$now+90);
$titles=$db->query("SELECT title FROM app_notification WHERE account_id='acc-owner' ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
ok(count($titles)===2 && str_contains($titles[1],'yaklaştı'),'Yaklaşma bildirimi yanlış: '.json_encode($titles,JSON_UNESCAPED_UNICODE));
// Herkese açık bağlantı: yalnız klinik adı, personelin ilk adı, süre
$hash=$db->query("SELECT public_hash FROM clinic_visit_track WHERE visit_id='$id'")->fetchColumn();
ok(strlen($hash)===64,'Takip bağlantısı yok');
ok($t->publicState(str_repeat('0',32))===null,'Geçersiz bağlantı açıldı');
$html=VisitTracker::publicPage(['clinic'=>'Rota Test','staff'=>'Ali','active'=>true,'eta'=>240,'distance'=>900,'statusLabel'=>'Yola çıkıldı']);
ok(str_contains($html,'~4 dk') && !str_contains($html,'39.7'),'Açık sayfa yanlış');
// Varış: konum silinir
$t->arrive($actor,$id,$now+120);
$row=$db->query("SELECT lat,lng,active FROM clinic_visit_track WHERE visit_id='$id'")->fetch();
ok($row['lat']===null && (int)$row['active']===0 && $db->query("SELECT status FROM clinic_visit_request WHERE id='$id'")->fetchColumn()==='arrived','Varışta konum silinmedi');
// Google yorum bağlantısı doğrulama
ok(ReviewLink::normalize('ChIJN1t_tDeuEmsRUsoyG83frY4')==='https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4','Place ID bağlantısı yanlış');
ok(ReviewLink::normalize('https://g.page/r/CabcdEFGhij')==='https://g.page/r/CabcdEFGhij/review','g.page bağlantısı yorum penceresine yönlenmiyor');
try { ReviewLink::normalize('https://kotu-site.example/yorum'); ok(false,'Google dışı bağlantı kabul edildi'); } catch (RuntimeException $e) {}
// Yorum isteği: bağlantı yokken hata, varken bir kez
$db->exec("UPDATE clinic_visit_request SET status='completed' WHERE id='$id'");
try { $t->askReview($actor,$id,$now); ok(false,'Bağlantısız yorum isteği gönderildi'); } catch (RuntimeException $e) { ok($e->getCode()===422,'Yanlış hata'); }
(new ReviewLink($db))->save($p,(object)['url'=>'ChIJN1t_tDeuEmsRUsoyG83frY4','message'=>'{klinik} olarak {hasta} için teşekkürler, yorumunuz değerli.']);
$r=$t->askReview($actor,$id,$now);
ok(in_array('app',$r['sent'],true),'Yorum isteği gitmedi');
$last=$db->query("SELECT title,body FROM app_notification WHERE account_id='acc-owner' ORDER BY id DESC LIMIT 1")->fetch();
ok(str_contains($last['body'],'Pamuk için teşekkürler'),'Yorum mesajı yer tutucuları doldurulmadı: '.$last['body']);
try { $t->askReview($actor,$id,$now); ok(false,'Yorum isteği iki kez gitti'); } catch (RuntimeException $e) { ok($e->getCode()===409,'Yanlış hata'); }
// Atanmamış personel başka ziyareti izleyemez
$other=['partner_id'=>$p,'role'=>'staff','branch_id'=>'merkez','membership_id'=>'m-x','account_id'=>'acc-x','name'=>'X','modules'=>json_encode(['appointments'=>'write'])];
try { $t->start($other,$id,(object)['lat'=>39.77,'lng'=>30.46],$now); ok(false,'Atanmamış personel konum paylaştı'); } catch (RuntimeException $e) {}
echo "PASS evde hizmet canlı rota: yola çıktı + tahmini süre, yaklaşma bildirimi (bir kez), sahibe konum gizli, açık bağlantı, varışta konum silme, Google yorum isteği\n";
