<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * İşletme analizi (veri havuzu): seçilen dönemde ciro, KDV, satılan malın maliyeti, brüt/net kâr, gider, nakit akışı,
 * alacak yaşlandırması, ürün/hizmet/müşteri/personel sıralamaları, tür ve ödeme yöntemi dağılımı, stok değeri ve
 * önceki eşit dönemle karşılaştırma. Hesap sunucuda, arşivdeki (soğuk) kayıtlar dahil tüm satırlar üzerinden yapılır;
 * tarayıcıya yalnız özet gider. Satırlar tek tek okunur ve hemen işlenir (büyük kliniklerde bellek sınırlı kalır).
 *
 * Tutarlar kuruş (int). Maliyet: ürünün stok partilerindeki ağırlıklı alış fiyatı, yoksa son alış faturası birim
 * fiyatı; hizmetlerin maliyeti 0. Genel indirim satış kalemlerine oranla dağıtılır. "Borç silme" kasaya girmez.
 */
final class BusinessReport
{
    private const WRITE_OFF = 'Borç silme';
    private const LIMIT = 100;

    public function __construct(private readonly PDO $db) {}

    public static function allowed(array $actor): bool
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true)) return false;
        $modules = ClinicAccess::modules($actor);
        $reports = $modules->reports ?? ($actor['role'] === 'dealer' ? 'write' : 'none');
        if (!in_array($reports, ['read', 'write'], true)) return false;
        return ClinicAccess::allowed($actor, 'sales') && ClinicAccess::action($actor, 'overviewSales');
    }

    /** @param ?string $branch dealer için şube kimliği; '' = tüm şubeler. Şube/personel kendi şubesiyle sınırlıdır. */
    public function build(array $actor, string $from, string $to, ?string $branch): array
    {
        if (!self::allowed($actor)) throw new RuntimeException('İşletme analizi için Raporlar ve "Ciro ve satış toplamları" yetkisi gerekir.', 403);
        foreach ([$from, $to] as $d) if (!preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) throw new RuntimeException('Tarih geçersiz.', 422);
        if ($from > $to) [$from, $to] = [$to, $from];
        $days = (int)round((strtotime($to) - strtotime($from)) / 86400) + 1;
        if ($days > 3700) throw new RuntimeException('En fazla 10 yıllık aralık seçilebilir.', 422);
        $prevTo = date('Y-m-d', strtotime($from) - 86400);
        $prevFrom = date('Y-m-d', strtotime($prevTo) - ($days - 1) * 86400);

        $workspace = 'partner:'.$actor['partner_id'];
        $branches = (new WorkspaceRepository($this->db))->branches($workspace);
        $allowedBranches = [];
        if ($actor['role'] === 'dealer') {
            foreach ($branches as $b) if (($b->status ?? '') !== 'Pasif' || $branch === $b->id) $allowedBranches[$b->id] = ($b->sharedWith ?? '') ?: $b->id;
            if ($branch !== null && $branch !== '') {
                if (!isset($allowedBranches[$branch])) throw new RuntimeException('Şube bulunamadı.', 404);
                $allowedBranches = [$branch => $allowedBranches[$branch]];
            }
        } else {
            $own = ClinicAccess::branch((object)['branches' => $branches], (string)$actor['branch_id']);
            if (!$own) throw new RuntimeException('Şube erişimi doğrulanamadı.', 403);
            $allowedBranches = [$own->id => ($own->sharedWith ?? '') ?: $own->id];
        }
        $dataBranches = array_flip(array_values($allowedBranches));
        $q = $this->db->prepare('SELECT id FROM clinic_record_set WHERE workspace_id=?');
        $q->execute([$workspace]);
        $set = $q->fetchColumn();
        WorkspaceRepository::headroom(768);
        $empty = ['period' => ['from' => $from, 'to' => $to, 'days' => $days, 'prevFrom' => $prevFrom, 'prevTo' => $prevTo]];
        if ($set === false) return $empty + self::blank();

        $money = static function ($v): int {
            if (is_int($v)) return $v * 100;
            if (is_float($v)) return (int)round($v * 100);
            $s = trim((string)$v);
            if ($s === '' || !preg_match('/\A-?\d{1,10}(?:[.,]\d{1,4})?\z/', $s)) return 0;
            return (int)round((float)str_replace(',', '.', $s) * 100);
        };
        $inBranch = static fn(array $r) => isset($dataBranches[(string)($r['branch'] ?? '')]);
        $stream = function (string $collection, callable $fn) use ($set, $inBranch): void {
            $s = $this->db->prepare('SELECT record_data FROM clinic_record WHERE set_id=? AND collection=?');
            $s->execute([(int)$set, $collection]);
            while (($json = $s->fetchColumn()) !== false) {
                $r = json_decode((string)$json, true);
                if (is_array($r) && $inBranch($r)) $fn($r);
            }
            $s->closeCursor();
        };

        // ── Ana kayıtlar: ürün, müşteri, hasta (ad, tür, kategori)
        $products = []; $nameToProduct = [];
        $stream('products', function (array $p) use (&$products, &$nameToProduct, $money) {
            $id = (string)($p['id'] ?? ''); if ($id === '') return;
            $products[$id] = ['name' => (string)($p['name'] ?? ''), 'service' => ($p['category'] ?? '') === 'Hizmet', 'category' => (string)($p['family'] ?? $p['category'] ?? ''),
                'price' => $money($p['price'] ?? '0'), 'stock' => (float)($p['stock'] ?? 0), 'track' => ($p['track'] ?? '') !== 'Hayır', 'archived' => ($p['archived'] ?? '') === 'Evet'];
            $key = mb_strtolower(trim((string)($p['name'] ?? '')), 'UTF-8');
            if ($key !== '' && !isset($nameToProduct[$key])) $nameToProduct[$key] = $id;
        });
        $lotCost = []; $lotValue = 0; $lotStock = [];
        $stream('stockLots', function (array $l) use (&$lotCost, &$lotValue, &$lotStock, $money) {
            $pid = (string)($l['product'] ?? ''); $buy = $money($l['buy'] ?? '0');
            $rec = max(0.0, (float)($l['received'] ?? 0)); $rem = max(0.0, (float)($l['remaining'] ?? 0));
            if ($pid === '') return;
            if ($buy > 0 && $rec > 0) { $lotCost[$pid][0] = ($lotCost[$pid][0] ?? 0) + $buy * $rec; $lotCost[$pid][1] = ($lotCost[$pid][1] ?? 0) + $rec; }
            $lotStock[$pid] = ($lotStock[$pid] ?? 0) + $rem;
            $lotValue += (int)round($buy * $rem);
        });
        $purchaseCost = []; $purchasesIn = 0; $purchasesPrev = 0;
        $stream('purchases', function (array $p) use (&$purchaseCost, &$purchasesIn, &$purchasesPrev, $money, $from, $to, $prevFrom, $prevTo) {
            $amount = $money($p['amount'] ?? '0'); $qty = max(0.0, (float)($p['quantity'] ?? 0)); $d = (string)($p['date'] ?? '');
            if (!empty($p['product']) && $qty > 0 && $amount > 0 && ($purchaseCost[$p['product']][1] ?? '') <= $d) $purchaseCost[$p['product']] = [(int)round($amount / $qty), $d];
            if ($d >= $from && $d <= $to) $purchasesIn += $amount;
            elseif ($d >= $prevFrom && $d <= $prevTo) $purchasesPrev += $amount;
        });
        $unitCost = [];
        foreach ($products as $id => $p) {
            if ($p['service']) { $unitCost[$id] = 0; continue; }
            if (isset($lotCost[$id]) && $lotCost[$id][1] > 0) $unitCost[$id] = (int)round($lotCost[$id][0] / $lotCost[$id][1]);
            elseif (isset($purchaseCost[$id])) $unitCost[$id] = $purchaseCost[$id][0];
        }
        $clients = [];
        $stream('clients', function (array $c) use (&$clients) {
            $id = (string)($c['id'] ?? ''); if ($id !== '') $clients[$id] = ['name' => (string)($c['name'] ?? ''), 'phone' => (string)($c['phone'] ?? ''), 'registered' => (string)($c['registered'] ?? '')];
        });
        $patients = [];
        $stream('patients', function (array $p) use (&$patients) {
            $id = (string)($p['id'] ?? ''); if ($id !== '') $patients[$id] = ['species' => (string)($p['species'] ?? '') ?: 'Belirtilmemiş', 'owner' => (string)($p['owner'] ?? ''), 'name' => (string)($p['name'] ?? '')];
        });

        // ── Tahsilatlar (satış bazında toplam; dönem içi nakit girişi; borç silme ayrı)
        $collectedBySale = []; $writeOffBySale = []; $cashIn = ['cur' => 0, 'prev' => 0]; $writeOffs = ['cur' => 0, 'prev' => 0]; $methods = []; $collectionSeries = [];
        $stream('collections', function (array $c) use (&$collectedBySale, &$writeOffBySale, &$cashIn, &$writeOffs, &$methods, &$collectionSeries, $money, $from, $to, $prevFrom, $prevTo) {
            $amount = $money($c['amount'] ?? '0'); $sale = (string)($c['sale'] ?? ''); $d = (string)($c['date'] ?? '');
            $wo = ($c['method'] ?? '') === self::WRITE_OFF;
            if ($wo) $writeOffBySale[$sale] = ($writeOffBySale[$sale] ?? 0) + $amount; else $collectedBySale[$sale] = ($collectedBySale[$sale] ?? 0) + $amount;
            $slot = $d >= $from && $d <= $to ? 'cur' : ($d >= $prevFrom && $d <= $prevTo ? 'prev' : null);
            if ($slot === null) return;
            if ($wo) { $writeOffs[$slot] += $amount; return; }
            $cashIn[$slot] += $amount;
            if ($slot === 'cur') { $m = (string)($c['method'] ?? '') ?: 'Diğer'; $methods[$m] = ($methods[$m] ?? 0) + $amount; $collectionSeries[$d] = ($collectionSeries[$d] ?? 0) + $amount; }
        });

        // ── Satışlar
        $sum = ['cur' => self::bucket(), 'prev' => self::bucket()];
        $items = []; $customers = []; $staff = []; $species = []; $weekday = array_fill(0, 7, [0, 0]); $series = [];
        $firstSale = []; $periodClients = []; $receivables = [0, 0, 0, 0, 0]; $receivableTotal = 0; $debtors = [];
        $soldProducts = [];
        $stream('sales', function (array $s) use (&$sum, &$items, &$customers, &$staff, &$species, &$weekday, &$series, &$firstSale, &$periodClients, &$receivables, &$receivableTotal, &$debtors, &$soldProducts, &$cashIn, &$methods, &$collectionSeries,
            $money, $products, $nameToProduct, $unitCost, $patients, $collectedBySale, $writeOffBySale, $from, $to, $prevFrom, $prevTo) {
            $id = (string)($s['id'] ?? ''); $d = (string)($s['date'] ?? ''); $amount = $money($s['amount'] ?? '0');
            if ($id === '' || $d === '' || $amount <= 0) return;
            $client = (string)($s['client'] ?? ''); $paid = $money($s['paid'] ?? '0');
            if ($client !== '' && (!isset($firstSale[$client]) || $d < $firstSale[$client])) $firstSale[$client] = $d;
            // Alacak (bugün itibarıyla, tüm zamanlar): tutar − ilk tahsilat − sonraki tahsilatlar − borç silme
            $open = $amount - $paid - ($collectedBySale[$id] ?? 0) - ($writeOffBySale[$id] ?? 0);
            if ($open > 0) {
                $age = (int)floor((time() - strtotime($d)) / 86400);
                $receivables[$age <= 30 ? 0 : ($age <= 60 ? 1 : ($age <= 90 ? 2 : ($age <= 180 ? 3 : 4)))] += $open;
                $receivableTotal += $open;
                if ($client !== '') { $debtors[$client] = ($debtors[$client] ?? 0) + $open; }
            }
            $slot = $d >= $from && $d <= $to ? 'cur' : ($d >= $prevFrom && $d <= $prevTo ? 'prev' : null);
            if ($slot === null) return;
            if ($paid > 0) {
                $cashIn[$slot] += $paid;
                if ($slot === 'cur') { $m = (string)($s['method'] ?? '') ?: 'Diğer'; $methods[$m] = ($methods[$m] ?? 0) + $paid; $collectionSeries[$d] = ($collectionSeries[$d] ?? 0) + $paid; }
            }
            // Kalemler: KDV dahil kalem tutarı, kalem indirimi; genel indirim kalemlere oranla dağıtılır.
            $lines = [];
            $raw = isset($s['items']) && is_string($s['items']) ? json_decode($s['items'], true) : null;
            if (is_array($raw)) foreach ($raw as $l) {
                if (!is_array($l)) continue;
                $qty = max(0.0, (float)($l['quantity'] ?? 1)); $rate = max(0.0, min(100.0, (float)($l['vat'] ?? 0))) / 100;
                $base = isset($l['legacyAmount']) ? $money($l['legacyAmount']) : (int)round($money($l['price'] ?? '0') * $qty);
                $gross = ($l['taxMode'] ?? 'KDV Hariç') === 'KDV Dahil' ? $base : $base + (int)round($base * $rate);
                $after = max(0, $gross - min($gross, $money($l['discountAmount'] ?? '0')));
                $lines[] = ['product' => (string)($l['product'] ?? ''), 'name' => trim((string)($l['name'] ?? '')), 'qty' => $qty, 'rate' => $rate, 'after' => $after];
            }
            if (!$lines) $lines[] = ['product' => (string)($s['product'] ?? ''), 'name' => trim((string)($s['detail'] ?? '')) ?: 'Satış', 'qty' => max(1.0, (float)($s['quantity'] ?? 1)), 'rate' => 0.0, 'after' => $amount];
            $totalAfter = array_sum(array_column($lines, 'after'));
            $saleNet = 0; $saleCost = 0; $saleVat = 0; $costKnown = true; $remaining = $amount; $n = count($lines);
            foreach ($lines as $i => $l) {
                $rev = $i === $n - 1 ? $remaining : ($totalAfter > 0 ? (int)round($amount * $l['after'] / $totalAfter) : intdiv($amount, $n));
                $remaining -= $rev;
                $net = (int)round($rev / (1 + $l['rate']));
                $pid = $l['product'] !== '' && isset($products[$l['product']]) ? $l['product'] : ($nameToProduct[mb_strtolower($l['name'], 'UTF-8')] ?? '');
                $p = $pid !== '' ? $products[$pid] : null;
                $isService = !$p || $p['service'];
                $cost = 0;
                if (!$isService) { if (isset($unitCost[$pid])) $cost = (int)round($unitCost[$pid] * $l['qty']); else $costKnown = false; }
                $saleNet += $net; $saleVat += $rev - $net; $saleCost += $cost;
                if ($slot === 'cur') {
                    $key = $pid !== '' ? 'p:'.$pid : 'n:'.mb_strtolower($l['name'] ?: 'Satış', 'UTF-8');
                    $it = &$items[$key];
                    $it ??= ['key' => $key, 'id' => $pid, 'name' => $p['name'] ?? ($l['name'] ?: 'Satış'), 'kind' => $isService ? 'service' : 'product', 'category' => $p['category'] ?? '', 'qty' => 0, 'revenue' => 0, 'net' => 0, 'cost' => 0, 'count' => 0, 'costKnown' => true, 'clients' => []];
                    $it['qty'] += $l['qty']; $it['revenue'] += $rev; $it['net'] += $net; $it['cost'] += $cost; $it['count']++;
                    if (!$isService && !isset($unitCost[$pid])) $it['costKnown'] = false;
                    if ($client !== '' && count($it['clients']) < 5000) $it['clients'][$client] = true;
                    unset($it);
                    if (!$isService) $soldProducts[$pid] = true;
                }
            }
            $b = &$sum[$slot];
            $b['revenue'] += $amount; $b['net'] += $saleNet; $b['vat'] += $saleVat; $b['cost'] += $saleCost; $b['count']++;
            if (!$costKnown) $b['costUnknown']++;
            unset($b);
            if ($slot !== 'cur') return;
            $profit = $saleNet - $saleCost;
            $series[$d] = ($series[$d] ?? [0, 0, 0]);
            $series[$d][0] += $amount; $series[$d][1] += $profit; $series[$d][2]++;
            $w = (int)date('N', strtotime($d)) - 1; $weekday[$w][0] += $amount; $weekday[$w][1]++;
            if ($client !== '') {
                $periodClients[$client] = true;
                $c = &$customers[$client];
                $c ??= ['id' => $client, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'days' => [], 'last' => ''];
                $c['revenue'] += $amount; $c['profit'] += $profit; $c['count']++; $c['days'][$d] = true; if ($d > $c['last']) $c['last'] = $d;
                unset($c);
            }
            $who = trim((string)($s['clinician'] ?? '')) ?: 'Belirtilmemiş';
            $st = &$staff[$who];
            $st ??= ['name' => $who, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'services' => 0, 'products' => 0, 'exams' => 0, 'appointments' => 0, 'clients' => []];
            $st['revenue'] += $amount; $st['profit'] += $profit; $st['count']++;
            if ($client !== '') $st['clients'][$client] = true;
            unset($st);
            $pt = (string)($s['patient'] ?? '');
            $sp = $pt !== '' && isset($patients[$pt]) ? $patients[$pt]['species'] : 'Hasta seçilmemiş';
            $species[$sp] = ($species[$sp] ?? [0, 0]); $species[$sp][0] += $amount; $species[$sp][1]++;
        });

        // ── Kasa hareketleri (gelir/gider) ve tedarikçi ödemeleri
        $expenses = ['cur' => 0, 'prev' => 0]; $income = ['cur' => 0, 'prev' => 0]; $expenseGroups = []; $expenseSeries = [];
        $stream('expenses', function (array $e) use (&$expenses, &$income, &$expenseGroups, &$expenseSeries, $money, $from, $to, $prevFrom, $prevTo) {
            $d = (string)($e['date'] ?? ''); $amount = $money($e['amount'] ?? '0');
            $slot = $d >= $from && $d <= $to ? 'cur' : ($d >= $prevFrom && $d <= $prevTo ? 'prev' : null);
            if ($slot === null) return;
            if (($e['type'] ?? '') === 'Gelir') { $income[$slot] += $amount; return; }
            $expenses[$slot] += $amount;
            if ($slot === 'cur') {
                $g = trim(mb_substr((string)($e['detail'] ?? ''), 0, 60, 'UTF-8')) ?: 'Açıklamasız gider';
                $expenseGroups[$g] = ($expenseGroups[$g] ?? [0, 0]); $expenseGroups[$g][0] += $amount; $expenseGroups[$g][1]++;
                $expenseSeries[$d] = ($expenseSeries[$d] ?? 0) + $amount;
            }
        });
        $supplier = ['cur' => 0, 'prev' => 0];
        $stream('payments', function (array $p) use (&$supplier, &$expenseSeries, $money, $from, $to, $prevFrom, $prevTo) {
            $d = (string)($p['date'] ?? ''); $amount = $money($p['amount'] ?? '0');
            if ($d >= $from && $d <= $to) { $supplier['cur'] += $amount; }
            elseif ($d >= $prevFrom && $d <= $prevTo) $supplier['prev'] += $amount;
        });

        // ── Ziyaret: satış, muayene ve tamamlanan randevu günleri (müşteri bazında)
        $examsCount = 0; $apptStats = ['total' => 0, 'done' => 0, 'noshow' => 0, 'cancel' => 0];
        $stream('exams', function (array $x) use (&$customers, &$staff, &$examsCount, $patients, $from, $to) {
            $d = (string)($x['date'] ?? ''); if ($d < $from || $d > $to) return;
            $examsCount++;
            $owner = $patients[(string)($x['patient'] ?? '')]['owner'] ?? '';
            if ($owner !== '') { $c = &$customers[$owner]; $c ??= ['id' => $owner, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'days' => [], 'last' => '']; $c['days'][$d] = true; if ($d > $c['last']) $c['last'] = $d; unset($c); }
            $who = trim((string)($x['clinician'] ?? ''));
            if ($who !== '') { $st = &$staff[$who]; $st ??= ['name' => $who, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'services' => 0, 'products' => 0, 'exams' => 0, 'appointments' => 0, 'clients' => []]; $st['exams']++; unset($st); }
        });
        $stream('appointments', function (array $a) use (&$customers, &$staff, &$apptStats, $from, $to) {
            $d = (string)($a['date'] ?? ''); if ($d < $from || $d > $to) return;
            $status = (string)($a['status'] ?? '');
            $apptStats['total']++;
            if (in_array($status, ['Tamamlandı', 'Muayenede'], true)) $apptStats['done']++;
            elseif ($status === 'Gelmedi') $apptStats['noshow']++;
            elseif ($status === 'İptal') $apptStats['cancel']++;
            $client = (string)($a['client'] ?? '');
            if ($client !== '' && in_array($status, ['Tamamlandı', 'Muayenede'], true)) { $c = &$customers[$client]; $c ??= ['id' => $client, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'days' => [], 'last' => '']; $c['days'][$d] = true; if ($d > $c['last']) $c['last'] = $d; unset($c); }
            $who = trim((string)($a['clinician'] ?? ''));
            if ($who !== '') { $st = &$staff[$who]; $st ??= ['name' => $who, 'revenue' => 0, 'profit' => 0, 'count' => 0, 'services' => 0, 'products' => 0, 'exams' => 0, 'appointments' => 0, 'clients' => []]; $st['appointments']++; unset($st); }
        });

        // ── Sonuçlar
        $kpi = static function (array $b, int $expense, int $income, int $cashIn, int $supplier, int $writeOff): array {
            $gross = $b['net'] - $b['cost'];
            return ['revenue' => $b['revenue'], 'net' => $b['net'], 'vat' => $b['vat'], 'cost' => $b['cost'], 'grossProfit' => $gross,
                'margin' => $b['net'] > 0 ? round($gross * 100 / $b['net'], 1) : 0.0, 'expenses' => $expense, 'otherIncome' => $income,
                'netProfit' => $gross - $expense + $income, 'count' => $b['count'], 'avgTicket' => $b['count'] ? intdiv($b['revenue'], $b['count']) : 0,
                'cashIn' => $cashIn + $income, 'cashOut' => $expense + $supplier, 'supplierPayments' => $supplier, 'writeOffs' => $writeOff, 'costUnknown' => $b['costUnknown']];
        };
        $cur = $kpi($sum['cur'], $expenses['cur'], $income['cur'], $cashIn['cur'], $supplier['cur'], $writeOffs['cur']);
        $prev = $kpi($sum['prev'], $expenses['prev'], $income['prev'], $cashIn['prev'], $supplier['prev'], $writeOffs['prev']);
        $cur['purchases'] = $purchasesIn; $prev['purchases'] = $purchasesPrev;
        $newClients = 0; foreach ($periodClients as $id => $_) if (($firstSale[$id] ?? '') >= $from) $newClients++;
        $cur['customers'] = count($periodClients); $cur['newCustomers'] = $newClients; $cur['returningCustomers'] = count($periodClients) - $newClients;
        $cur['exams'] = $examsCount; $cur['appointments'] = $apptStats;

        $itemRows = [];
        foreach ($items as $it) {
            $it['profit'] = $it['net'] - $it['cost'];
            $it['margin'] = $it['net'] > 0 ? round($it['profit'] * 100 / $it['net'], 1) : 0.0;
            $it['customers'] = count($it['clients']); unset($it['clients']);
            $it['qty'] = round($it['qty'], 2);
            $itemRows[] = $it;
        }
        $top = static function (array $rows, string $by, int $limit = self::LIMIT): array { usort($rows, static fn($a, $b) => $b[$by] <=> $a[$by]); return array_slice($rows, 0, $limit); };
        $productRows = array_values(array_filter($itemRows, static fn($r) => $r['kind'] === 'product'));
        $serviceRows = array_values(array_filter($itemRows, static fn($r) => $r['kind'] === 'service'));
        $customerRows = [];
        foreach ($customers as $c) {
            $info = $clients[$c['id']] ?? null;
            $customerRows[] = ['id' => $c['id'], 'name' => $info['name'] ?? 'Silinmiş müşteri', 'phone' => $info['phone'] ?? '', 'revenue' => $c['revenue'], 'profit' => $c['profit'],
                'count' => $c['count'], 'visits' => count($c['days']), 'last' => $c['last'], 'debt' => $debtors[$c['id']] ?? 0, 'avgTicket' => $c['count'] ? intdiv($c['revenue'], $c['count']) : 0];
        }
        $debtorRows = [];
        foreach ($debtors as $id => $amount) $debtorRows[] = ['id' => $id, 'name' => $clients[$id]['name'] ?? 'Silinmiş müşteri', 'phone' => $clients[$id]['phone'] ?? '', 'debt' => $amount];
        $staffRows = [];
        foreach ($staff as $s) { $s['customers'] = count($s['clients']); unset($s['clients']); $s['avgTicket'] = $s['count'] ? intdiv($s['revenue'], $s['count']) : 0; $staffRows[] = $s; }

        // Zaman serisi: aralığa göre günlük / haftalık / aylık
        $grain = $days <= 45 ? 'day' : ($days <= 200 ? 'week' : 'month');
        $bucketKey = static function (string $d) use ($grain): string {
            if ($grain === 'day') return $d;
            if ($grain === 'month') return substr($d, 0, 7);
            $t = strtotime($d); return date('Y-m-d', $t - ((int)date('N', $t) - 1) * 86400);
        };
        $timeline = [];
        for ($t = strtotime($from); $t <= strtotime($to); $t += 86400) $timeline[$bucketKey(date('Y-m-d', $t))] ??= ['key' => $bucketKey(date('Y-m-d', $t)), 'revenue' => 0, 'profit' => 0, 'count' => 0, 'collected' => 0, 'expenses' => 0];
        foreach ($series as $d => [$r, $p, $n]) { $k = $bucketKey($d); if (isset($timeline[$k])) { $timeline[$k]['revenue'] += $r; $timeline[$k]['profit'] += $p; $timeline[$k]['count'] += $n; } }
        foreach ($collectionSeries as $d => $v) { $k = $bucketKey($d); if (isset($timeline[$k])) $timeline[$k]['collected'] += $v; }
        foreach ($expenseSeries as $d => $v) { $k = $bucketKey($d); if (isset($timeline[$k])) $timeline[$k]['expenses'] += $v; }

        // Stok: eldeki stok değeri ve dönemde hiç satılmayan stoklu ürünler
        $stockValue = $lotValue; $idle = [];
        foreach ($products as $id => $p) {
            if ($p['service'] || $p['archived'] || !$p['track']) continue;
            $qty = $lotStock[$id] ?? $p['stock'];
            if (!isset($lotStock[$id])) $stockValue += (int)round(($unitCost[$id] ?? 0) * max(0, $qty));
            if ($qty > 0 && !isset($soldProducts[$id])) $idle[] = ['id' => $id, 'name' => $p['name'], 'stock' => round($qty, 2), 'value' => (int)round(($unitCost[$id] ?? 0) * $qty), 'price' => $p['price']];
        }

        $methodRows = []; foreach ($methods as $m => $v) $methodRows[] = ['name' => $m, 'amount' => $v];
        $speciesRows = []; foreach ($species as $k => [$v, $n]) $speciesRows[] = ['name' => $k, 'revenue' => $v, 'count' => $n];
        $expenseRows = []; foreach ($expenseGroups as $k => [$v, $n]) $expenseRows[] = ['name' => $k, 'amount' => $v, 'count' => $n];
        $names = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
        $weekRows = []; foreach ($weekday as $i => [$v, $n]) $weekRows[] = ['name' => $names[$i], 'revenue' => $v, 'count' => $n];

        return $empty + [
            'branches' => array_keys($allowedBranches),
            'kpi' => $cur, 'previous' => $prev, 'grain' => $grain, 'timeline' => array_values($timeline),
            'products' => ['byRevenue' => $top($productRows, 'revenue'), 'byProfit' => $top($productRows, 'profit'), 'byQty' => $top($productRows, 'qty'), 'total' => count($productRows)],
            'services' => ['byRevenue' => $top($serviceRows, 'revenue'), 'byProfit' => $top($serviceRows, 'profit'), 'byQty' => $top($serviceRows, 'count'), 'total' => count($serviceRows)],
            'customers' => ['byRevenue' => $top($customerRows, 'revenue'), 'byProfit' => $top($customerRows, 'profit'), 'byVisits' => $top($customerRows, 'visits'), 'total' => count($customerRows)],
            'staff' => $top($staffRows, 'revenue', 50),
            'debt' => ['total' => $receivableTotal, 'aging' => $receivables, 'top' => $top($debtorRows, 'debt', 50), 'count' => count($debtorRows)],
            'methods' => $top($methodRows, 'amount', 20), 'species' => $top($speciesRows, 'revenue', 20), 'weekday' => $weekRows,
            'expenseGroups' => $top($expenseRows, 'amount', 30),
            'stock' => ['value' => $stockValue, 'idle' => $top($idle, 'value', 50), 'idleCount' => count($idle)],
        ];
    }

    private static function bucket(): array { return ['revenue' => 0, 'net' => 0, 'vat' => 0, 'cost' => 0, 'count' => 0, 'costUnknown' => 0]; }
    private static function blank(): array { return ['kpi' => null]; }
}
