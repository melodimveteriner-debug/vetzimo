<?php
declare(strict_types=1);
// Uygulama merkezi: olaydan bildirim (yetkili kişiye, bir kez), kilit ekranı gizliliği, sessize alma, rozet sayısı,
// okundu/temizle, Web Push şifrelemesi (RFC 8291) geri çözülerek doğrulanır, geçersiz anahtar kapanır, hesap silme.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,AppHub,AppPush,DeliveryNotice};
require __DIR__.'/bootstrap.php';
foreach (['AppPush','AppHub','DeliveryNotice','ClinicAlerts'] as $c) require_once dirname(__DIR__).'/src/'.$c.'.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Uygulama Test','05551000177','app@example.test','App-test-secret-4242');
$config=['encryptionKey'=>base64_encode(str_repeat('k',32))];
$now=time();
$l=(new DealerLogin($db,str_repeat('u',32)))->signIn('05551000177','App-test-secret-4242','192.0.2.177',$now);
$cookies=[VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$l['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new IdentityApi($db))->actor($cookies,$now);
$p=$actor['partner_id'];
$hub=new AppHub($db,$config);
// Tarayıcı tarafı anahtarı (abonelik)
$ua=openssl_pkey_new(['curve_name'=>'prime256v1','private_key_type'=>OPENSSL_KEYTYPE_EC]);
$d=openssl_pkey_get_details($ua)['ec'];
$uaPub="\x04".str_pad($d['x'],32,"\0",STR_PAD_LEFT).str_pad($d['y'],32,"\0",STR_PAD_LEFT);
$auth=random_bytes(16);
$sub=(object)['endpoint'=>'https://push.example.test/abc123','keys'=>(object)['p256dh'=>AppPush::b64u($uaPub),'auth'=>AppPush::b64u($auth)]];
$reg=$hub->register($actor,'sessdev1',(object)['platform'=>'web','provider'=>'webpush','subscription'=>$sub,'appVersion'=>'1.0.0'],$now);
$hub->register($actor,'sessdev2',(object)['platform'=>'android','provider'=>'fcm','token'=>str_repeat('f',140)],$now);
ok(strlen($reg['device'])===32,'Cihaz kaydı yok');
// İlk çalışma geçmiş kuyruğu atlar
(new DeliveryNotice($db))->add($p,'merkez','','clinic','eski-olay','Yeni randevu','/clinic#record/appointments/x');
ok($hub->fanout($now)===0,'İlk çalışmada eski olaylar bildirime döndü');
(new DeliveryNotice($db))->add($p,'merkez','','clinic','olay-1','Kritik stok uyarısı','/clinic#product/p1');
(new DeliveryNotice($db))->add($p,'merkez','','clinic','olay-2','Tetkik sonucu hazır · Pamuk','/clinic#record/labs/l1');
ok($hub->fanout($now)===2,'Yeni olaylar bildirime dönmedi');
ok($hub->fanout($now)===0,'Aynı olay iki kez bildirildi');
$inbox=$hub->inbox($actor,null,null,false);
ok($inbox['unread']===2 && $inbox['items'][0]['category']==='labs','Bildirim merkezi yanlış: '.json_encode($inbox,JSON_UNESCAPED_UNICODE));
// Sessize alma: stok kapatılır
$hub->preferences($actor,'sessdev1',(object)['muted'=>['stock','security'],'sound'=>'vz_chime']);
ok(!in_array('security',$hub->settings($actor)['muted'],true),'Kritik kategori sessize alındı');
// Gönderim (sahte taşıyıcı ile)
$push=new AppPush($db,$config);
$sent=[];
$push->transport=function(string $url,array $h,string $body) use (&$sent){ $sent[]=[$url,$h,$body]; return str_contains($url,'fcm')?[404,'{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}']:[201,'']; };
$st=$push->work($now);
ok($st['sent']===1 && $st['muted']>=1,'Gönderim sayısı yanlış: '.json_encode($st));
[$url,$headers,$body]=$sent[0];
ok($url==='https://push.example.test/abc123' && in_array('Content-Encoding: aes128gcm',$headers,true),'Web Push isteği yanlış');
$vapid=array_values(array_filter($headers,fn($x)=>str_starts_with($x,'Authorization: vapid t=')))[0];
[$hdr,$cl,$sig]=explode('.',substr(explode(', k=',$vapid)[0],strlen('Authorization: vapid t=')));
$claims=json_decode(AppPush::unb64u($cl),true);
ok($claims['aud']==='https://push.example.test' && $claims['exp']>$now,'VAPID iddiaları yanlış');
// VAPID imzası açık anahtarla doğrulanır
$k=AppPush::unb64u(explode(', k=',$vapid)[1]);
$der=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$k;
$pub=openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n");
$raw=AppPush::unb64u($sig); $int=fn($b)=>(ord($b[0])&0x80?"\0".$b:$b);
$r=$int(ltrim(substr($raw,0,32),"\0")?:"\0"); $s=$int(ltrim(substr($raw,32),"\0")?:"\0");
$sigDer="\x30".chr(4+strlen($r)+strlen($s))."\x02".chr(strlen($r)).$r."\x02".chr(strlen($s)).$s;
ok(openssl_verify($hdr.'.'.$cl,$sigDer,$pub,OPENSSL_ALGO_SHA256)===1,'VAPID imzası doğrulanmadı');
// RFC 8291 çözme (tarayıcının yaptığı gibi)
$salt=substr($body,0,16); $idlen=ord($body[20]); $asPub=substr($body,21,$idlen); $ct=substr($body,21+$idlen);
$asDer=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$asPub;
$asKey=openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($asDer),64,"\n")."-----END PUBLIC KEY-----\n");
$shared=openssl_pkey_derive($asKey,$ua,32);
$ikm=hash_hkdf('sha256',$shared,32,"WebPush: info\0".$uaPub.$asPub,$auth);
$cek=hash_hkdf('sha256',$ikm,16,"Content-Encoding: aes128gcm\0",$salt);
$nonce=hash_hkdf('sha256',$ikm,12,"Content-Encoding: nonce\0",$salt);
$plain=openssl_decrypt(substr($ct,0,-16),'aes-128-gcm',$cek,OPENSSL_RAW_DATA,$nonce,substr($ct,-16));
ok($plain!==false && str_ends_with($plain,"\x02"),'Web Push yükü çözülemedi');
$msg=json_decode(substr($plain,0,-1),true);
ok($msg['category']==='labs' && $msg['badge']===2,'Yük içeriği yanlış: '.json_encode($msg,JSON_UNESCAPED_UNICODE));
ok(!str_contains($msg['title'].$msg['body'],'Pamuk'),'Kilit ekranında hassas ayrıntı (hasta adı) görünüyor');
// FCM ayarlanmadığı için atlandı; ayarlandığında geçersiz anahtar kapanır
$c=openssl_pkey_new(['private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA]); openssl_pkey_export($c,$pem);
$push->saveSettings((object)['fcmCredential'=>json_encode(['type'=>'service_account','project_id'=>'vz-test','private_key'=>$pem,'client_email'=>'x@vz-test.iam.gserviceaccount.com'])]);
$push2=new AppPush($db,$config);
$push2->transport=function(string $url,array $h,string $body){ return str_contains($url,'oauth2')?[200,'{"access_token":"t","expires_in":3600}']:[404,'{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}']; };
$hub->notify($actor['account_id'],$actor['membership_id'],'dealer','appointments','Yeni randevu','Klinik','/clinic','yeni-1',$now);
$push2->work($now);
ok((int)$db->query("SELECT COUNT(*) FROM app_device WHERE provider='fcm' AND revoked_at IS NULL")->fetchColumn()===0,'Geçersiz FCM anahtarı kapatılmadı');
// Okundu, temizle, rozet
$ids=array_column($hub->inbox($actor,null,null,false)['items'],'id');
ok($hub->mark($actor,(object)['action'=>'read','ids'=>[$ids[0]]],$now)['unread']===count($ids)-1,'Okundu işareti çalışmadı');
ok($hub->mark($actor,(object)['action'=>'clearAll'],$now)['unread']===0 && !$hub->inbox($actor,null,null,false)['items'],'Toplu temizleme çalışmadı');
// Politika: rol kapatılınca bildirim üretilmez; kritik kapatılamaz
$hub->manage((object)['action'=>'policy','category'=>'stock','role'=>'dealer','enabled'=>false],$now);
ok(!$hub->notify($actor['account_id'],$actor['membership_id'],'dealer','stock','Kritik stok','','/clinic','s-9',$now),'Kapatılan kategori bildirim üretti');
try { $hub->manage((object)['action'=>'policy','category'=>'security','role'=>'dealer','enabled'=>false],$now); ok(false,'Kritik kategori kapatıldı'); } catch (RuntimeException $e) { ok($e->getCode()===422,'Yanlış hata'); }
// Duyuru, sürüm, hata
ok($hub->announce((object)['title'=>'Bakım','body'=>'Pazar 02:00','roles'=>['dealer']],$now)===1,'Duyuru gitmedi');
$hub->manage((object)['action'=>'release','platform'=>'android','version'=>'1.2.0','build'=>12,'minBuild'=>10,'publish'=>true],$now);
$rel=$hub->release('android',9);
ok($rel['update'] && $rel['required'] && !$hub->release('android',12)['update'],'Sürüm denetimi yanlış');
$hub->error($actor,(object)['platform'=>'android','message'=>'TypeError: x','version'=>'1.2.0'],'sessdev1',$now);
$hub->error($actor,(object)['platform'=>'android','message'=>'TypeError: x','version'=>'1.2.0'],'sessdev1',$now);
ok((int)$db->query('SELECT count FROM app_error')->fetchColumn()===2,'Hata kaydı tekilleşmedi');
// Hesap silme: yeniden doğrulama olmadan reddedilir, sonra işlenir
$old=$actor; $old['reauth_at']=$now-1000;
try { $hub->deletion($old,$now,true); ok(false,'Doğrulamasız silme talebi alındı'); } catch (RuntimeException $e) {}
$actor['reauth_at']=$now; $hub->deletion($actor,$now,true);
$hub->manage((object)['action'=>'deletion','account'=>$actor['account_id'],'decision'=>'done'],$now);
ok((int)$db->query("SELECT blocked FROM identity_account WHERE id=".$db->quote($actor['account_id']))->fetchColumn()===1,'Hesap kapatılmadı');
ok((int)$db->query("SELECT COUNT(*) FROM identity_session")->fetchColumn()===0 && (int)$db->query("SELECT COUNT(*) FROM app_device")->fetchColumn()===0,'Oturum/cihaz silinmedi');
// Uygulama bağlantıları: parmak izi yokken boş, girilince Android App Links dosyası; iOS dosyası ekip kimliğiyle
ok((new AppPush($db,$config))->wellKnown('assetlinks.json')===[],'Parmak izi yokken assetlinks dolu');
(new AppPush($db,$config))->saveSettings((object)['androidSha256'=>implode(':',array_fill(0,32,'AB')),'apnsTeamId'=>'TEAM123456','apnsTopic'=>'com.vetzimo.app']);
$al=(new AppPush($db,$config))->wellKnown('assetlinks.json');
ok($al[0]['target']['package_name']==='com.vetzimo.app' && strlen($al[0]['target']['sha256_cert_fingerprints'][0])===95,'assetlinks yanlış');
ok((new AppPush($db,$config))->wellKnown('apple-app-site-association')['applinks']['details'][0]['appIDs'][0]==='TEAM123456.com.vetzimo.app','AASA yanlış');
try { (new AppPush($db,$config))->saveSettings((object)['androidSha256'=>'kotu']); ok(false,'Geçersiz parmak izi kabul edildi'); } catch (RuntimeException $e) {}
echo "PASS uygulama merkezi: olay→bildirim (bir kez), gizlilik, sessize alma, rozet, Web Push RFC 8291 + VAPID, FCM geçersiz anahtar, politika, sürüm, hata, hesap silme\n";
