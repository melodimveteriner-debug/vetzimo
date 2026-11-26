<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;

/**
 * Yönetici (merkez) gelişmiş panel verisi: tüm bayiler, şubeler, hasta sahipleri, hastalar, üyelikler, abonelikler,
 * bayi gelir-gider (satış, tahsilat, gider, tedarikçi ödemesi) ve son 12 ay eğilimleri. Toplama veritabanında yapılır
 * ve 10 dakika önbelleğe alınır; milyonlarca kayıtta panel her açılışta tablo taramaz.
 */
final class CenterAnalytics
{
    private const CACHE_ID = '00000000000000000000000000000003';
    private const TTL = 600;

    public function __construct(private readonly PDO $db) {}

    public function get(bool $refresh, int $now): array
    {
        if (!$refresh) {
            $q = $this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='analytics_cache'");
            $q->execute([self::CACHE_ID]);
            $cached = json_decode((string)$q->fetchColumn(), true);
            if (is_array($cached) && ($cached['generatedAt'] ?? 0) > $now - self::TTL) return $cached;
        }
        $data = $this->compute($now);
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'analytics_cache',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([self::CACHE_ID, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        return $data;
    }

    private function months(int $now): array
    {
        $d = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->modify('first day of this month');
        $out = [];
        for ($i = 11; $i >= 0; $i--) $out[] = $d->modify("-$i months")->format('Y-m');
        return $out;
    }

    /** collection içindeki kayıtları set ve aya göre toplar (tutar kuruş). */
    private function monthly(string $collection, string $from, string $amountExpr = "'$.amount'", string $extra = ''): array
    {
        $date = $collection === 'patients' ? "'$.registered'" : "'$.date'";
        $sql = "SELECT set_id, LEFT(JSON_UNQUOTE(JSON_EXTRACT(record_data,$date)),7) AS m, COUNT(*) AS n,
                COALESCE(SUM(ROUND(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_data,$amountExpr)),'') AS DECIMAL(16,2))*100)),0) AS total
            FROM clinic_record WHERE collection=? AND JSON_UNQUOTE(JSON_EXTRACT(record_data,$date))>=? $extra GROUP BY set_id,m";
        $q = $this->db->prepare($sql);
        $q->execute([$collection, $from]);
        return $q->fetchAll(PDO::FETCH_ASSOC);
    }

    private function compute(int $now): array
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
        // Bayi gelir-gider ve klinik etkinliği
        $put = function (array $rows, string $field, bool $count = false) use (&$partners, $sets) {
            foreach ($rows as $r) {
                $pid = $sets[$r['set_id']] ?? null;
                if (!$pid || !isset($partners[$pid][$field][$r['m']])) continue;
                $partners[$pid][$field][$r['m']] += $count ? (int)$r['n'] : (int)$r['total'];
            }
        };
        $put($this->monthly('sales', $from), 'sales');
        $put($this->monthly('collections', $from), 'collections');
        $put($this->monthly('expenses', $from, "'$.amount'", "AND JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.type'))='Gider'"), 'expenses');
        $put($this->monthly('payments', $from), 'expenses');
        $put($this->monthly('expenses', $from, "'$.amount'", "AND JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.type'))='Gelir'"), 'income');
        foreach (['exams' => 'exams', 'appointments' => 'appointments', 'patients' => 'newPatients'] as $col => $field) {
            foreach ($this->monthly($col, $current.'-01', "'$.id'") as $r) { $pid = $sets[$r['set_id']] ?? null; if ($pid && $r['m'] === $current) $partners[$pid][$field] += (int)$r['n']; }
        }
        $newPatients = array_fill_keys($months, 0);
        foreach ($this->monthly('patients', $from, "'$.id'") as $r) if (isset($newPatients[$r['m']])) $newPatients[$r['m']] += (int)$r['n'];
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
        return ['generatedAt' => $now, 'months' => $months, 'totals' => $totals,
            'trend' => ['sales' => array_values($sum('sales')), 'collections' => array_values($sum('collections')), 'expenses' => array_values($sum('expenses')),
                'income' => array_values($sum('income')), 'saas' => array_values($saasMonthly), 'newPatients' => array_values($newPatients)],
            'partners' => array_map(function ($p) { foreach (['sales', 'collections', 'expenses', 'income'] as $f) $p[$f] = array_values($p[$f]); return $p; }, $list)];
    }
}
