<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

/** Completes one local stock unit per documented application of a linked vaccine. */
final class VaccineInventory
{
    public static function reconcile(object $old, object $next, array $actor, string $today): array
    {
        if ($old->followups == $next->followups && $old->stockMoves == $next->stockMoves) return [];
        $knownMoves = array_column($old->stockMoves, null, 'id');
        foreach ($next->stockMoves as $move) {
            if (!isset($knownMoves[$move->id]) && (isset($move->vaccineRecord) || ($move->source ?? '') === 'Aşı uygulaması')) {
                throw new RuntimeException('Aşı stok hareketi uygulama kaydından oluşturulur.', 422);
            }
        }
        if ($old->followups == $next->followups) return [];
        $previous = array_column($old->followups, null, 'id');
        $catalog = array_column($next->vaccineCatalog, null, 'id');
        $products = array_column($next->products, null, 'id');
        $lots = array_column($next->stockLots, null, 'id');
        $updates = [];
        foreach ($next->followups as $position => $submitted) {
            $prior = $previous[$submitted->id] ?? null;
            if ($prior == $submitted) continue;
            $wasDone = ($prior->status ?? '') === 'Tamamlandı';
            $done = ($submitted->status ?? '') === 'Tamamlandı';
            $oldLot = $prior->vaccineLot ?? '';
            $chosen = $submitted->vaccineLot ?? '';
            if ($wasDone && $done) {
                if ($oldLot !== '' && ($prior->patient !== $submitted->patient ||
                    ($prior->vaccine ?? '') !== ($submitted->vaccine ?? '') ||
                    ($prior->kind ?? '') !== ($submitted->kind ?? '') ||
                    ($prior->done ?? '') !== ($submitted->done ?? '') || ($prior->batch ?? '') !== ($submitted->batch ?? '') || $chosen !== $oldLot)) {
                    throw new RuntimeException('Partiyle kaydedilen uygulamayı düzeltmek için önce uygulamayı geri alın.', 422);
                }
                if ($chosen !== $oldLot) throw new RuntimeException('Parti yalnız uygulama sırasında seçilebilir.', 422);
                continue;
            }
            $linkedProduct = $catalog[$submitted->vaccine ?? '']->product ?? '';
            if ((!$done && $wasDone && $oldLot !== '' || $done && ($submitted->kind ?? '') === 'Aşı' && $linkedProduct !== '') &&
                !ClinicAccess::allowed($actor, 'products', true)) {
                throw new RuntimeException('Aşı stok işlemi için ürün ve stok düzenleme yetkisi gerekir.', 403);
            }
            if (!$done && $wasDone && $oldLot !== '') {
                $lot = $lots[$oldLot] ?? null;
                $delta = 1;
                $date = $today;
            } elseif ($done && ($submitted->kind ?? '') === 'Aşı' && $linkedProduct !== '') {
                $definition = $catalog[$submitted->vaccine];
                $product = $products[$definition->product] ?? null;
                if (!$product || $product->branch !== $submitted->branch || $definition->branch !== $submitted->branch ||
                    ($product->category ?? '') === 'Hizmet' || ($product->track ?? '') === 'Hayır') {
                    throw new RuntimeException('Aşı için şubede stok takibi açık bir ürün seçin.', 422);
                }
                if (!in_array($product->unit ?? '', ['Adet','Doz'], true)) {
                    throw new RuntimeException('Aşı uygulaması için stoğu doz veya adet olarak izlenen bir ürün seçin.',422);
                }
                $date = $submitted->done ?? '';
                if (!preg_match('/\A(\d{4})-(\d{2})-(\d{2})\z/', $date, $parts) ||
                    !checkdate((int)$parts[2], (int)$parts[3], (int)$parts[1]) || $date > $today) {
                    throw new RuntimeException('Geçerli uygulama tarihini girin.', 422);
                }
                $candidates = array_filter($lots, static fn($row) =>
                    $row->branch === $product->branch && $row->product === $product->id);
                if (!$candidates && (int)$product->stock > 0) {
                    $lot = (object)['id'=>'initial-'.$product->id,'branch'=>$product->branch,'product'=>$product->id,
                        'received'=>$product->stock,'remaining'=>$product->stock,'serial'=>$product->batch ?? '',
                        'expiry'=>$product->expiry ?? '','date'=>'','sell'=>$product->price ?? '',
                        'reason'=>'Önceki stok bakiyesi','buy'=>'','supplier'=>'','supplierName'=>''];
                    if (isset($lots[$lot->id]) || strlen($lot->id)>80) throw new RuntimeException('Stok parti kimliği geçersiz.',422);
                    $next->stockLots[] = $lots[$lot->id] = $candidates[$lot->id] = $lot;
                }
                $candidates = array_filter($candidates, static fn($row) => (int)$row->remaining > 0 &&
                    (empty($row->expiry) || $row->expiry >= $date) && (empty($row->date) || $row->date <= $date));
                if (!$candidates) throw new RuntimeException('Uygulama tarihinde kullanılabilir aşı stoku yok.', 422);
                $lot = $chosen === '' && count($candidates) === 1 ? reset($candidates) : ($candidates[$chosen] ?? null);
                $delta = -1;
            } else {
                if ($chosen !== '') throw new RuntimeException('Parti yalnız uygulama sırasında seçilebilir.',422);
                continue;
            }
            if (!$lot || $lot->branch !== $submitted->branch) throw new RuntimeException('Uygulamada kullanılan stok partisini seçin.', 422);
            $remaining = (int)$lot->remaining + $delta;
            if ($remaining < 0 || $remaining > (int)$lot->received) throw new RuntimeException('Parti bakiyesi bu işleme uygun değil.',422);
            $product = $products[$lot->product] ?? null;
            if (!$product || $product->branch !== $submitted->branch) throw new RuntimeException('Stok ürünü bulunamadı.',422);

            // Workspace snapshots may share row objects. Never mutate the original used by Finance::validate.
            $row = clone $submitted;
            $row->vaccineLot = $delta === -1 ? $lot->id : '';
            if ($delta === -1 && !empty($lot->serial)) $row->batch = $lot->serial;
            $next->followups[$position] = $row;
            $lot = clone $lot;
            $lot->remaining = (string)$remaining;
            $lots[$lot->id] = $lot;
            $product = clone $product;
            $product->stock = (string)((int)$product->stock + $delta);
            $products[$product->id] = $product;
            $move = (object)['id'=>bin2hex(random_bytes(16)), 'branch'=>$row->branch, 'product'=>$product->id,
                'lot'=>$lot->id, 'date'=>$date, 'delta'=>(string)$delta, 'balance'=>$lot->remaining,
                'source'=>'Aşı uygulaması', 'reason'=>$delta === -1 ? 'Aşı uygulaması' : 'Aşı uygulaması iadesi',
                'vaccineRecord'=>$row->id, 'createdBy'=>$actor['name']];
            array_unshift($next->stockMoves, $move);
            $updates['stockMoves'][] = $move;
            $updates['stockLots'][$lot->id] = $lot;
            $updates['products'][$product->id] = $product;
            $updates['followups'][$row->id] = $row;
        }
        if ($updates) {
            $next->stockLots = array_values($lots);
            $next->products = array_values($products);
            foreach ($updates as &$rows) $rows = array_values($rows);
        }
        return $updates;
    }
}
