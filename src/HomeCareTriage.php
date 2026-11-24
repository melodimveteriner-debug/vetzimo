<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

/**
 * Evden takip ön değerlendirmesi (sunucu). public/homecare-triage.js ile aynı kuralları ve aynı metin
 * katlama adımlarını uygular; kurallar public/homecare-triage.json dosyasındadır. Tanı koymaz, yönlendirir.
 * Sonuç kliniğin inceleme sırasını ve bildirimlerini belirler; hasta sahibinin tarayıcısındaki sonuç
 * yalnız ekrandaki uyarı içindir, kayda geçen seviye her zaman burada hesaplanır.
 */
final class HomeCareTriage
{
    public const LEVELS = ['routine', 'soon', 'urgent'];
    private const MAP = ['ç'=>'c','ğ'=>'g','ı'=>'i','ö'=>'o','ş'=>'s','ü'=>'u','á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a',
        'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','ó'=>'o','ò'=>'o','ô'=>'o','õ'=>'o','ú'=>'u','ù'=>'u',
        'û'=>'u','ñ'=>'n','ß'=>'ss','œ'=>'oe','æ'=>'ae','ё'=>'е','ي'=>'ی','ك'=>'ک'];
    private static ?array $prepared = null;

    public static function fold(string $text): string
    {
        $text = mb_strtolower($text, 'UTF-8');
        $text = (string)preg_replace('/\p{M}/u', '', $text);
        $text = strtr($text, self::MAP);
        $text = str_replace("\u{200C}", '', $text);
        return trim((string)preg_replace('/\s+/u', ' ', $text));
    }

    private static function prepared(): array
    {
        if (self::$prepared !== null) return self::$prepared;
        $rules = json_decode((string)file_get_contents(dirname(__DIR__).'/public/homecare-triage.json'), true, 16, JSON_THROW_ON_ERROR);
        $groups = static function (array $level): array {
            $out = [];
            foreach ($level as $code => $words) {
                $out[(string)$code] = array_values(array_unique(array_filter(array_map(static fn($word) => self::fold((string)$word), $words), static fn($word) => $word !== '')));
            }
            return $out;
        };
        return self::$prepared = [
            'urgent' => $groups($rules['urgent'] ?? []),
            'soon' => $groups($rules['soon'] ?? []),
            'after' => array_map(static fn($word) => ' '.self::fold((string)$word), $rules['negation']['after'] ?? []),
            'before' => array_map(static fn($word) => self::fold((string)$word).' ', $rules['negation']['before'] ?? []),
        ];
    }

    private static function word(string $char): bool
    {
        return $char !== '' && preg_match('/[\p{L}\p{N}]/u', $char) === 1;
    }

    private static function negated(array $chars, int $start, int $end, array $p): bool
    {
        $tail = $end;
        $count = count($chars);
        while ($tail < $count && self::word($chars[$tail])) $tail++;
        $after = implode('', array_slice($chars, $tail));
        $before = ' '.implode('', array_slice($chars, 0, $start));
        foreach ($p['after'] as $word) if (str_starts_with($after, $word)) return true;
        foreach ($p['before'] as $word) if (str_ends_with($before, ' '.$word)) return true;
        return false;
    }

    private static function found(array $chars, string $text, string $word, array $p): bool
    {
        $boundary = preg_match('/^[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]/u', $word) !== 1;
        $length = mb_strlen($word, 'UTF-8');
        $whole = $boundary && $length <= 4;
        $offset = 0;
        while (($at = mb_strpos($text, $word, $offset, 'UTF-8')) !== false) {
            $offset = $at + 1;
            $end = $at + $length;
            if ($boundary && $at > 0 && self::word($chars[$at - 1])) continue;
            if ($whole && $end < count($chars) && self::word($chars[$end])) continue;
            if (!self::negated($chars, $at, $end, $p)) return true;
        }
        return false;
    }

    /** @return array{level:string,reasons:list<string>} */
    public static function evaluate(string $observation, array $details, string $note): array
    {
        $p = self::prepared();
        $text = self::fold($note);
        $chars = $text === '' ? [] : mb_str_split($text, 1, 'UTF-8');
        $level = 0;
        $reasons = [];
        $raise = static function (int $value, string $code) use (&$level, &$reasons): void {
            $level = max($level, $value);
            if (!in_array($code, $reasons, true)) $reasons[] = $code;
        };
        if ($text !== '') {
            foreach ($p['urgent'] as $code => $words) foreach ($words as $word) if (self::found($chars, $text, $word, $p)) { $raise(2, $code); break; }
            foreach ($p['soon'] as $code => $words) foreach ($words as $word) if (self::found($chars, $text, $word, $p)) { $raise(1, $code); break; }
        }
        if (($details['appetite'] ?? '') === 'none') $raise(1, 'appetite_none');
        if (($details['water'] ?? '') === 'less') $raise(1, 'water_less');
        if (($details['appetite'] ?? '') === 'none' && ($details['activity'] ?? '') === 'less') $raise(1, 'appetite_activity');
        if ($observation === 'contact') $raise(1, 'contact');
        if (($details['medication'] ?? '') === 'missed' && !in_array('med_missed', $reasons, true)) $reasons[] = 'med_missed';
        $urgent = $p['urgent'];
        usort($reasons, static fn($a, $b) => (isset($urgent[$a]) ? 0 : 1) <=> (isset($urgent[$b]) ? 0 : 1));
        return ['level' => self::LEVELS[$level], 'reasons' => $reasons];
    }
}
