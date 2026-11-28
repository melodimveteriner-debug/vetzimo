<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Kalanı indirimle kapatma (sunucuda): kısmen ödenmiş satışların gerçek kalanı tüm kayıtlardan (arşiv dahil) hesaplanır,
 * seçilen satışların kalanı kasaya girmeyen "İndirim" tahsilat kaydıyla kapatılır. Tarayıcıdaki kopya eski ya da eksik
 * olsa bile "Ödeme toplamı açık bakiyeyi aşamaz" hatası çıkmaz: kalanı olmayan satış atlanır, diğerleri kapanır.
 * Çalışma alanı satırı kilitlenir; eşzamanlı istekler aynı satışı iki kez kapatamaz.
 */
final class SaleDiscounts
{
    public const METHOD = 'İndirim';

    /** @return array<string,int> satış kimliği → ödenen (ilk tahsilat + ek tahsilatlar, borç silme/indirim dahil) kuruş */
    private static function settled(object $state): array
    {
        $out = [];
        foreach ($state->collections ?? [] as $c) $out[$c->sale ?? ''] = ($out[$c->sale ?? ''] ?? 0) + Finance::money((string)($c->amount ?? '0'));
        return $out;
    }

    private static function cash(object $state): array
    {
        $out = [];
        foreach ($state->collections ?? [] as $c) {
            if (in_array($c->method ?? '', ['Borç silme', self::METHOD], true)) continue;
            $out[$c->sale ?? ''] = ($out[$c->sale ?? ''] ?? 0) + Finance::money((string)($c->amount ?? '0'));
        }
        return $out;
    }

    private static function visibleBranch(array $actor, object $state): ?string
    {
        if (($actor['role'] ?? '') === 'dealer') return null;
        $b = ClinicAccess::branch($state, (string)($actor['branch_id'] ?? ''));
        return $b ? (($b->sharedWith ?? '') ?: $b->id) : '-';
    }

    public static function candidates(object $state, ?string $branch): array
    {
        $settled = self::settled($state); $cash = self::cash($state);
        $clients = array_column($state->clients ?? [], 'name', 'id');
        $rows = [];
        foreach ($state->sales ?? [] as $s) {
            if (($s->status ?? '') === 'İptal' || ($branch !== null && ($s->branch ?? '') !== $branch)) continue;
            $amount = Finance::money((string)($s->amount ?? '0')); $paid = Finance::money((string)($s->paid ?? '0'));
            $rem = $amount - $paid - ($settled[$s->id] ?? 0);
            $got = $paid + ($cash[$s->id] ?? 0);
            if ($rem <= 0 || $got <= 0) continue;
            $rows[] = ['id' => $s->id, 'client' => (string)($s->client ?? ''), 'clientName' => (string)($clients[$s->client ?? ''] ?? ''), 'date' => (string)($s->date ?? ''),
                'detail' => (string)($s->detail ?? ''), 'amount' => $amount, 'paid' => $got, 'remaining' => $rem];
        }
        usort($rows, static fn($a, $b) => $a['remaining'] * max(1, $b['amount']) <=> $b['remaining'] * max(1, $a['amount']));
        return $rows;
    }

    private static function guard(array $actor, bool $write): void
    {
        if (!ClinicAccess::allowed($actor, 'sales') || !ClinicAccess::allowed($actor, 'collections', $write)) throw new RuntimeException('Satış ve tahsilat yetkisi gerekir.', 403);
        if ($write && !ClinicAccess::action($actor, 'deleteCollections', true)) throw new RuntimeException('Tahsilat indirimi için yönetici veya "Tahsilat iptali" yetkisi gerekir.', 403);
    }

    public static function list(WorkspaceRepository $workspaces, array $actor): array
    {
        self::guard($actor, false);
        $state = $workspaces->load('partner:'.$actor['partner_id'])['state'];
        $rows = self::candidates($state, self::visibleBranch($actor, $state));
        return ['items' => array_slice($rows, 0, 5000), 'count' => count($rows), 'total' => array_sum(array_column($rows, 'remaining'))];
    }

    /** @param list<string> $ids */
    public static function close(PDO $db, WorkspaceRepository $workspaces, array $actor, array $ids, int $now): array
    {
        self::guard($actor, true);
        $ids = array_values(array_unique(array_filter($ids, static fn($id) => is_string($id) && preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $id))));
        if (!$ids || count($ids) > 5000) throw new RuntimeException('Kapatılacak satışları seçin (en çok 5000).', 422);
        $workspace = 'partner:'.$actor['partner_id'];
        $today = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
        $db->beginTransaction();
        try {
            $lock = $db->prepare('SELECT revision FROM clinic_workspace WHERE user_id=? FOR UPDATE');
            $lock->execute([$workspace]);
            $head = (int)$lock->fetchColumn();
            $current = $workspaces->load($workspace);
            if ($head < 1 || $current['revision'] !== $head) throw new RuntimeException('Kayıtlar güncellendi. Tekrar deneyin.', 409);
            $state = $current['state'];
            $branch = self::visibleBranch($actor, $state);
            $open = array_column(self::candidates($state, $branch), null, 'id');
            $sales = array_column($state->sales ?? [], null, 'id');
            $closed = 0; $skipped = 0; $sum = 0; $new = [];
            foreach ($ids as $id) {
                $row = $open[$id] ?? null;
                if (!$row) { $skipped++; continue; }
                $sale = $sales[$id];
                $c = (object)['id' => 'ind-'.bin2hex(random_bytes(10)), 'branch' => $sale->branch, 'sale' => $id, 'date' => max((string)$sale->date, $today),
                    'amount' => number_format($row['remaining'] / 100, 2, '.', ''), 'method' => self::METHOD, 'notes' => 'Tahsilat indirimi',
                    'createdAt' => gmdate('c', $now), 'createdBy' => (string)($actor['name'] ?? '')];
                $state->collections[] = $c; $new[] = $c;
                $closed++; $sum += $row['remaining'];
            }
            $saved = $head;
            if ($new) {
                $saved = $workspaces->save($workspace, $head, $state);
                if ($saved === null) throw new RuntimeException('Kayıtlar güncellendi. Tekrar deneyin.', 409);
                $ledger = $db->prepare('INSERT INTO finance_entry(partner_id,branch_id,source_type,source_id,entry_date,amount_cents,account_id) VALUES (?,?,?,?,?,?,?)');
                foreach ($new as $c) $ledger->execute([$actor['partner_id'], $c->branch, 'collections', $c->id, $c->date, 0, $actor['account_id']]);
                $db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)')->execute([$actor['partner_id'], $actor['account_id'], 'collections.discounted', $saved]);
            }
            $db->commit();
            return ['closed' => $closed, 'skipped' => $skipped, 'total' => $sum, 'revision' => $saved, 'since' => $head];
        } catch (\Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    }
}
