<?php
declare(strict_types=1);
// VetZimo Kullanım Sözleşmesi: bayi aktivasyonu imzasız reddedilir, imzayla açılır; kayıt sürüm, özet, imza, IP içerir.
use VetNet\Cpanel\{Database,Installer,IdentityApi,DealerAgreement};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Sozlesme Test','05551000156','sozlesme@example.test','Sozlesme-test-secret-42');
$now=time();
$partner=$db->query('SELECT id FROM partner_account LIMIT 1')->fetchColumn();
// Yeni bayi (demo) üyeliği ve aktivasyon bağlantısı
$db->prepare("INSERT INTO partner_account(id,code,name,email,active,created_at,updated_at) VALUES ('p-demo','DEMO1','Demo Klinik','demo@example.test',1,'2026-12-01','2026-12-01')")->execute();
$db->prepare("INSERT INTO identity_account(id,kind,identifier) VALUES ('a-demo','phone','+905551000157')")->execute();
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES ('m-demo','a-demo','p-demo','dealer','Demo','{}','pending')")->execute();
$token=bin2hex(random_bytes(32));
$db->prepare('INSERT INTO identity_activation(token_hash,membership_id,expires) VALUES (?,?,?)')->execute([hash('sha256',$token),'m-demo',$now+3600]);
$identity=new IdentityApi($db);
$info=$identity->activationInfo($token,$now);
ok($info['role']==='dealer' && $info['agreementRequired']===true && str_contains($info['agreement']['html'],'Fikri mülkiyet') && strlen($info['agreement']['hash'])===64,'Aktivasyon ön bilgisi eksik');
ok(str_contains($info['agreement']['html'],'6563') && str_contains($info['agreement']['html'],'Yapay zekâ'),'Sözleşme iletiler ve yapay zekâ hükümlerini içermiyor');
$fail=function(object $in,string $m) use ($identity,$now){ try { $identity->redeem($in,$now); } catch (RuntimeException $e) { return $e->getMessage(); } throw new LogicException($m); };
$base=['token'=>$token,'password'=>'Demo-klinik-sifre-42'];
ok(str_contains($fail((object)$base,'İmzasız aktivasyon kabul edildi'),'onaylanmadan'),'İmzasız aktivasyon mesajı yanlış');
ok(str_contains($fail((object)($base+['agreement'=>(object)['accepted'=>false]]),'Reddedilen sözleşmeyle açıldı'),'onaylanmadan'),'Ret mesajı yanlış');
$png='data:image/png;base64,'.base64_encode("\x89PNG\r\n\x1a\n".str_repeat("\0",300));
ok(str_contains($fail((object)($base+['agreement'=>(object)['accepted'=>true,'name'=>'Ayşe','signature'=>$png]]),'Soyadsız imza kabul edildi'),'adını'),'Ad soyad kontrolü yok');
ok(str_contains($fail((object)($base+['agreement'=>(object)['accepted'=>true,'name'=>'Ayşe Yılmaz','signature'=>'data:image/png;base64,AAAA']]),'İmzasız kabul edildi'),'imzalayın'),'İmza kontrolü yok');
ok(str_contains($fail((object)($base+['agreement'=>(object)['accepted'=>true,'name'=>'Ayşe Yılmaz','signature'=>$png,'hash'=>str_repeat('0',64)]]),'Eski metin kabul edildi'),'güncellendi'),'Metin sürüm kontrolü yok');
ok($db->query("SELECT status FROM identity_membership WHERE id='m-demo'")->fetchColumn()==='pending','Başarısız denemeler hesabı açtı');
$identity->redeem((object)($base+['agreement'=>(object)['accepted'=>true,'name'=>'Ayşe Yılmaz','title'=>'Klinik sahibi','signature'=>$png,'hash'=>$info['agreement']['hash']]]),$now);
ok($db->query("SELECT status FROM identity_membership WHERE id='m-demo'")->fetchColumn()==='active','İmzalı aktivasyon hesabı açmadı');
$rec=(new DealerAgreement($db))->records('p-demo');
ok(count($rec)===1 && $rec[0]['signer_name']==='Ayşe Yılmaz' && $rec[0]['text_hash']===$info['agreement']['hash'] && str_starts_with($rec[0]['signature'],'data:image/png'),'İmza kaydı eksik');
ok((new DealerAgreement($db))->signed('p-demo') && !(new DealerAgreement($db))->signed($partner),'İmza durumu yanlış');
echo "PASS VetZimo Kullanım Sözleşmesi: imzasız bayi açılmaz, ret/eksik ad/eksik imza/eski metin reddedilir, imza kaydı delil bilgileriyle saklanır\n";
