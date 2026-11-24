<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;
use stdClass;

/**
 * Yoğun bakım kayıtları: yatışa bağlı vital bulgular ve CRI (sabit hızlı infüzyon) listesi.
 * İkisi de yalnızca eklenebilir; vital satırları değiştirilemez, bir infüzyon yalnızca bir kez durdurulabilir.
 * Kaydı yapan personel ve kayıt saati sunucuda mühürlenir.
 */
final class StayIcu
{
    private const LIMIT = 524288;
    private const VITALS = ['temp' => [25, 45], 'hr' => [10, 400], 'rr' => [2, 200], 'spo2' => [30, 100],
        'sys' => [20, 300], 'dia' => [10, 250], 'glucose' => [10, 1500], 'pain' => [0, 10], 'urine' => [0, 50], 'weight' => [0.01, 1500]];
    private const TEXT = ['crt' => 20, 'mm' => 60, 'mentation' => 60, 'note' => 600];
    private const INFUSION_TEXT = ['drug' => 120, 'dose' => 80, 'fluid' => 120, 'note' => 400];

    private static function invalid(): never
    {
        throw new RuntimeException('Yoğun bakım kaydı geçersiz. Saat, değer aralıklarını ve infüzyon bilgilerini kontrol edin.', 422);
    }

    private static function list(mixed $encoded): array
    {
        if ($encoded === null || $encoded === '') return [];
        if (!is_string($encoded) || strlen($encoded) > self::LIMIT) self::invalid();
        $items = json_decode($encoded);
        if (!is_array($items) || count($items) > 3000) self::invalid();
        $byId = [];
        foreach ($items as $item) {
            if (!$item instanceof stdClass || !is_string($item->id ?? null)
                || !preg_match('/\A[a-zA-Z0-9_-]{1,80}\z/', $item->id) || isset($byId[$item->id])) self::invalid();
            $byId[$item->id] = $item;
        }
        return $byId;
    }

    private static function time(mixed $value): string
    {
        if (!is_string($value) || strlen($value) !== 16) self::invalid();
        $at = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, new DateTimeZone('UTC'));
        if (!$at || $at->format('Y-m-d\TH:i') !== $value) self::invalid();
        return $value;
    }

    private static function number(mixed $value, float $min, float $max): ?string
    {
        if ($value === null || $value === '') return null;
        if (!is_string($value) || !preg_match('/\A-?[0-9]{1,5}([.][0-9]{1,3})?\z/', $value)) self::invalid();
        if ((float)$value < $min || (float)$value > $max) self::invalid();
        return $value;
    }

    private static function text(mixed $value, int $max): ?string
    {
        if ($value === null || $value === '') return null;
        if (!is_string($value) || mb_strlen($value, 'UTF-8') > $max || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) self::invalid();
        $value = trim($value);
        return $value === '' ? null : $value;
    }

    private static function encode(array $items): string
    {
        $encoded = json_encode(array_values($items), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($encoded) > self::LIMIT) self::invalid();
        return $encoded;
    }

    public static function seal(object $stay, ?object $previous, array $actor, int $now): void
    {
        // Eski istemciler bu alanları göndermez; o durumda önceki kayıt aynen korunur.
        foreach (['icuVitals', 'icuInfusions'] as $field) {
            if (!isset($stay->$field) && isset($previous->$field)) $stay->$field = $previous->$field;
        }
        $hasVitals = isset($stay->icuVitals) && $stay->icuVitals !== ($previous->icuVitals ?? null);
        $hasInfusions = isset($stay->icuInfusions) && $stay->icuInfusions !== ($previous->icuInfusions ?? null);
        if (!$hasVitals && !$hasInfusions) return;
        if ($previous && ($stay->patient ?? '') !== ($previous->patient ?? '')
            && (($previous->icuVitals ?? '') !== '' || ($previous->icuInfusions ?? '') !== '')) self::invalid();
        $open = ($stay->status ?? '') === 'Yatışta';
        $start = substr((string)($stay->start ?? ''), 0, 16);
        $latest = gmdate('Y-m-d\TH:i', $now + 2 * 86400);
        $name = mb_substr((string)($actor['name'] ?? ''), 0, 120, 'UTF-8');
        $stamp = gmdate('c', $now);

        if ($hasVitals) {
            $old = self::list($previous->icuVitals ?? '');
            $new = self::list($stay->icuVitals);
            if (array_diff_key($old, $new)) self::invalid();
            $out = [];
            foreach ($new as $id => $item) {
                if (isset($old[$id])) {
                    if (json_encode($item) !== json_encode($old[$id])) self::invalid();
                    $out[$id] = $old[$id];
                    continue;
                }
                if (!$open) self::invalid();
                $row = (object)['id' => $id, 'at' => self::time($item->at ?? null)];
                if (($start !== '' && $row->at < $start) || $row->at > $latest) self::invalid();
                $filled = 0;
                foreach (self::VITALS as $key => [$min, $max]) {
                    $value = self::number($item->$key ?? null, $min, $max);
                    if ($value !== null) { $row->$key = $value; $filled++; }
                }
                foreach (self::TEXT as $key => $max) {
                    $value = self::text($item->$key ?? null, $max);
                    if ($value !== null) { $row->$key = $value; $filled++; }
                }
                if (!$filled) self::invalid();
                $row->by = $name;
                $row->createdAt = $stamp;
                $out[$id] = $row;
            }
            $stay->icuVitals = self::encode($out);
        }

        if ($hasInfusions) {
            $old = self::list($previous->icuInfusions ?? '');
            $new = self::list($stay->icuInfusions);
            if (array_diff_key($old, $new)) self::invalid();
            if (count($new) > 300) self::invalid();
            $out = [];
            foreach ($new as $id => $item) {
                $before = $old[$id] ?? null;
                if ($before) {
                    $same = clone $item;
                    unset($same->stop, $same->stoppedBy);
                    $prior = clone $before;
                    unset($prior->stop, $prior->stoppedBy);
                    if (json_encode($same) !== json_encode($prior)) self::invalid();
                    $row = clone $before;
                    if (!isset($before->stop) && isset($item->stop) && $item->stop !== '') {
                        $row->stop = self::time($item->stop);
                        if ($row->stop < $before->start || $row->stop > $latest) self::invalid();
                        $row->stoppedBy = $name;
                    } elseif (($item->stop ?? null) !== ($before->stop ?? null)) self::invalid();
                    $out[$id] = $row;
                    continue;
                }
                if (!$open || isset($item->stop)) self::invalid();
                $row = (object)['id' => $id, 'start' => self::time($item->start ?? null)];
                if (($start !== '' && $row->start < $start) || $row->start > $latest) self::invalid();
                foreach (self::INFUSION_TEXT as $key => $max) {
                    $value = self::text($item->$key ?? null, $max);
                    if ($value !== null) $row->$key = $value;
                }
                if (!isset($row->drug)) self::invalid();
                $rate = self::number($item->rate ?? null, 0.01, 2000);
                if ($rate === null) self::invalid();
                $row->rate = $rate;
                $volume = self::number($item->volume ?? null, 0.1, 10000);
                if ($volume !== null) $row->volume = $volume;
                $row->by = $name;
                $row->createdAt = $stamp;
                $out[$id] = $row;
            }
            $stay->icuInfusions = self::encode($out);
        }
    }
}
