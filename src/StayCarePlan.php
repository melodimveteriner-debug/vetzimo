<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use RuntimeException;
use stdClass;

/** Per-stay, append-only order history, committed with the stay's workspace revision. */
final class StayCarePlan
{
    private static function orders(string $encoded): array
    {
        if ($encoded === '') return [];
        if (strlen($encoded) > 524288) self::invalid();
        $items = json_decode($encoded);
        if (!is_array($items) || count($items) > 500) self::invalid();
        $byId = [];
        foreach ($items as $item) {
            if (!$item instanceof stdClass || !is_string($item->id ?? null)
                || !preg_match('/\A[a-zA-Z0-9_-]{1,80}\z/', $item->id)
                || isset($byId[$item->id])) self::invalid();
            $byId[$item->id] = $item;
        }
        return $byId;
    }

    private static function invalid(): never
    {
        throw new RuntimeException('Yatış talimatının saatini, açıklamasını ve durumunu kontrol edin.', 422);
    }

    public static function seal(object $stay, ?object $previous, array $actor, int $now): void
    {
        if (!isset($stay->careOrders) && !isset($previous->careOrders)) return;
        $new = self::orders($stay->careOrders ?? '');
        $old = self::orders($previous->careOrders ?? '');
        if (array_diff_key($old, $new)) self::invalid();
        if ($old && $stay->patient !== $previous->patient) self::invalid();

        $open = in_array($stay->status ?? '', ['Planlandı', 'Yatışta'], true);
        $seen = [];
        foreach ($new as $id => $item) {
            $before = $old[$id] ?? null;
            if (!is_string($item->text ?? null) || trim($item->text) === '' || strlen($item->text) > 1600
                || !is_string($item->due ?? null) || strlen($item->due) !== 16 || str_contains($item->due, "\0")
                || !in_array($item->status ?? '', ['pending', 'done', 'cancelled'], true)) self::invalid();
            $due = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $item->due, new \DateTimeZone('UTC'));
            if (!$due || $due->format('Y-m-d\TH:i') !== $item->due) self::invalid();
            if ($before && ($item->text !== $before->text || $item->due !== $before->due)) self::invalid();
            if (!$before && (!$open || $item->status !== 'pending')) self::invalid();
            if ($before && $before->status !== $item->status) {
                if ($before->status !== 'pending') self::invalid();
                if ($item->status === 'done' && !in_array($previous->status ?? '', ['Yatışta'], true)
                    && ($stay->status ?? '') !== 'Yatışta') self::invalid();
            }
            if ($item->status === 'pending') {
                if (!$open) throw new RuntimeException('Taburcu veya iptal işleminden önce bekleyen talimatları sonuçlandırın.', 422);
                if ($item->due < ($stay->start ?? '') || (!empty($stay->end) && $item->due > $stay->end)) self::invalid();
                $key = $item->due . ' ' . trim($item->text);
                if (isset($seen[$key])) self::invalid();
                $seen[$key] = true;
            }
            $sealed = (object) ['id'=>$item->id, 'due'=>$item->due, 'text'=>$item->text, 'status'=>$item->status,
                'createdBy'=>$before->createdBy ?? $actor['name'], 'createdAt'=>$before->createdAt ?? gmdate('c',$now)];
            if ($item->status !== 'pending') {
                $sealed->closedBy = $before->closedBy ?? $actor['name'];
                $sealed->closedAt = $before->closedAt ?? gmdate('c',$now);
            }
            $new[$id] = $sealed;
        }
        $encoded = json_encode(array_values($new), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($encoded) > 524288) self::invalid();
        $stay->careOrders = $encoded;
    }
}
