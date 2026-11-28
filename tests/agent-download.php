<?php
declare(strict_types=1);
// Klinik ajanı indirme paketi: kaynak sürümü değişince ilk istekte kendiliğinden yeniden üretilir; eşzamanlı isteklerde
// tek paket, bozulmayan manifest; diğer indirme kayıtları korunur; eski sürüm dosyası silinir.
require_once dirname(__DIR__).'/src/AppDownloads.php';
use VetNet\Cpanel\AppDownloads;
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
if (($argv[1] ?? '')==='child') {
    $ref=new ReflectionClass(AppDownloads::class);
    $d=$ref->newInstanceWithoutConstructor();
    (function($r){ $this->root=$r; })->call($d,$argv[2]);
    $d->freshAgent('https://klinik.example'); exit(0);
}
$root=sys_get_temp_dir().'/vz-agent-'.bin2hex(random_bytes(4));
mkdir($root.'/bridge-agent',0755,true); mkdir($root.'/public/download/agents',0755,true);
foreach (AppDownloads::AGENT_FILES as $f) copy(dirname(__DIR__).'/bridge-agent/'.$f,$root.'/bridge-agent/'.$f);
file_put_contents($root.'/bridge-agent/agent.mjs',preg_replace('~const VERSION = "[^"]+"~','const VERSION = "9.9.1"',(string)file_get_contents($root.'/bridge-agent/agent.mjs')));
file_put_contents($root.'/public/download/agents/VetZimo-Klinik-Ajani-9.9.0.zip','eski');
file_put_contents($root.'/public/download/manifest.json',json_encode(['files'=>['windows'=>['file'=>'x.exe','version'=>'1.0.0'],'agent'=>['file'=>'VetZimo-Klinik-Ajani-9.9.0.zip','version'=>'9.9.0']]]));
$procs=[];
for ($k=0;$k<6;$k++) $procs[]=proc_open([PHP_BINARY,__FILE__,'child',$root],[1=>['pipe','w'],2=>['pipe','w']],$pipes[$k]);
foreach ($procs as $k=>$p) { $e=stream_get_contents($pipes[$k][2]); proc_close($p); ok($e==='','Alt süreç hatası: '.$e); }
$m=json_decode((string)file_get_contents($root.'/public/download/manifest.json'),true);
ok(($m['files']['agent']['version'] ?? '')==='9.9.1','Manifest güncellenmedi: '.json_encode($m));
ok(($m['files']['windows']['file'] ?? '')==='x.exe','Diğer indirme kaydı kayboldu');
$zip=$root.'/public/download/agents/VetZimo-Klinik-Ajani-9.9.1.zip';
ok(is_file($zip) && hash_file('sha256',$zip)===$m['files']['agent']['sha256'],'Paket/özet uyuşmuyor');
ok(!is_file($root.'/public/download/agents/VetZimo-Klinik-Ajani-9.9.0.zip'),'Eski sürüm silinmedi');
ok(count(glob($root.'/public/download/agents/*.tmp'))===0 && count(glob($root.'/public/download/agents/.*.tmp'))===0,'Geçici dosya kaldı');
$z=new ZipArchive(); $z->open($zip);
ok(str_contains((string)$z->getFromName('VetZimoKopru/whatsapp.mjs'),'yazma alanı boşaldıysa') || str_contains((string)$z->getFromName('VetZimoKopru/whatsapp.mjs'),'Yazma alanı boşaldıysa'),'Pakette yeni WhatsApp modülü yok');
ok(json_decode((string)$z->getFromName('VetZimoKopru/config.json'),true)['server']==='https://klinik.example','Sunucu adresi yanlış');
$z->close();
$before=filemtime($zip); clearstatcache();
passthru(escapeshellarg(PHP_BINARY).' '.escapeshellarg(__FILE__).' child '.escapeshellarg($root));
ok(filemtime($zip)===$before,'Güncel paket gereksiz yere yeniden üretildi');
array_map('unlink',array_merge(glob($root.'/bridge-agent/*'),glob($root.'/public/download/agents/*'),glob($root.'/public/download/agents/.build.lock'),[$root.'/public/download/manifest.json']));
echo "Ajan indirme testleri geçti\n";
