<?php
declare(strict_types=1);
// Aile fotoğrafları: en fazla 3 (eşzamanlı yüklemede de), doğrulama, onay yetkisi, şube ayrımı, web sitesi görünürlüğü
// (yalnız onaylı + paylaşım izinli), gizli fotoğrafın herkese kapalı olması, hasta sahibinin yalnız kendi fotoğrafını görmesi.
use VetNet\Cpanel\{Database,Installer,FamilyPhotos};
require __DIR__.'/bootstrap.php';
require_once dirname(__DIR__).'/src/FamilyPhotos.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
function fails(callable $f,int $code): bool { try { $f(); return false; } catch (RuntimeException $e) { return $e->getCode()===$code; } }
$dsn=getenv('VETNET_TEST_DSN');
function jpeg(int $seed): string { $im=imagecreatetruecolor(400,300); imagefill($im,0,0,imagecolorallocate($im,$seed%255,120,200)); ob_start(); imagejpeg($im,null,80); return 'data:image/jpeg;base64,'.base64_encode((string)ob_get_clean()); }
$customer=fn(string $m,string $partner,string $branch='merkez',string $client='c1')=>['role'=>'customer','membership_id'=>$m,'partner_id'=>$partner,'branch_id'=>$branch,'customer_id'=>$client,'name'=>'Sahip'];
if (($argv[1] ?? '')==='child') {
    $db=Database::connect($dsn,'root','');
    try { (new FamilyPhotos($db))->upload($customer('m-conc',$argv[2],'merkez','c3'),(object)['surname'=>'Eş','caption'=>'x','publish'=>true,'image'=>jpeg((int)$argv[3])],time()); echo 'ok'; }
    catch (RuntimeException $e) { echo $e->getCode(); }
    exit(0);
}
$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('Aile Test','05551000211','aile@example.test','Aile-test-secret-4242');
$p=(string)$db->query("SELECT id FROM partner_account LIMIT 1")->fetchColumn();
$now=time();$f=new FamilyPhotos($db);
foreach (['m-1','m-2','m-conc'] as $k=>$m) {
    $db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES (?,'phone',?,'x',?)")->execute(['acc-'.$m,'+9055570099'.$k,$now]);
    $db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status) VALUES (?,?,?,'customer','merkez',?,'Sahip','{}','active')")->execute([$m,'acc-'.$m,$p,['m-1'=>'c1','m-2'=>'c2','m-conc'=>'c3'][$m]]);
}
$owner=$customer('m-1',$p);
$dealer=['role'=>'dealer','partner_id'=>$p,'membership_id'=>'d','branch_id'=>'','name'=>'Bayi'];
$staffRead=['role'=>'staff','partner_id'=>$p,'membership_id'=>'s','branch_id'=>'merkez','name'=>'Personel','modules'=>json_encode(['clients'=>'read'])];
$otherBranch=['role'=>'branch','partner_id'=>$p,'membership_id'=>'b','branch_id'=>'sube2','name'=>'Şube','modules'=>json_encode(['clients'=>'write'])];

// Doğrulama
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'','publish'=>true,'image'=>jpeg(1)],$now),422),'Boş soyadı kabul edildi');
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'Yılmaz123','publish'=>true,'image'=>jpeg(1)],$now),422),'Rakamlı soyadı kabul edildi');
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'Yılmaz','image'=>jpeg(1)],$now),422),'Paylaşım sorusu yanıtsız kabul edildi');
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'Yılmaz','publish'=>true,'image'=>'data:image/svg+xml;base64,PHN2Zz4='],$now),422),'SVG kabul edildi');
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'Yılmaz','publish'=>true,'image'=>'data:image/jpeg;base64,'.base64_encode(str_repeat('x',5000))],$now),422),'Sahte JPEG kabul edildi');
ok(fails(fn()=>$f->upload($dealer,(object)['surname'=>'Yılmaz','publish'=>true,'image'=>jpeg(1)],$now),403),'Bayi hasta sahibi adına yükledi');

// 3 sınırı
$f->upload($owner,(object)['surname'=>'yılmaz','caption'=>'Ayşe ve Pamuk','publish'=>true,'image'=>jpeg(1)],$now);
$f->upload($owner,(object)['surname'=>'Yılmaz','caption'=>'Ali','publish'=>false,'image'=>jpeg(2)],$now);
$list=$f->upload($owner,(object)['surname'=>'Yılmaz','caption'=>'Hep birlikte','publish'=>true,'image'=>jpeg(3)],$now);
ok(count($list['items'])===3 && $list['items'][0]['family']==='Yılmaz Ailesi','Liste/aile adı yanlış: '.json_encode($list['items'][0]['family']));
ok(fails(fn()=>$f->upload($owner,(object)['surname'=>'Yılmaz','publish'=>true,'image'=>jpeg(4)],$now),422),'4. fotoğraf kabul edildi');
[$public,$hidden]=[array_values(array_filter($list['items'],fn($r)=>$r['publish']))[0],array_values(array_filter($list['items'],fn($r)=>!$r['publish']))[0]];

// Görünürlük: onay öncesi kimseye açık değil; hasta sahibi kendi fotoğrafını görür, başka hasta sahibi göremez
ok($f->image($public['id'],null)===null,'Onaysız fotoğraf herkese açık');
ok($f->image($public['id'],$owner)!==null,'Hasta sahibi kendi fotoğrafını göremedi');
ok($f->image($public['id'],$customer('m-2',$p,'merkez','c2'))===null,'Başka hasta sahibi fotoğrafı gördü');
ok($f->publicFamilies($p)===[],'Onaysız fotoğraf web sitesinde');
ok(count($f->list($customer('m-2',$p,'merkez','c2'),[])['items'])===0,'Başka hasta sahibinin listesi dolu');

// Onay: yalnız yazma yetkili ekip; başka şube göremez/onaylayamaz
ok(fails(fn()=>$f->decide($staffRead,$public['id'],true,$now),403),'Yalnız okuma yetkili personel onayladı');
ok(fails(fn()=>$f->decide($owner,$public['id'],true,$now),403),'Hasta sahibi kendi fotoğrafını onayladı');
ok(fails(fn()=>$f->decide($otherBranch,$public['id'],true,$now),404),'Başka şube onayladı');
ok(count($f->list($dealer,[])['items'])===3,'Bayi bekleyenleri göremiyor');
ok(count($f->list($otherBranch,[])['items'])===0,'Başka şube bekleyenleri gördü');
ok(count($f->pendingAlerts($dealer))===3,'Uyarı sayısı yanlış');
foreach ($list['items'] as $r) $f->decide($dealer,$r['id'],true,$now);
ok(count($f->pendingAlerts($dealer))===0,'Onaydan sonra uyarı kalmadı değil');

// Web sitesi: yalnız onaylı + izinli; gizli fotoğraf dışarıya kapalı ama klinik ve sahibi görür
$fam=$f->publicFamilies($p);
ok(count($fam)===1 && count($fam[0]['photos'])===2 && $fam[0]['family']==='Yılmaz Ailesi','Web sitesi ailesi yanlış: '.json_encode($fam));
ok($f->image($public['id'],null,$p)!==null && $f->image($public['id'],null,$p)[2]===true,'Onaylı izinli fotoğraf sitede açılmıyor');
ok($f->image($hidden['id'],null,$p)===null && $f->image($hidden['id'],null)===null,'Gizli fotoğraf herkese açık');
ok($f->image($hidden['id'],$dealer)!==null && $f->image($hidden['id'],$owner)!==null,'Gizli fotoğrafı klinik/sahibi göremiyor');
ok($f->image($public['id'],null,'baska-bayi')===null,'Başka bayinin sitesinden fotoğraf açıldı');

// Silme: hasta sahibi yalnız kendi; başkası 404
ok(fails(fn()=>$f->delete($customer('m-2',$p,'merkez','c2'),$hidden['id']),404),'Başkasının fotoğrafı silindi');
$f->delete($owner,$hidden['id']);
ok(count($f->list($owner,[])['items'])===2,'Silinmedi');

// Eşzamanlı: 6 süreç aynı anda yükler → en fazla 3
$procs=[];
for ($k=0;$k<6;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child',$p,(string)$k],[1=>['pipe','w'],2=>['pipe','w']],$pipes[$k],null,['VETNET_TEST_DSN'=>$dsn]);
$out=[];foreach ($procs as $k=>$pr) { $out[]=stream_get_contents($pipes[$k][1]); proc_close($pr); }
$n=(int)$db->query("SELECT COUNT(*) FROM clinic_family_photo WHERE membership_id='m-conc'")->fetchColumn();
ok($n===3,"Eşzamanlı yüklemede sınır aşıldı: $n (".implode(',',$out).')');
echo "Aile fotoğrafları testleri geçti\n";
