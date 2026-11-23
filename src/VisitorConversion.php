<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

final class VisitorConversion
{
    private static function phone(string $raw): string
    {
        $digits = preg_replace('/[\s()+-]/', '', $raw);
        if (preg_match('/^0090(5\d{9})$/D', $digits, $match)) $digits = '90'.$match[1];
        elseif (preg_match('/^0(\d{10})$/D', $digits, $match)) $digits = '90'.$match[1];
        elseif (preg_match('/^\d{10}$/D', $digits)) $digits = '90'.$digits;
        return preg_match('/^[1-9]\d{9,14}$/D', $digits) ? '+'.$digits : '';
    }

    /** Validate a first link in the same revision as any newly created owner. */
    public static function validate(object $original, array $visitors, array $clients): void
    {
        $oldVisits = array_column($original->visitors ?? [], null, 'id');
        $oldClients = array_column($original->clients ?? [], null, 'id');
        foreach ($visitors as $visit) {
            $prior = $oldVisits[$visit->id] ?? null;
            $oldId = $prior->client ?? '';
            $id = $visit->client ?? '';
            if ($id === $oldId) continue;
            if ($oldId !== '') throw new RuntimeException('Bağlı hasta sahibi değiştirilemez.', 422);
            $phone = self::phone($visit->phone ?? '');
            $owner = $clients[$id] ?? null;
            if (!$owner || $owner->branch !== $visit->branch || $phone === '' || self::phone($owner->phone ?? '') !== $phone) {
                throw new RuntimeException('Hasta sahibinin şubesini ve telefonunu kontrol edin.', 422);
            }
            if (isset($oldClients[$id])) continue;
            foreach ($clients as $other) {
                if ($other->id !== $id && $other->branch === $visit->branch && self::phone($other->phone ?? '') === $phone) {
                    throw new RuntimeException('Bu telefon için mevcut hasta sahibini seçin.', 409);
                }
            }
        }
    }
}
