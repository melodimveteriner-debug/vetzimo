<?php
declare(strict_types=1);
// Uygulamayı kullananlar: kanal tespiti (Android/iOS/Mac/Windows uygulaması, tarayıcı = portal), giriş sayısı ve son giriş,
// rapor yalnız bayi yöneticisine, indirim doğrulaması (0-100, açmak için >0), eşzamanlı girişlerde sayaç kaybı olmaması.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,AppUsage};
require __DIR__.'/bootstrap.php';
require_once dirname(__DIR__).'/src/AppUsage.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
function fails(callable $f,int $code): bool { try { $f(); return false; } catch (RuntimeException $e) { return $e->getCode()===$code; } }
$dsn=getenv('VETNET_TEST_DSN');
// Eşzamanlı alt süreç: aynı üyeye N giriş kaydı
if (($argv[1] ?? '')==='child') {
    $db=Database::connect($dsn,'root','');
    for ($i=0;$i<(int)$argv[3];$i++) AppUsage::record($db,$argv[2],'Mozilla/5.0 (Linux; Android 14) VetZimoApp/1.0 (Android)',time(),true);
    exit(0);
}
$db=Database::connect($dsn,'root','');
(new Installer($db,dirname(__DIR__)))->install('Kullanım Test','05551000188','usage@example.test','Usage-test-secret-4242');
$now=time();
$l=(new DealerLogin($db,str_repeat('u',32)))->signIn('05551000188','Usage-test-secret-4242','192.0.2.188',$now);
$actor=(new IdentityApi($db))->actor([VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$l['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$l['device']],$now);
ok(($actor['role'] ?? '')==='dealer','Bayi oturumu yok');
$p=$actor['partner_id'];

// Kanal tespiti
foreach ([
    'Mozilla/5.0 (Linux; Android 14; wv) VetZimoApp/1.0 (Android)'=>'android',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) VetZimoApp/1.0 (iOS)'=>'ios',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) VetZimo/1.0 Electron/30.0'=>'macos',
    'Mozilla/5.0 (Windows NT 10.0; Win64) VetZimo/1.0 Electron/30.0'=>'windows',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1'=>'web',
    'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36'=>'web',
    ''=>'web',
] as $ua=>$want) ok(AppUsage::channel($ua)===$want,"Kanal yanlış: $ua → ".AppUsage::channel($ua));

// Tablo yokken kayıt kendi kendine tabloyu kurar, hata atmaz
$db->exec('DROP TABLE IF EXISTS identity_access_stat');
AppUsage::record($db,'yok-uye','x',$now,true);
ok((int)$db->query("SELECT COUNT(*) FROM identity_access_stat")->fetchColumn()===1,'Tablo kendiliğinden kurulmadı');
$db->exec("DELETE FROM identity_access_stat");

// 4 hasta sahibi + 1 personel
$mk=function(string $id,string $role,string $client) use ($db,$p,$now){
    $db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES (?,'phone',?,'x',?)")->execute(['acc-'.$id,'+9055570'.substr(md5($id),0,5),$now]);
    $db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,branch_id,customer_id,name,modules,status) VALUES (?,?,?,?,?,?,?,'{}','active')")
       ->execute([$id,'acc-'.$id,$p,$role,'merkez',$client,'Üye '.$id]);
};
foreach (['m-and'=>'c1','m-ios'=>'c2','m-web'=>'c3','m-none'=>'c4'] as $id=>$c) $mk($id,'customer',$c);
$mk('m-staff','staff','');
$R=fn($m,$ua,$t,$login)=>AppUsage::record($db,$m,$ua,$t,$login);
for ($i=0;$i<3;$i++) $R('m-and','VetZimoApp/1.0 (Android)',$now-86400*(3-$i),true);
$R('m-and','VetZimoApp/1.0 (Android)',$now-60,false);               // oturum kullanımı: giriş sayısı artmaz
$R('m-ios','VetZimoApp/1.0 (iOS)',$now-40*86400,true);
$R('m-web','Mozilla/5.0 (iPhone) Safari',$now-3600,true);
$R('m-web','Mozilla/5.0 (iPhone) Safari',$now-7200,true);             // eski zaman damgası son girişi geri almaz
$R('m-staff','VetZimoApp/1.0 (Android)',$now,true);                   // personel rapora girmez

$rep=(new AppUsage($db))->report($actor,$now);
$s=$rep['summary'];
ok($s['accounts']===4 && $s['app']===2 && $s['portalOnly']===1 && $s['never']===1,'Özet yanlış: '.json_encode($s));
ok($s['active30']===2,'30 gün aktif yanlış: '.$s['active30']);
ok($s['channels']['android']===1 && $s['channels']['ios']===1 && $s['channels']['macos']===0,'Kanal sayımı yanlış');
ok($s['portal']===['users'=>1,'logins'=>2,'active30'=>1],'Portal raporu yanlış: '.json_encode($s['portal']));
$by=array_column($rep['members'],null,'id');
ok(!isset($by['m-staff']),'Personel hasta sahibi raporunda');
ok($by['m-and']['logins']===3 && $by['m-and']['lastSeen']===$now-60 && $by['m-and']['lastLogin']===$now-86400,'Android satırı yanlış: '.json_encode($by['m-and']));
ok($by['m-web']['lastLogin']===$now-3600 && !$by['m-web']['app'] && $by['m-web']['portal'],'Portal satırı yanlış');
ok($rep['members'][0]['app'] && $rep['members'][1]['app'] && !$rep['members'][3]['app'],'Sıralama: uygulama kullananlar önce değil');
ok($rep['members'][0]['id']==='m-and','Uygulama kullananlar içinde en son kullanan önce değil');

// İndirim: yalnız bayi, 0-100, açmak için >0; müşteri listesi yalnız uygulama kullananlar
$u=new AppUsage($db);
$staff=['role'=>'staff','partner_id'=>$p];
ok(fails(fn()=>$u->report($staff,$now),403),'Personel raporu gördü');
ok(fails(fn()=>$u->saveDiscount($staff,(object)['enabled'=>true,'percent'=>10],$now),403),'Personel indirimi değiştirdi');
ok(fails(fn()=>$u->saveDiscount($actor,(object)['enabled'=>true,'percent'=>101],$now),422),'%101 kabul edildi');
ok(fails(fn()=>$u->saveDiscount($actor,(object)['enabled'=>true,'percent'=>-1],$now),422),'Eksi yüzde kabul edildi');
ok(fails(fn()=>$u->saveDiscount($actor,(object)['enabled'=>true,'percent'=>0],$now),422),'%0 ile açıldı');
ok(fails(fn()=>$u->saveDiscount($actor,(object)['enabled'=>true,'percent'=>'abc'],$now),422),'Sayı olmayan yüzde kabul edildi');
ok($u->discount($p)===['enabled'=>false,'percent'=>0.0],'Başlangıç indirimi kapalı değil');
ok($u->saveDiscount($actor,(object)['enabled'=>true,'percent'=>12.5],$now)===['enabled'=>true,'percent'=>12.5],'İndirim kaydedilmedi');
ok($u->saveDiscount($actor,(object)['enabled'=>'true','percent'=>5],$now)['enabled']===false,'Metin "true" açık sayıldı');
$cl=$u->appClients($p);sort($cl);
ok($cl===['c1','c2'],'Uygulama müşterileri yanlış: '.json_encode($cl));
ok($u->appClients('baska-bayi')===[],'Başka bayinin müşterileri sızdı');

// Eşzamanlı girişler: 8 süreç × 40 giriş, hiçbir sayaç kaybolmamalı
$procs=[];
for ($k=0;$k<8;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child','m-none','40'],[1=>['pipe','w'],2=>['pipe','w']],$pipes,null,['VETNET_TEST_DSN'=>$dsn]);
foreach ($procs as $pr) ok(proc_close($pr)===0,'Alt süreç hata verdi');
$n=(int)$db->query("SELECT logins FROM identity_access_stat WHERE membership_id='m-none' AND channel='android'")->fetchColumn();
ok($n===320,"Eşzamanlı girişlerde sayaç kaybı: $n/320");
echo "Uygulama kullanımı testleri geçti\n";
