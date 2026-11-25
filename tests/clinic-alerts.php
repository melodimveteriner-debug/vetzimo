<?php
declare(strict_types=1);
// Klinik uyarıları: KVKK kararı ve sorunlu e-belge işi listelenir, tamamlandı denen uyarı kalkar, çözülen iş kendiliğinden düşer,
// özelliği kapalı personel ilgili uyarıyı görmez.
use VetNet\Cpanel\{Database,Installer,DealerLogin,IdentityApi,ClinicAlerts};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Uyari Test','05551000166','uyari@example.test','Uyari-test-secret-42');
$now=time();
$l=(new DealerLogin($db,str_repeat('u',32)))->signIn('05551000166','Uyari-test-secret-42','192.0.2.166',$now);
$actor=(new IdentityApi($db))->actor([VetNet\Cpanel\SessionRepository::SESSION_COOKIE=>$l['token'],VetNet\Cpanel\SessionRepository::DEVICE_COOKIE=>$l['device']],$now);
$p=$actor['partner_id'];
$db->prepare("INSERT INTO clinic_client_permit(id,partner_id,branch_id,client_id,client_name,phone,expires_at,status,method,doc,doc_hash,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  ->execute([str_repeat('a',32),$p,'merkez','c1','Ayşe Deneme','+905551112233',$now+86400,'declined','link','{}',str_repeat('0',64),$now-300,$now-100]);
$db->prepare("INSERT INTO clinic_bridge_job(id,partner_id,branch_id,kind,record_key,patient_id,payload,status,error,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
  ->execute([str_repeat('b',32),$p,'merkez','earsiv','s1','','{"summary":"e-Arşiv: Test"}','uncertain','koptu','T',$now-600,$now-60]);
$a=new ClinicAlerts($db);
$list=$a->list($actor,$now);
$kinds=array_column($list['items'],'kind');
ok(in_array('permit',$kinds,true) && in_array('job',$kinds,true) && $list['items'][0]['tone']==='danger','Uyarılar eksik veya sırasız: '.json_encode($list));
ok(str_contains(json_encode($list['items'],JSON_UNESCAPED_UNICODE),'reddedildi'),'Ret uyarısı yok');
$permitKey=array_values(array_filter($list['items'],fn($i)=>$i['kind']==='permit'))[0]['key'];
$a->ack($actor,[$permitKey,'kotu-anahtar<script>'],$now);
ok(!in_array('permit',array_column($a->list($actor,$now)['items'],'kind'),true),'Tamamlandı denen uyarı kalmadı değil');
$staff=['role'=>'staff','partner_id'=>$p,'membership_id'=>'staff-1','modules'=>json_encode(['sales'=>'write','clients'=>'write','edocs'=>'none'])];
ok(!in_array('job',array_column($a->list($staff,$now)['items'],'kind'),true),'Özelliği kapalı personel e-belge uyarısı görüyor');
ok(in_array('permit',array_column($a->list($staff,$now)['items'],'kind'),true),'Onaylar kişi bazında değil (başkasının onayı personelden gizledi)');
$db->exec("UPDATE clinic_bridge_job SET status='done' WHERE id='".str_repeat('b',32)."'");
ok(!in_array('job',array_column($a->list($actor,$now)['items'],'kind'),true),'Çözülen iş uyarısı düşmedi');
echo "PASS klinik uyarıları: KVKK kararı ve sorunlu iş, kişi bazında tamamlandı, çözülen iş düşer, özellik izni süzgeci\n";
