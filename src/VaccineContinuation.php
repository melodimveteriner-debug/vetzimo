<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;

/**
 * Aşı devamları: her hasta + aşı için son yapılan dozdan sonra planlanmış doz yoksa, Aşı Listesi'ndeki yenileme
 * aralığına göre bir sonraki aşıyı "Planlandı" olarak oluşturur. Başka programlardan (KolayVET vb.) aktarımda
 * yalnız yapılmış dozlar geldiği ve yenileme birimleri farklı yazıldığı ("aylık", "yil") için devamlar görünmüyordu.
 * Kurallar: iptal edilenler sayılmaz; pasif hasta atlanır; 1 yıldan eski gecikmeler oluşturulmaz (hasta artık
 * gelmiyor olabilir, yüzlerce sahte "gecikmiş aşı" birikmesin); aynı gün aynı aşı varsa yeniden eklenmez.
 */
final class VaccineContinuation
{
    public const STALE_DAYS = 365;

    /** "aylık", "Ay", "ay", "month", "Yıllık", "yil"… → Gün | Hafta | Ay | Yıl ('' tanınmazsa) */
    public static function unit(?string $value): string
    {
        $v = mb_strtolower(trim((string)$value), 'UTF-8');
        $v = strtr($v, ['ı' => 'i', 'ü' => 'u', 'ö' => 'o', 'ş' => 's', 'ç' => 'c', 'ğ' => 'g']);
        if ($v === '') return '';
        return match (true) {
            str_starts_with($v, 'gun') || str_starts_with($v, 'day') || $v === 'g' || $v === 'd' => 'Gün',
            str_starts_with($v, 'haf') || str_starts_with($v, 'week') || $v === 'h' || $v === 'w' => 'Hafta',
            str_starts_with($v, 'ay') || str_starts_with($v, 'mon') || $v === 'a' || $v === 'm' => 'Ay',
            str_starts_with($v, 'yil') || str_starts_with($v, 'year') || $v === 'y' => 'Yıl',
            default => '',
        };
    }

    /** Uygulama tarihine aralık ekler (ay sonu taşmaz: 31 Ocak + 1 ay = 28/29 Şubat). */
    public static function next(string $date, int $every, string $unit): string
    {
        $unit = self::unit($unit);
        if ($every < 1 || $unit === '' || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $date)) return '';
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('UTC'));
        if (!$d) return '';
        if ($unit === 'Gün') return $d->modify('+'.$every.' days')->format('Y-m-d');
        if ($unit === 'Hafta') return $d->modify('+'.($every * 7).' days')->format('Y-m-d');
        $months = $unit === 'Yıl' ? $every * 12 : $every;
        $first = $d->modify('first day of this month')->modify('+'.$months.' months');
        $day = min((int)$d->format('j'), (int)$first->format('t'));
        return $first->setDate((int)$first->format('Y'), (int)$first->format('n'), $day)->format('Y-m-d');
    }

    private static function key(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', mb_strtolower($text, 'UTF-8')) ?? '');
    }

    /**
     * @return array{units:array<string,string>,add:list<object>,skippedOld:int}
     *   units: düzeltilecek Aşı Listesi birimleri (id → yeni birim); add: eklenecek planlı aşılar.
     */
    public static function plan(object $state, string $today, ?string $branch = null): array
    {
        $units = [];
        $catalogById = [];
        $catalogByName = [];
        foreach ($state->vaccineCatalog ?? [] as $c) {
            if ($branch !== null && ($c->branch ?? '') !== $branch) continue;
            $norm = self::unit($c->renewUnit ?? '');
            if (($c->renewUnit ?? '') !== '' && $norm !== '' && $norm !== $c->renewUnit) $units[$c->id] = $norm;
            if (($c->status ?? '') === 'Pasif') continue;
            $catalogById[$c->id] = $c;
            $catalogByName[($c->branch ?? '').'|'.self::key((string)($c->name ?? ''))][] = $c;
        }
        $patients = array_column($state->patients ?? [], null, 'id');
        $groups = [];
        foreach ($state->followups ?? [] as $f) {
            if (($f->kind ?? '') !== 'Aşı' || ($f->status ?? '') === 'İptal') continue;
            if ($branch !== null && ($f->branch ?? '') !== $branch) continue;
            $groups[($f->branch ?? '').'|'.($f->patient ?? '').'|'.self::key((string)($f->title ?? ''))][] = $f;
        }
        $stale = (new DateTimeImmutable($today, new DateTimeZone('UTC')))->modify('-'.self::STALE_DAYS.' days')->format('Y-m-d');
        $add = [];
        $skippedOld = 0;
        foreach ($groups as $rows) {
            $last = null;
            $planned = false;
            foreach ($rows as $f) {
                $done = (string)($f->done ?? '');
                if (($f->status ?? '') === 'Tamamlandı' && preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $done)) {
                    if (!$last || $done > (string)$last->done) $last = $f;
                }
            }
            if (!$last) continue;
            foreach ($rows as $f) {
                if (($f->status ?? '') !== 'Tamamlandı' && empty($f->done) && (string)($f->date ?? '') >= (string)$last->done) { $planned = true; break; }
                if ($f !== $last && ($f->status ?? '') === 'Tamamlandı' && (string)($f->done ?? '') === (string)$last->done && ($f->previousId ?? '') === $last->id) { $planned = true; break; }
            }
            if ($planned) continue;
            $patient = $patients[$last->patient ?? ''] ?? null;
            if (!$patient || ($patient->status ?? '') === 'Pasif' || !empty($patient->deceased)) continue;
            // Aralık: kayıttaki aralık (sihirbazdan) > Aşı Listesi kimliği > aynı adlı tanım (hastanın türüne uygun olan önce)
            $every = 0; $unit = '';
            if (isset($last->renewEvery) && (string)$last->renewEvery !== '') { $every = (int)$last->renewEvery; $unit = (string)($last->renewUnit ?? ''); }
            else {
                $cat = $catalogById[$last->vaccine ?? ''] ?? null;
                if (!$cat) {
                    $same = $catalogByName[($last->branch ?? '').'|'.self::key((string)($last->title ?? ''))] ?? [];
                    usort($same, static fn($a, $b) => (int)(self::key((string)($b->species ?? '')) === self::key((string)($patient->species ?? ''))) <=> (int)(self::key((string)($a->species ?? '')) === self::key((string)($patient->species ?? ''))));
                    $cat = $same[0] ?? null;
                }
                if ($cat) { $every = (int)($cat->renewEvery ?? 0); $unit = (string)($cat->renewUnit ?? ''); }
            }
            $next = self::next((string)$last->done, $every, $unit);
            if ($next === '') continue;
            if ($next < $stale) { $skippedOld++; continue; }
            $add[] = (object)['id' => 'vc-'.substr(hash('sha256', $last->id.'|'.$next), 0, 24), 'branch' => $last->branch, 'patient' => $last->patient,
                'kind' => 'Aşı', 'title' => $last->title, 'vaccine' => $last->vaccine ?? '', 'date' => $next, 'status' => 'Planlandı',
                'previousId' => $last->id, 'createdAt' => $today, 'createdBy' => 'Aşı devamı (otomatik)'];
        }
        return ['units' => $units, 'add' => $add, 'skippedOld' => $skippedOld];
    }

    /** Planı duruma uygular (birim düzeltmesi + yeni planlı aşılar). @return array{added:int,units:int,skippedOld:int} */
    public static function apply(object $state, string $today, ?string $branch = null): array
    {
        $plan = self::plan($state, $today, $branch);
        foreach ($state->vaccineCatalog ?? [] as $c) if (isset($plan['units'][$c->id])) $c->renewUnit = $plan['units'][$c->id];
        $ids = array_flip(array_column($state->followups ?? [], 'id'));
        $added = 0;
        foreach ($plan['add'] as $row) {
            if (isset($ids[$row->id])) continue;
            $state->followups[] = $row;
            $added++;
        }
        return ['added' => $added, 'units' => count($plan['units']), 'skippedOld' => $plan['skippedOld']];
    }

    /** Uç nokta: önizleme (GET) veya uygulama (POST). Çalışma alanı satırı kilitlenir; eşzamanlı uygulamalar çift kayıt oluşturmaz. */
    public static function run(\PDO $db, WorkspaceRepository $workspaces, array $actor, bool $apply, int $now, ?int $revision = null): array
    {
        if (!ClinicAccess::allowed($actor, 'followups', $apply)) throw new RuntimeException('Aşı ve takip yetkisi gerekir.', 403);
        $today = (new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
        $workspace = 'partner:'.$actor['partner_id'];
        $branch = null;
        if (($actor['role'] ?? '') !== 'dealer') {
            $branch = (string)($actor['branch_id'] ?? '');
            if ($branch === '') throw new RuntimeException('Şube seçimi gerekli.', 403);
        }
        if (!$apply) {
            $current = $workspaces->load($workspace);
            if ($branch !== null) { $b = ClinicAccess::branch($current['state'], $branch); $branch = $b ? (($b->sharedWith ?? '') ?: $b->id) : $branch; }
            $plan = self::plan($current['state'], $today, $branch);
            return ['count' => count($plan['add']), 'units' => count($plan['units']), 'skippedOld' => $plan['skippedOld'],
                'sample' => array_map(static fn($r) => ['patient' => $r->patient, 'title' => $r->title, 'date' => $r->date], array_slice($plan['add'], 0, 8))];
        }
        $db->beginTransaction();
        try {
            $lock = $db->prepare('SELECT revision FROM clinic_workspace WHERE user_id=? FOR UPDATE');
            $lock->execute([$workspace]);
            $head = (int)$lock->fetchColumn();
            $current = $workspaces->load($workspace);
            if ($head < 1 || $current['revision'] !== $head) throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.', 409);
            $state = $current['state'];
            if ($branch !== null) { $b = ClinicAccess::branch($state, $branch); $branch = $b ? (($b->sharedWith ?? '') ?: $b->id) : $branch; }
            $result = self::apply($state, $today, $branch);
            $saved = $head;
            if ($result['added'] || $result['units']) {
                $saved = $workspaces->save($workspace, $head, $state);
                if ($saved === null) throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.', 409);
                $db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)')
                    ->execute([$actor['partner_id'], $actor['account_id'], 'followups.continued', $saved]);
            }
            $db->commit();
            return $result + ['revision' => $saved, 'since' => $head];
        } catch (\Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    }
}
