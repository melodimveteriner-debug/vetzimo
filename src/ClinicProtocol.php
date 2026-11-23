<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

final class ClinicProtocol
{
    public const COLLECTIONS = ['clients','patients'];
    public static function seal(string $collection, object $row, ?object $prior): void
    {
        $existing = $prior->protocol ?? '';
        $row->protocol = trim($existing) !== '' ? $existing : ($collection === 'clients' ? 'HS-' : 'HT-').$row->id;
    }
}
