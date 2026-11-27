<?php
declare(strict_types=1);
// Eşzamanlılık testi: aynı kliniğe aynı anda çok sayıda süreç kayıt ekler (web randevu talebi yolu) ve
// tam kaydetme yapar. Kayıp güncelleme olmamalı, çakışmalar 409 benzeri biçimde yakalanıp yeniden denenmeli.
$root = dirname(__DIR__);
foreach (glob($root.'/src/*.php') as $f) require_once $f;
use VetNet\Cpanel\{Database, WorkspaceRepository, ClinicRecords};
function ok(bool $c, string $m): void { if (!$c) { fwrite(STDERR, "HATA: $m\n"); exit(1); } }
$dsn = (string)getenv('VETNET_TEST_DSN');

// Alt süreç: verilen sayıda randevu ekler; revizyon çakışırsa güncel revizyonu okuyup yeniden dener.
if (($argv[1] ?? '') === 'worker') {
    [$worker, $count, $mode] = [(int)$argv[2], (int)$argv[3], $argv[4]];
    $db = Database::connect($dsn, 'root', '');
    $repo = new WorkspaceRepository($db);
    $repo->ensureAppendLog();
    $conflicts = 0;
    for ($k = 0; $k < $count; $k++) {
        $id = sprintf('web-%08d%024d', $worker, $k);
        for ($try = 0; $try < 200; $try++) {
            if ($mode === 'append') {
                $rev = (int)$db->query("SELECT revision FROM clinic_workspace WHERE user_id='partner:conc'")->fetchColumn();
                $row = (object)['id'=>$id, 'branch'=>'merkez', 'date'=>'2026-12-01', 'time'=>'10:00', 'status'=>'Onay Bekliyor', 'service'=>'Aşı'];
                if ($repo->append('partner:conc', $rev, 'appointments', $row) !== null) break;
            } else {
                $data = $repo->load('partner:conc');
                $state = $data['state']; $original = clone $state;
                $state->clients[] = (object)['id'=>'c'.$id, 'branch'=>'merkez', 'name'=>"Eşzamanlı $worker-$k", 'phone'=>'05320000000'];
                if ($repo->save('partner:conc', $data['revision'], $state, $original) !== null) break;
            }
            $conflicts++;
            usleep(random_int(1000, 20000));
        }
    }
    echo $conflicts;
    exit(0);
}

$db = Database::connect($dsn, 'root', '');
$repo = new WorkspaceRepository($db);
$state = (object)['version'=>1, 'demo'=>false, 'preferences'=>(object)['clinic'=>'Eşzamanlı Klinik'],
    'branches'=>[(object)['id'=>'merkez', 'name'=>'Merkez', 'status'=>'Aktif']], 'clients'=>[], 'patients'=>[], 'appointments'=>[]];
for ($k = 0; $k < 2000; $k++) $state->appointments[] = (object)['id'=>"old$k", 'branch'=>'merkez', 'date'=>'2026-11-01', 'time'=>'09:00', 'status'=>'Tamamlandı', 'service'=>'Kontrol'];
ok($repo->save('partner:conc', 0, $state) !== null, 'başlangıç kaydı');

$run = function (string $mode, int $workers, int $each) use ($root): array {
    $procs = []; $t = microtime(true);
    for ($w = 0; $w < $workers; $w++) {
        $procs[] = proc_open([PHP_BINARY, __FILE__, 'worker', (string)$w, (string)$each, $mode], [1=>['pipe','w'], 2=>['pipe','w']], $pipes, null, ['VETNET_TEST_DSN'=>getenv('VETNET_TEST_DSN')]);
        $out[$w] = $pipes;
    }
    $conflicts = 0;
    foreach ($procs as $w => $p) { $conflicts += (int)stream_get_contents($out[$w][1]); $err = stream_get_contents($out[$w][2]); ok(proc_close($p) === 0, "$mode süreci $w hata: $err"); }
    return [$conflicts, microtime(true) - $t];
};

// 1) 20 süreç × 25 web randevusu aynı anda (tek kayıt ekleme yolu)
[$c1, $s1] = $run('append', 20, 25);
$after = (new ClinicRecords($db))->collections('partner:conc', ['appointments']);
$web = array_filter($after->appointments, fn($r) => str_starts_with($r->id, 'web-'));
ok(count($web) === 500, 'eşzamanlı eklemede kayıp: '.count($web).'/500');
ok(count($after->appointments) === 2500, 'eski randevular korunmalı');
ok(count(array_unique(array_map(fn($r) => $r->id, $after->appointments))) === 2500, 'yinelenen kayıt olmamalı');

// Ekleme günlüğü: aradaki 500 revizyonun hepsi ekleme olduğundan personelin kısmi kaydı güvenle taşınabilir
$appended = $repo->appendsBetween('partner:conc', 351, 501);
ok($appended !== null && count($appended['appointments'] ?? []) === 150, 'ekleme günlüğü son 150 eklemeyi tam göstermeli');
ok($repo->appendsBetween('partner:conc', 0, 501) === null, 'çok eski veya günlükte olmayan revizyondan taşıma yapılmamalı');

// 2) 10 süreç × 10 müşteri tam kaydetme ile aynı anda (klinik ekranı yolu) + revizyon çakışması
[$c2, $s2] = $run('save', 10, 10);
$after = (new ClinicRecords($db))->collections('partner:conc', ['clients', 'appointments']);
ok(count($after->clients) === 100, 'eşzamanlı kaydetmede kayıp: '.count($after->clients).'/100');
ok(count($after->appointments) === 2500, 'kaydetme randevuları bozmamalı');
$rev = (int)$db->query("SELECT revision FROM clinic_workspace WHERE user_id='partner:conc'")->fetchColumn();
ok($rev === 1 + 500 + 100, "revizyon her başarılı yazımda bir artmalı ($rev)");
printf("concurrency ok · 500 eşzamanlı ekleme %.1fs (%d çakışma yeniden denendi) · 100 eşzamanlı kaydetme %.1fs (%d çakışma)\n", $s1, $c1, $s2, $c2);
