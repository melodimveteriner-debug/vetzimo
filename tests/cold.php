<?php
declare(strict_types=1);
// Arşiv (sıcak/soğuk veri): büyük klinikte eski ve işi bitmiş kayıtlar ayrılır; hiçbir kayıt yolundan silinmez,
// hasta geçmişi doğru süzülür, küçük klinik etkilenmez, açık işler (borçlu satış, yapılmamış aşı) hiç arşive girmez.
$root = dirname(__DIR__);
foreach (glob($root.'/src/*.php') as $f) require_once $f;
use VetNet\Cpanel\{Database, WorkspaceRepository, ColdStorage, ClinicRecords};
function ok(bool $c, string $m): void { if (!$c) { fwrite(STDERR, "HATA: $m\n"); exit(1); } }
$db = Database::connect((string)getenv('VETNET_TEST_DSN'), 'root', '');
$repo = new WorkspaceRepository($db);
VetNet\Cpanel\ClinicChanges::ensure($db);
$old = date('Y-m-d', strtotime('-3 years')); $new = date('Y-m-d', strtotime('-10 days'));
$s = (object)['version'=>1, 'demo'=>false, 'preferences'=>(object)['clinic'=>'Arşiv'], 'branches'=>[(object)['id'=>'merkez','name'=>'Merkez','status'=>'Aktif']]];
for ($k = 0; $k < 1000; $k++) {
    $s->clients[] = (object)['id'=>"c$k", 'branch'=>'merkez', 'name'=>"Sahip $k", 'phone'=>sprintf('0532%07d', $k)];
    $s->patients[] = (object)['id'=>"p$k", 'branch'=>'merkez', 'name'=>"Pati $k", 'owner'=>"c$k"];
}
for ($k = 0; $k < 10000; $k++) {
    $date = $k % 2 ? $old : $new;
    // tek: eski; 4'e bölünen tek kimlikler borçlu (soğuk olmamalı)
    $debt = $k % 4 === 1;
    $s->sales[] = (object)['id'=>"s$k", 'branch'=>'merkez', 'client'=>'c'.($k % 1000), 'date'=>$date, 'amount'=>'100', 'paid'=>$debt ? '0' : '100', 'detail'=>'Muayene'];
    $s->followups[] = (object)['id'=>"f$k", 'branch'=>'merkez', 'patient'=>'p'.($k % 1000), 'date'=>$date, 'title'=>'Aşı', 'done'=>$k % 3 ? $date : ''];
}
ok($repo->save('partner:cold', 0, $s) !== null, 'kayıt');
$cs = new ColdStorage($db);
$set = $cs->setId('partner:cold');
$cold = $cs->coldIds($set);
$expectSales = count(array_filter(range(0, 9999), fn($k) => $k % 2 && $k % 4 !== 1));
$expectFollow = count(array_filter(range(0, 9999), fn($k) => $k % 2 && $k % 3));
ok(count($cold['sales'] ?? []) === $expectSales, 'yalnız eski ve borcu kapanmış satışlar arşivde: '.count($cold['sales'] ?? []).'/'.$expectSales);
ok(count($cold['followups'] ?? []) === $expectFollow, 'yalnız eski ve yapılmış aşılar arşivde');
ok(!isset($cold['clients']) && !isset($cold['patients']), 'müşteri ve hasta hiçbir zaman arşive girmez');
ok(!isset($cold['sales']['s1']) && isset($cold['sales']['s3']), 'borçlu eski satış sıcak kalır');

// Hasta geçmişi: yalnız o hastanın / sahibinin kayıtları
$h = $cs->history($set, $cold, ['patient'=>'p3', 'client'=>'c3'], null);
foreach ($h['followups'] ?? [] as $r) ok($r->patient === 'p3', 'başka hastanın aşısı geldi');
foreach ($h['sales'] ?? [] as $r) ok($r->client === 'c3', 'başka sahibin satışı geldi');
ok(count($h['sales'] ?? []) > 0 && count($h['followups'] ?? []) > 0, 'hasta geçmişi boş olmamalı');

// Koruma: istemci listeyi soğuk satırlar olmadan komple gönderirse soğuklar geri eklenir
$full = $repo->load('partner:cold')['state'];
$hot = array_values(array_filter($full->sales, fn($r) => !isset($cold['sales'][$r->id])));
$patch = (object)['sales'=>(object)['replace'=>$hot]];
ColdStorage::preserve($full, $patch, $cold);
ok(count($patch->sales->replace) === 10000, 'replace koruması soğuk satırları geri eklemeli');
$state = clone $full; $state->followups = array_values(array_filter($full->followups, fn($r) => !isset($cold['followups'][$r->id])));
ColdStorage::preserveState($full, $state, $cold);
ok(count($state->followups) === 10000, 'tam durum koruması soğuk aşıları geri eklemeli');

// Küçük klinik: eşik altında arşiv yok
$small = (object)['version'=>1, 'demo'=>false, 'preferences'=>(object)[], 'branches'=>$s->branches, 'sales'=>[(object)['id'=>'x', 'branch'=>'merkez', 'date'=>$old, 'amount'=>'1', 'paid'=>'1', 'detail'=>'A']]];
$repo->save('partner:small', 0, $small);
ok((new ColdStorage($db))->coldIds((int)$cs->setId('partner:small')) === [], 'küçük klinikte arşiv olmamalı');
// Artımlı önbellek: değişen satırlar yeniden değerlendirilir, sonuç baştan hesapla aynı olmalı
$data = $repo->load('partner:cold'); $st = $data['state']; $orig = unserialize(serialize($st));
foreach ($st->sales as $r) { if ($r->id === 's3') $r->paid = '0'; }                       // soğuk satış borçlu oldu → sıcak
$st->collections[] = (object)['id'=>'k1', 'branch'=>'merkez', 'sale'=>'s1', 'date'=>$old, 'amount'=>'100']; // borçlu eski satış kapandı → soğuk
foreach ($st->followups as $r) { if ($r->id === 'f1') $r->done = ''; }                     // yapılmış eski aşı geri alındı → sıcak
ok($repo->save('partner:cold', $data['revision'], $st, $orig) !== null, 'güncelleme');
$inc = (new ColdStorage($db))->coldIds($set);
ok(!isset($inc['sales']['s3']) && isset($inc['sales']['s1']) && isset($inc['collections']['k1']) && !isset($inc['followups']['f1']), 'artımlı arşiv güncellemesi');
$db->exec('DELETE FROM clinic_cold_cache');
$fresh = (new ColdStorage($db))->coldIds($set);
ok(json_encode(array_map(fn($a) => array_keys($a), $inc)) === json_encode(array_map(fn($a) => array_keys($a), $fresh)) || (function () use ($inc, $fresh) { foreach ($fresh as $c => $ids) { if (array_diff_key($ids, $inc[$c] ?? []) || array_diff_key($inc[$c] ?? [], $ids)) return false; } return count($fresh) === count($inc); })(), 'artımlı sonuç baştan hesapla aynı olmalı');
printf("cold ok · %d soğuk satış, %d soğuk aşı\n", count($cold['sales']), count($cold['followups']));
