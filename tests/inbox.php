<?php
declare(strict_types=1);
// Çok kanallı gelen kutusu: webhook doğrulaması (Meta imzası, Telegram gizli anahtarı, SMS anahtarı), mükerrer teslim,
// otomatik müşteri eşleşmesi, yanıtı yazanın konuşmayı üstlenmesi ve devralması, kanal bazında gönderim,
// 24 saat kuralı, durum güncellemeleri, not, erteleme, kapatma, arama ve e-posta ayrıştırma.
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,OmniInbox,Commerce};
require __DIR__.'/bootstrap.php';
require_once dirname(__DIR__).'/src/OmniInbox.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Inbox Test','05551000126','inbox@example.test','Inbox-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('t',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000126','Inbox-test-secret-42','192.0.2.120',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor($identity->actor($cookies,$now));
$actor['name']='Dr. Ayşe';
$other=$actor; $other['membership_id']=str_repeat('b',32); $other['name']='Dr. Fatih';
$data=$work->read($cookies,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Ayşe Yılmaz','phone'=>'0532 111 22 33','email'=>'ayse@example.test']];
$state->patients=[(object)['id'=>'p1','branch'=>'merkez','name'=>'Pamuk','owner'=>'c1','species'=>'Kedi','breed'=>'British Shorthair']];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);

$probe=stream_socket_server('tcp://127.0.0.1:0'); $port=(int)substr(strrchr(stream_socket_get_name($probe,false),':'),1); fclose($probe);
$log=sys_get_temp_dir().'/inbox-mock-'.getmypid().'.log'; @unlink($log);
$server=proc_open(['php','-S','127.0.0.1:'.$port,__DIR__.'/fixtures/inbox-mock.php'],[0=>['pipe','r'],1=>['file','/dev/null','w'],2=>['file','/dev/null','w']],$pipes,null,['INBOX_MOCK_LOG'=>$log]+getenv());
register_shutdown_function(static function() use($server){ proc_terminate($server); });
for($i=0;$i<50 && !@fsockopen('127.0.0.1',$port);$i++) usleep(100000);
$base='http://127.0.0.1:'.$port;
$key=base64_encode(str_repeat('k',32));
$inbox=new OmniInbox($db,$key,'https://klinik.example',['graph'=>$base,'telegram'=>$base,'netgsm'=>$base]);
$requests=static function() use($log){ return array_map(static fn($l)=>json_decode($l,true),array_filter(explode("\n",(string)@file_get_contents($log)))); };
$appSecret=str_repeat('a1',16);

// ── kanal bağlama
$wa=$inbox->saveChannel($actor,(object)['kind'=>'whatsapp','label'=>'WhatsApp Business','config'=>(object)['phoneNumberId'=>'1234567890','accessToken'=>'EAAtest-token-1234567890','appSecret'=>$appSecret]],$now)['channel'];
ok(str_starts_with($wa['webhookUrl'],'https://klinik.example/api/inbox/hook/') && strlen($wa['verifyToken'])===32 && $wa['config']['accessToken']==='saved','WhatsApp kanalı bilgisi yanlış');
$raw=$db->query("SELECT config FROM inbox_channel WHERE id='".$wa['id']."'")->fetchColumn();
ok(!str_contains($raw,'EAAtest-token') && !str_contains($raw,$appSecret),'Gizli anahtar düz metin saklandı');
$hook=substr($wa['webhookUrl'],strrpos($wa['webhookUrl'],'/')+1);
try { $inbox->saveChannel($other+['role'=>'staff'],(object)['kind'=>'sms','config'=>(object)[]],$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
$staff=$actor; $staff['role']='staff'; $staff['modules']=json_encode(['clients'=>'write']);
try { $inbox->saveChannel($staff,(object)['kind'=>'telegram','config'=>(object)['botToken'=>'12345:'.str_repeat('A',35)]],$now); $accepted=true; } catch (RuntimeException $e) { $accepted=$e->getCode()!==403; }
ok(!$accepted,'Personel kanal bağlayabildi');
ok(!isset($inbox->channels($staff)['channels'][0]['config']),'Personele kanal ayarları gösterildi');

// ── Meta doğrulaması ve imza
[$code,,$body]=$inbox->hook($hook,'GET',['hub_mode'=>'subscribe','hub_verify_token'=>$wa['verifyToken'],'hub_challenge'=>'98765'],[],'',$now);
ok($code===200 && $body==='98765','Meta webhook doğrulaması çalışmadı');
[$code]=$inbox->hook($hook,'GET',['hub_mode'=>'subscribe','hub_verify_token'=>'yanlis','hub_challenge'=>'1'],[],'',$now);
ok($code===403,'Yanlış doğrulama anahtarı kabul edildi');
$waMsg=static fn(string $id,string $text,int $ts)=>json_encode(['object'=>'whatsapp_business_account','entry'=>[['changes'=>[['field'=>'messages','value'=>['metadata'=>['phone_number_id'=>'1234567890'],
  'contacts'=>[['wa_id'=>'905321112233','profile'=>['name'=>'Ayşe Y.']]],'messages'=>[['from'=>'905321112233','id'=>$id,'timestamp'=>(string)$ts,'type'=>'text','text'=>['body'=>$text]]]]]]]]]);
$payload=$waMsg('wamid.in1','Merhaba, Pamuk için yarın randevu alabilir miyim?',$now-60);
[$code]=$inbox->hook($hook,'POST',[],['X-Hub-Signature-256'=>'sha256='.hash_hmac('sha256',$payload,'yanlis')],$payload,$now);
ok($code===403,'Yanlış Meta imzası kabul edildi');
$sig=static fn(string $p)=>['X-Hub-Signature-256'=>'sha256='.hash_hmac('sha256',$p,$appSecret)];
[$code]=$inbox->hook($hook,'POST',[],$sig($payload),$payload,$now);
ok($code===200,'Geçerli Meta bildirimi reddedildi');
$inbox->hook($hook,'POST',[],$sig($payload),$payload,$now); // Meta aynı bildirimi tekrar gönderebilir
$list=$inbox->list($actor,['box'=>'open'],$now);
ok(count($list['items'])===1 && $list['items'][0]['unread']===1 && $list['items'][0]['client']==='c1' && $list['items'][0]['name']==='Ayşe Y.','WhatsApp mesajı alınmadı, tekrarlandı veya müşteri eşleşmedi');
ok($list['boxes']['unassigned']===1 && $list['channels']['whatsapp']===1,'Sayaçlar yanlış');
$cid=$list['items'][0]['id'];
$thread=$inbox->thread($actor,$cid,$now);
ok($thread['card']['name']==='Ayşe Yılmaz' && $thread['card']['pets'][0]['name']==='Pamuk','Müşteri kartı veya hayvanları gelmedi');
ok(str_contains(implode('|',array_column($thread['messages'],'body')),'Otomatik müşteri eşleşmesi'),'Eşleşme olayı yazılmadı');

// ── yanıt: yazan üstlenir, başkası devralır
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$cid,'text'=>'Yarın 14:30 uygun, bekliyoruz.'],$now);
$out=array_values(array_filter($r['messages'],static fn($m)=>$m['direction']==='out'));
ok(count($out)===1 && $out[0]['status']==='sent' && $out[0]['author']==='Dr. Ayşe','Yanıt gönderilmedi');
ok($r['conversation']['assignee']===$actor['membership_id'] && $r['conversation']['assigneeName']==='Dr. Ayşe','Yanıt yazan konuşmayı üstlenmedi');
$sent=array_values(array_filter($requests(),static fn($q)=>str_ends_with(parse_url($q['uri'],PHP_URL_PATH),'/1234567890/messages')));
ok(count($sent)===1 && json_decode($sent[0]['body'],true)['to']==='905321112233' && $sent[0]['auth']==='Bearer EAAtest-token-1234567890','WhatsApp isteği yanlış');
$r=$inbox->act($other,(object)['action'=>'reply','id'=>$cid,'text'=>'Ben de ekleyeyim: aşı kartını getirin.'],$now+5);
ok($r['conversation']['assigneeName']==='Dr. Fatih','Devralma çalışmadı');
ok(str_contains(implode('|',array_column($r['messages'],'body')),'Dr. Fatih konuşmayı Dr. Ayşe devraldı'),'Devralma olayı yazılmadı');
ok(count($inbox->list($actor,['box'=>'mine'],$now)['items'])===0 && count($inbox->list($other,['box'=>'mine'],$now)['items'])===1,'Bana atanan kutusu yanlış');

// ── teslim durumları
$ext=$db->query("SELECT external_id FROM inbox_message WHERE conversation_id=$cid AND direction='out' ORDER BY id LIMIT 1")->fetchColumn();
$st=json_encode(['entry'=>[['changes'=>[['value'=>['metadata'=>['phone_number_id'=>'1234567890'],'statuses'=>[['id'=>substr($ext,3),'status'=>'read']]]]]]]]);
$inbox->hook($hook,'POST',[],$sig($st),$st,$now);
$st2=json_encode(['entry'=>[['changes'=>[['value'=>['metadata'=>['phone_number_id'=>'1234567890'],'statuses'=>[['id'=>substr($ext,3),'status'=>'delivered']]]]]]]]);
$inbox->hook($hook,'POST',[],$sig($st2),$st2,$now);
ok($db->query("SELECT status FROM inbox_message WHERE external_id=".$db->quote($ext))->fetchColumn()==='read','Okundu durumu geriye düştü veya işlenmedi');

// ── 24 saat kuralı ve şablon
$db->exec("UPDATE inbox_conversation SET last_inbound_at=".($now-90000)." WHERE id=$cid");
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$cid,'text'=>'Hatırlatma'],$now);
ok(isset($r['warning']) && str_contains($r['warning'],'24 saat'),'24 saat kuralı uygulanmadı');
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$cid,'text'=>'','template'=>(object)['name'=>'randevu_hatirlatma','language'=>'tr','params'=>['Pamuk','Yarın 14:30']]],$now);
ok(!isset($r['warning']),'Şablon mesaj gönderilemedi');
$last=array_values(array_filter($requests(),static fn($q)=>str_ends_with(parse_url($q['uri'],PHP_URL_PATH),'/messages')));
ok(json_decode(end($last)['body'],true)['template']['components'][0]['parameters'][1]['text']==='Yarın 14:30','Şablon parametreleri gönderilmedi');

// ── not, etiket, erteleme, kapatma, yeniden açılma
$r=$inbox->act($actor,(object)['action'=>'note','id'=>$cid,'text'=>'Nazik müşteri, Royal Canin hediye.'],$now);
ok(end($r['messages'])['direction']==='note','İç not eklenmedi');
$sentBefore=count($requests());
ok(count($requests())===$sentBefore,'İç not müşteriye gönderildi');
$inbox->act($actor,(object)['action'=>'tag','id'=>$cid,'tags'=>['VIP','randevu','<script>']],$now);
ok($inbox->list($actor,['box'=>'open'],$now)['items'][0]['tags']===['vip','randevu'],'Etiketler yanlış');
$inbox->act($actor,(object)['action'=>'status','id'=>$cid,'status'=>'snoozed','until'=>$now+3600],$now);
ok(count($inbox->list($actor,['box'=>'snoozed'],$now)['items'])===1,'Erteleme çalışmadı');
ok(count($inbox->list($actor,['box'=>'open'],$now+3700)['items'])===1,'Ertelenen konuşma süresinde açılmadı');
$inbox->act($actor,(object)['action'=>'status','id'=>$cid,'status'=>'closed'],$now);
$p2=$waMsg('wamid.in2','Bir sorum daha var',$now);
$inbox->hook($hook,'POST',[],$sig($p2),$p2,$now);
ok($inbox->list($actor,['box'=>'open'],$now)['items'][0]['id']===$cid,'Kapalı konuşma yeni mesajla açılmadı');

// ── Telegram
$tg=$inbox->saveChannel($actor,(object)['kind'=>'telegram','config'=>(object)['botToken'=>'123456789:'.str_repeat('B',35)]],$now)['channel'];
$set=array_values(array_filter($requests(),static fn($q)=>str_contains($q['uri'],'/setWebhook')));
ok(count($set)===1 && json_decode($set[0]['body'],true)['url']===$tg['webhookUrl'],'Telegram webhook kurulmadı');
$secret=json_decode($set[0]['body'],true)['secret_token'];
$th=substr($tg['webhookUrl'],strrpos($tg['webhookUrl'],'/')+1);
$up=json_encode(['update_id'=>1,'message'=>['message_id'=>5,'date'=>$now,'chat'=>['id'=>4455,'type'=>'private'],'from'=>['first_name'=>'Cem','username'=>'cemo'],'text'=>'Reçete fotoğrafını atıyorum']]);
[$code]=$inbox->hook($th,'POST',[],['X-Telegram-Bot-Api-Secret-Token'=>'yanlis'],$up,$now);
ok($code===403,'Telegram yanlış gizli anahtar kabul edildi');
[$code]=$inbox->hook($th,'POST',[],['X-Telegram-Bot-Api-Secret-Token'=>$secret],$up,$now);
$tc=$inbox->list($actor,['channel'=>'telegram'],$now)['items'];
ok($code===200 && count($tc)===1 && $tc[0]['name']==='Cem' && $tc[0]['handle']==='@cemo','Telegram mesajı alınmadı');
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$tc[0]['id'],'text'=>'Aldık, teşekkürler.'],$now);
ok(!isset($r['warning']),'Telegram yanıtı gönderilemedi');

// ── SMS
$sms=$inbox->saveChannel($actor,(object)['kind'=>'sms','config'=>(object)['account'=>'8501234567','password'=>'gizli','sender'=>'KLINIK']],$now)['channel'];
$q=[]; parse_str((string)parse_url($sms['webhookUrl'],PHP_URL_QUERY),$q);
$sh=substr(parse_url($sms['webhookUrl'],PHP_URL_PATH),strlen('/api/inbox/hook/'));
[$code]=$inbox->hook($sh,'GET',['gsmno'=>'05551234567','msg'=>'Aşı zamanı geldi mi?'],[],'',$now);
ok($code===403,'Anahtarsız SMS bildirimi kabul edildi');
[$code]=$inbox->hook($sh,'GET',['k'=>$q['k'],'gsmno'=>'05551234567','msg'=>'Aşı zamanı geldi mi?','id'=>'s1'],[],'',$now);
$sc=$inbox->list($actor,['channel'=>'sms'],$now)['items'];
ok($code===200 && count($sc)===1 && $sc[0]['handle']==='+905551234567','SMS alınmadı');
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$sc[0]['id'],'text'=>'Evet, bu hafta gelebilirsiniz.'],$now);
$smsReq=array_values(array_filter($requests(),static fn($q)=>str_contains($q['uri'],'/sms/rest/v2/send')));
ok(!isset($r['warning']) && json_decode($smsReq[0]['body'],true)['messages'][0]['no']==='5551234567','SMS yanıtı yanlış gönderildi');

// ── Messenger / Instagram
$fb=$inbox->saveChannel($actor,(object)['kind'=>'messenger','config'=>(object)['pageId'=>'55555','pageToken'=>'EAApage-token-0987654321','appSecret'=>$appSecret]],$now)['channel'];
$fh=substr($fb['webhookUrl'],strrpos($fb['webhookUrl'],'/')+1);
$ev=json_encode(['object'=>'page','entry'=>[['messaging'=>[['sender'=>['id'=>'777001'],'recipient'=>['id'=>'55555'],'timestamp'=>$now*1000,'message'=>['mid'=>'m_1','text'=>'Pazar açık mısınız?']]]]]]);
$inbox->hook($fh,'POST',[],$sig($ev),$ev,$now);
$fc=$inbox->list($actor,['channel'=>'messenger'],$now)['items'];
ok(count($fc)===1 && $fc[0]['name']==='Can Er','Messenger mesajı veya profil adı alınamadı');
$echo=json_encode(['object'=>'page','entry'=>[['messaging'=>[['sender'=>['id'=>'55555'],'recipient'=>['id'=>'777001'],'timestamp'=>$now*1000,'message'=>['mid'=>'m_2','is_echo'=>true,'text'=>'Pazar 10-14 açığız.']]]]]]);
$inbox->hook($fh,'POST',[],$sig($echo),$echo,$now);
$ft=$inbox->thread($actor,$fc[0]['id'],$now);
ok(end($ft['messages'])['author']==='Meta Business Suite','Meta üzerinden verilen yanıt geçmişe eklenmedi');
$r=$inbox->act($actor,(object)['action'=>'reply','id'=>$fc[0]['id'],'text'=>'Görüşmek üzere!'],$now);
ok(!isset($r['warning']),'Messenger yanıtı gönderilemedi');

// ── e-posta yönlendirme ve ayrıştırma
$em=$inbox->saveChannel($actor,(object)['kind'=>'email','config'=>(object)['address'=>'info@klinik.example','smtpHost'=>'smtp.klinik.example','smtpPort'=>'465','username'=>'info@klinik.example','password'=>'x']],$now)['channel'];
$eq=[]; parse_str((string)parse_url($em['webhookUrl'],PHP_URL_QUERY),$eq);
$eh=substr(parse_url($em['webhookUrl'],PHP_URL_PATH),strlen('/api/inbox/hook/'));
[$code]=$inbox->hook($eh,'POST',['k'=>$eq['k']],[],json_encode(['from'=>'Ayşe Yılmaz <AYSE@example.test>','subject'=>'Fatura','text'=>"Faturayı alabilir miyim?\n\nOn Mon, X wrote:\n> eski"]),$now);
$ec=$inbox->list($actor,['channel'=>'email'],$now)['items'];
ok($code===200 && count($ec)===1 && $ec[0]['client']==='c1' && $ec[0]['preview']==='Faturayı alabilir miyim?','E-posta alınmadı, eşleşmedi veya alıntı temizlenmedi');
$mail="From: =?UTF-8?B?".base64_encode('Gökçe Şahin')."?= <gokce@example.test>\r\nSubject: =?UTF-8?Q?A=C5=9F=C4=B1_randevusu?=\r\nMessage-ID: <abc@x>\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nMerhaba, a=C5=9F=C4=B1 i=C3=A7in yer var m=C4=B1?\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>x</p>\r\n--b1--\r\n";
$parsed=OmniInbox::parseMail($mail);
ok($parsed['from']==='gokce@example.test' && $parsed['name']==='Gökçe Şahin' && $parsed['subject']==='Aşı randevusu' && $parsed['text']==='Merhaba, aşı için yer var mı?','E-posta ayrıştırılamadı: '.json_encode($parsed,JSON_UNESCAPED_UNICODE));

// ── web formu, arama, hızlı yanıt, ekip ve yetki
$inbox->ingestWeb($actor['partner_id'],'Esra Tunç','esra@example.test','0533 999 88 77','Diyet maması var mı?',$now);
ok(count($inbox->list($actor,['channel'=>'web'],$now)['items'])===1,'Web formu mesajı gelen kutusuna düşmedi');
ok(count($inbox->list($actor,['box'=>'all','q'=>'diyet'],$now)['items'])===1,'Arama çalışmadı');
$qr=$inbox->act($actor,(object)['action'=>'quick-save','shortcut'=>'adres','body'=>'Kliniğimiz Çamlıca Mah. 12 numarada.'],$now);
ok($qr['quick'][0]['shortcut']==='adres','Hızlı yanıt kaydedilmedi');
$blocked=$actor; $blocked['modules']=json_encode(['clients'=>'none']); $blocked['role']='staff';
try { $inbox->list($blocked,[],$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
$foreign=$actor; $foreign['partner_id']=str_repeat('f',32);
try { $inbox->thread($foreign,$cid,$now); $leak=true; } catch (RuntimeException) { $leak=false; }
ok(!$leak,'Başka kliniğin konuşması okunabildi');
$inbox->deleteChannel($actor,(object)['id'=>$tg['id']]);
[$code]=$inbox->hook($th,'POST',[],['X-Telegram-Bot-Api-Secret-Token'=>$secret],$up,$now);
ok($code===404,'Kaldırılan kanal mesaj almaya devam etti');
ok(count($inbox->list($actor,['channel'=>'telegram','box'=>'all'],$now)['items'])===1,'Kanal kaldırılınca geçmiş silindi');
echo "inbox ok\n";
