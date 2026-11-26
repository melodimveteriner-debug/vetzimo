<?php
declare(strict_types=1);
// Klinik Rehberi yalnız ücretli ve bugün geçerli paketteki klinik ekibine açılır: deneme, Ücretsiz paket,
// süresi dolmuş dönem, hasta sahibi ve oturumsuz istek içerik alamaz; içerik dosyası geçerli ve medya eksiksizdir.
use VetNet\Cpanel\{Database,Installer,ClinicGuide};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Rehber Test','05551000177','rehber@example.test','Rehber-test-secret-42');
$partner=(string)$db->query('SELECT id FROM partner_account LIMIT 1')->fetchColumn();
ok($partner!=='','Bayi oluşmadı');
$g=new ClinicGuide($db,dirname(__DIR__).'/guide');
$dealer=['role'=>'dealer','partner_id'=>$partner];
$sub=function(string $plan,string $kind,string $from,string $to) use($db,$partner): void {
  $db->prepare('DELETE FROM clinic_subscription WHERE partner_id=?')->execute([$partner]);
  $db->prepare('INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,?,?,?)')->execute([$partner,$plan,$plan,$kind,$from,$to]);
};
$today=(new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')));
$a=$today->modify('-10 days')->format('Y-m-d'); $b=$today->modify('+10 days')->format('Y-m-d');
$sub('pro','trial',$a,$b); ok(!$g->allowed($dealer),'Deneme (demo) rehberi gördü');
$sub('ucretsiz','assigned',$a,$b); ok(!$g->allowed($dealer),'Ücretsiz paket rehberi gördü');
$sub('pro','paid',$today->modify('-40 days')->format('Y-m-d'),$today->modify('-1 day')->format('Y-m-d')); ok(!$g->allowed($dealer),'Süresi dolan paket rehberi gördü');
$sub('pro','paid',$a,$b);
ok($g->allowed($dealer) && $g->allowed(['role'=>'staff','partner_id'=>$partner]) && $g->allowed(['role'=>'branch','partner_id'=>$partner]),'Ücretli paket ekibi rehberi göremedi');
ok(!$g->allowed(['role'=>'customer','partner_id'=>$partner]) && !$g->allowed(null),'Hasta sahibi / oturumsuz rehbere erişti');
try { $g->topics(['role'=>'customer','partner_id'=>$partner]); ok(false,'Yetkisiz içerik döndü'); } catch (RuntimeException $e) { ok($e->getCode()===403,'Yetkisiz istekte 403 beklenirdi'); }
$data=$g->topics($dealer);
ok(count($data['topics'])>=15,'Rehber konuları eksik');
$media=array_flip(scandir(dirname(__DIR__).'/guide/media'));
$ids=[];
foreach ($data['topics'] as $t) {
  ok(!isset($ids[$t['id']]),'Konu kimliği tekrar ediyor: '.$t['id']); $ids[$t['id']]=1;
  ok(preg_match('/\A[a-z0-9-]+\z/',$t['id'])===1 && $t['title']!=='' && $t['steps'],'Konu eksik: '.$t['id']);
  foreach ($t['steps'] as $s) foreach (['src','poster'] as $k) if (isset($s['media'][$k])) ok(isset($media[$s['media'][$k]]),'Medya yok: '.$s['media'][$k]);
}
echo "Klinik Rehberi erişimi yalnız ücretli paketlerde\n";
