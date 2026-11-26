<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

final class UiLocale
{
    public const LANGUAGES = ['tr','en','es','de','ja','fr','pt','ru','it','nl','ko','id','zh','fa'];
    private const COUNTRY = [
        'tr'=>'TR','en'=>'US GB AU NZ IE ZA NG KE GH SG PH IN PK','es'=>'ES MX AR BO CL CO CR CU DO EC SV GT HN NI PA PY PE PR UY VE GQ',
        'de'=>'DE AT LI','ja'=>'JP','fr'=>'FR MC SN CI BF BJ TG GN ML NE CD CG GA CM TD MG HT',
        'pt'=>'PT BR AO MZ CV GW ST','ru'=>'RU BY KZ KG','it'=>'IT SM VA','nl'=>'NL SR','ko'=>'KR KP','id'=>'ID','zh'=>'CN TW HK MO','fa'=>'IR AF',
    ];
    private const MULTILINGUAL=['BE'=>['nl','fr','de'],'CH'=>['de','fr','it'],'CA'=>['en','fr'],'LU'=>['fr','de']];

    public static function choose(mixed $manual, mixed $saved, string $country, string $accept): string
    {
        foreach ([$manual,$saved] as $setting) {
            if (is_string($setting) && in_array($setting,self::LANGUAGES,true)) return $setting;
        }
        $choices=[];
        foreach (explode(',',substr($accept,0,2048)) as $entry) {
            if (!preg_match('/\A\s*([a-z]{2,3})(?:-[a-z0-9]{1,8})*(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*\z/iD',$entry,$match)) continue;
            $language=strtolower($match[1]);
            $weight=(float)($match[2] ?? 1);
            if ($weight>0 && in_array($language,self::LANGUAGES,true)) $choices[$language]=max($choices[$language] ?? 0,$weight);
        }
        arsort($choices,SORT_NUMERIC);
        $country=strtoupper(trim($country));
        if (isset(self::MULTILINGUAL[$country])) {
            return (array_values(array_intersect(array_keys($choices),self::MULTILINGUAL[$country]))[0] ?? self::MULTILINGUAL[$country][0]);
        }
        foreach (self::COUNTRY as $language=>$codes) {
            if (in_array($country,explode(' ',$codes),true)) return $language;
        }
        return array_key_first($choices) ?? 'tr';
    }

    public static function page(string $html, array $config): string
    {
        $requested=$_GET['lang'] ?? null;
        $stored=$_COOKIE['vetzimo_ui_lang'] ?? null;
        $manual=is_string($requested) && in_array($requested,self::LANGUAGES,true);
        $auto=$requested==='auto';
        $countryKey=$config['countryLanguageServerKey'] ?? '';
        $country='';
        foreach (array_filter([$countryKey,'GEOIP_COUNTRY_CODE','REDIRECT_GEOIP_COUNTRY_CODE','MM_COUNTRY_CODE','HTTP_CF_IPCOUNTRY']) as $key) {
            $candidate=strtoupper(trim((string)($_SERVER[$key] ?? '')));
            if (preg_match('/\A[A-Z]{2}\z/D',$candidate) && $candidate!=='XX') {
                $country=$candidate;
                break;
            }
        }
        $saved=$auto ? null : $stored;
        $locale=self::choose($requested,$saved,$country,(string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''));
        $mode=$manual || (is_string($saved) && in_array($saved,self::LANGUAGES,true)) ? 'manual' : 'auto';
        if ($manual || $auto) setcookie('vetzimo_ui_lang',$manual?$locale:'',[
            'expires'=>$manual?time()+31536000:1,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Lax',
        ]);
        header('Vary: Accept-Language, Cookie, CF-IPCountry',false);
        $html = preg_replace('~<html lang="tr"~i', '<html lang="'.$locale.'"', $html, 1) ?? $html;
        return str_replace('</head>',
            '<meta name="vetzimo-language" content="'.$locale.'" data-mode="'.$mode.'"><link rel="stylesheet" href="/ui-locale.css?v=r64">'.
            '<script type="module" src="/ui-locale.js?v=20261123-r64"></script>'.
            ($locale!=='tr'?'<link rel="preload" as="fetch" href="/ui-copy/'.$locale.'.json?v=r121" crossorigin><script type="module" src="/ui-copy.js?v=r106"></script>':'').'</head>',$html);
    }
}
