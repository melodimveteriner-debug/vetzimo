<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;

/**
 * Yönetici (merkez) gelişmiş panel verisi: tüm bayiler, şubeler, hasta sahipleri, hastalar, üyelikler, abonelikler,
 * bayi gelir-gider (satış, tahsilat, gider, tedarikçi ödemesi) ve son 12 ay eğilimleri. Toplama veritabanında yapılır
 * ve 10 dakika önbelleğe alınır. Bayi başına aylık özet ayrıca saklanır ve yalnız verisi değişen bayi yeniden
 * hesaplanır; 10.000 bayide panel her açılışta milyonlarca satırı taramaz.
 */
final class CenterAnalytics
{
    private const CACHE_ID = '00000000000000000000000000000003';
    private const TTL = 600;

    public function __construct(private readonly PDO $db) {}

    /** @param float $budget Bayi özetlerini hesaplamaya ayrılan en uzun süre (sn); web isteği kısa, zamanlanmış görev uzun tutar. */
    public function get(bool $refresh, int $now, float $budget = 8.0): array
    {
        $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='analytics_cache'");
        $q->execute([self::CACHE_ID]);
        $cached = json_decode((string)$q->fetchColumn(), true);
        if (!$refresh && is_array($cached) && empty($cached['partial']) && ($cached['generatedAt'] ?? 0) > $now - self::TTL) return $cached;
        $data = $this->compute($now, $budget);
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'analytics_cache',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::CACHE_ID, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        return $data;
    }

    private function ensureSetCache(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS center_analytics_set (
            set_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, version VARCHAR(80) NOT NULL, payload MEDIUMTEXT NOT NULL, updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    /** Tek bir kayıt kümesinin (bayi) aylık özeti; yalnız o kümenin satırları taranır (birincil anahtar: set_id,collection). */
    private function setStats(int $set, string $from, string $current): array
    {
        $out = [];
        $read = function (string $collection, string $start, string $amount = "'$.amount'", string $extra = '') use ($set): array {
            $date = $collection === 'patients' ? "'$.registered'" : "'$.date'";
            $q = $this->db->prepare("SELECT LEFT(JSON_UNQUOTE(JSON_EXTRACT(record_data,$date)),7) AS m, COUNT(*) AS n,
                    COALESCE(SUM(ROUND(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_data,$amount)),'') AS DECIMAL(16,2))*100)),0) AS total
                FROM clinic_record WHERE set_id=? AND collection=? AND JSON_UNQUOTE(JSON_EXTRACT(record_data,$date))>=? $extra GROUP BY m");
            $q->execute([$set, $collection, $start]);
            $rows = [];
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $rows[(string)$r['m']] = ['n' => (int)$r['n'], 't' => (int)$r['total']];
            return $rows;
        };
        $out['sales'] = $read('sales', $from);
        $out['collections'] = $read('collections', $from);
        $out['expenses'] = $read('expenses', $from, "'$.amount'", "AND JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.type'))='Gider'");
        $out['payments'] = $read('payments', $from);
        $out['income'] = $read('expenses', $from, "'$.amount'", "AND JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.type'))='Gelir'");
        $out['exams'] = $read('exams', $current.'-01', "'$.id'");
        $out['appointments'] = $read('appointments', $current.'-01', "'$.id'");
        $out['patients'] = $read('patients', $from, "'$.id'");
        return $out;
    }

    private function months(int $now): array
    {
        $d = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->modify('first day of this month');
        $out = [];
        for ($i = 11; $i >= 0; $i--) $out[] = $d->modify("-$i months")->format('Y-m');
        return $out;
    }

    private function compute(int $now, float $budget = 8.0): array
    {
        $months = $this->months($now);
        $from = $months[0].'-01';
        $current = end($months);
        $partners = [];
        foreach ($this->db->query('SELECT id,code,name,email,phone,city,active,created_at,last_seen FROM partner_account ORDER BY name')->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $partners[$p['id']] = ['id' => $p['id'], 'code' => $p['code'], 'name' => $p['name'], 'city' => $p['city'], 'active' => (int)$p['active'] === 1,
                'createdAt' => $p['created_at'], 'lastSeen' => $p['last_seen'], 'branches' => 0, 'clients' => 0, 'patients' => 0,
                'members' => ['dealer' => 0, 'branch' => 0, 'staff' => 0, 'customer' => 0], 'plan' => null, 'planKind' => null, 'endsOn' => null,
                'sales' => array_fill_keys($months, 0), 'collections' => array_fill_keys($months, 0), 'expenses' => array_fill_keys($months, 0),
                'income' => array_fill_keys($months, 0), 'exams' => 0, 'appointments' => 0, 'newPatients' => 0, 'saasPaid' => 0, 'agreement' => false];
        }
        // set → bayi eşlemesi ve kayıt sayıları
        $sets = [];
        foreach ($this->db->query("SELECT s.id,s.workspace_id,s.client_count,s.patient_count,w.request_branches FROM clinic_record_set s JOIN clinic_workspace w ON w.user_id=s.workspace_id WHERE s.workspace_id LIKE 'partner:%'")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $pid = substr($r['workspace_id'], 8);
            if (!isset($partners[$pid])) continue;
            $sets[$r['id']] = $pid;
            $partners[$pid]['clients'] = (int)$r['client_count'];
            $partners[$pid]['patients'] = (int)$r['patient_count'];
            $branches = json_decode((string)$r['request_branches'], true);
            $partners[$pid]['branches'] = is_array($branches) ? count($branches) : 0;
        }
        foreach ($this->db->query("SELECT user_id,request_branches FROM clinic_workspace WHERE user_id LIKE 'partner:%'")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $pid = substr($r['user_id'], 8);
            if (isset($partners[$pid]) && !$partners[$pid]['branches']) { $b = json_decode((string)$r['request_branches'], true); $partners[$pid]['branches'] = is_array($b) ? count($b) : 0; }
        }
        foreach ($this->db->query("SELECT partner_id,role,COUNT(*) n FROM identity_membership WHERE status='active' GROUP BY partner_id,role")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (isset($partners[$r['partner_id']])) $partners[$r['partner_id']]['members'][$r['role']] = (int)$r['n'];
        }
        $day = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
        $q = $this->db->prepare('SELECT partner_id,plan_name,kind,ends_on FROM clinic_subscription WHERE starts_on<=? AND ends_on>=? AND kind<>\'upgrade\' ORDER BY starts_on');
        $q->execute([$day, $day]);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) if (isset($partners[$r['partner_id']])) { $partners[$r['partner_id']]['plan'] = $r['plan_name']; $partners[$r['partner_id']]['planKind'] = $r['kind']; $partners[$r['partner_id']]['endsOn'] = $r['ends_on']; }
        try { foreach ($this->db->query('SELECT DISTINCT partner_id FROM dealer_agreement')->fetchAll(PDO::FETCH_COLUMN) as $pid) if (isset($partners[$pid])) $partners[$pid]['agreement'] = true; } catch (\PDOException) {}
        $saasMonthly = array_fill_keys($months, 0);
        try {
            foreach ($this->db->query("SELECT partner_id,amount,paid_at FROM saas_order WHERE status='paid'")->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (isset($partners[$r['partner_id']])) $partners[$r['partner_id']]['saasPaid'] += (int)$r['amount'];
                $m = (new \DateTimeImmutable('@'.(int)$r['paid_at']))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m');
                if (isset($saasMonthly[$m])) $saasMonthly[$m] += (int)$r['amount'];
            }
        } catch (\PDOException) {}
        // Bayi gelir-gider ve klinik etkinliği: bayi başına özet, yalnız verisi değişen bayi için yeniden hesaplanır.
        $this->ensureSetCache();
        $period = $from.'|'.$current;
        $versions = [];
        foreach ($this->db->query("SELECT s.id,w.revision,w.updated_at FROM clinic_record_set s JOIN clinic_workspace w ON w.user_id=s.workspace_id WHERE s.workspace_id LIKE 'partner:%'")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (isset($sets[$r['id']])) $versions[(int)$r['id']] = $period.'|'.$r['revision'].'|'.$r['updated_at'];
        }
        $stats = [];
        foreach ($this->db->query('SELECT set_id,version,payload FROM center_analytics_set')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (($versions[(int)$r['set_id']] ?? null) === $r['version']) $stats[(int)$r['set_id']] = json_decode($r['payload'], true);
        }
        $deadline = microtime(true) + $budget;
        $store = $this->db->prepare('INSERT INTO center_analytics_set(set_id,version,payload,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),payload=VALUES(payload),updated_at=VALUES(updated_at)');
        $missing = 0;
        foreach ($versions as $set => $version) {
            if (isset($stats[$set])) continue;
            if (microtime(true) > $deadline) { $missing++; continue; }
            $stats[$set] = $this->setStats($set, $from, $current);
            $store->execute([$set, $version, json_encode($stats[$set], JSON_THROW_ON_ERROR), $now]);
        }
        $newPatients = array_fill_keys($months, 0);
        foreach ($stats as $set => $st) {
            $pid = $sets[$set] ?? null;
            if (!$pid) continue;
            foreach (['sales' => 'sales', 'collections' => 'collections', 'expenses' => 'expenses', 'payments' => 'expenses', 'income' => 'income'] as $key => $field) {
                foreach ($st[$key] ?? [] as $m => $r) if (isset($partners[$pid][$field][$m])) $partners[$pid][$field][$m] += $r['t'];
            }
            $partners[$pid]['exams'] += $st['exams'][$current]['n'] ?? 0;
            $partners[$pid]['appointments'] += $st['appointments'][$current]['n'] ?? 0;
            $partners[$pid]['newPatients'] += $st['patients'][$current]['n'] ?? 0;
            foreach ($st['patients'] ?? [] as $m => $r) if (isset($newPatients[$m])) $newPatients[$m] += $r['n'];
        }
        // Toplamlar
        $sum = fn(string $f) => array_map(fn($m) => array_sum(array_map(fn($p) => $p[$f][$m], $partners)), array_combine($months, $months));
        $list = array_values($partners);
        $totals = ['partners' => count($list), 'activePartners' => count(array_filter($list, fn($p) => $p['active'])),
            'branches' => array_sum(array_column($list, 'branches')), 'clients' => array_sum(array_column($list, 'clients')), 'patients' => array_sum(array_column($list, 'patients')),
            'staff' => array_sum(array_map(fn($p) => $p['members']['branch'] + $p['members']['staff'], $list)), 'ownerAccounts' => array_sum(array_map(fn($p) => $p['members']['customer'], $list)),
            'trial' => count(array_filter($list, fn($p) => $p['planKind'] === 'trial')), 'paid' => count(array_filter($list, fn($p) => in_array($p['planKind'], ['paid', 'assigned'], true))),
            'none' => count(array_filter($list, fn($p) => $p['planKind'] === null)), 'unsigned' => count(array_filter($list, fn($p) => !$p['agreement'])),
            'exams' => array_sum(array_column($list, 'exams')), 'appointments' => array_sum(array_column($list, 'appointments')), 'newPatients' => array_sum(array_column($list, 'newPatients')),
            'saasRevenue' => array_sum($saasMonthly)];
        return ['generatedAt' => $now, 'partial' => $missing > 0, 'pendingPartners' => $missing, 'months' => $months, 'totals' => $totals,
            'trend' => ['sales' => array_values($sum('sales')), 'collections' => array_values($sum('collections')), 'expenses' => array_values($sum('expenses')),
                'income' => array_values($sum('income')), 'saas' => array_values($saasMonthly), 'newPatients' => array_values($newPatients)],
            'partners' => array_map(function ($p) { foreach (['sales', 'collections', 'expenses', 'income'] as $f) $p[$f] = array_values($p[$f]); return $p; }, $list)];
    }
}
