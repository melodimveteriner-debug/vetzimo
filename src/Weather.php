<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

final class Weather
{
    public static function read(string $city,array $query,string $apiKey,string $origin): array
    {
        $cityKey=strtolower(strtr(trim($city),['İ'=>'i','I'=>'i','ı'=>'i','Ş'=>'s','ş'=>'s','Ç'=>'c','ç'=>'c',
            'Ü'=>'u','ü'=>'u','Ö'=>'o','ö'=>'o','Ğ'=>'g','ğ'=>'g']));
        $cities=json_decode(file_get_contents(dirname(__DIR__).'/weather-cities.json'),true,32,JSON_THROW_ON_ERROR);
        $device=isset($query['lat'],$query['lon']);
        $position=$device ? [$query['lat'],$query['lon']] : ($cities[$cityKey] ?? []);
        if (count($position)!==2 || !is_numeric($position[0]) || !is_numeric($position[1]) ||
            abs((float)$position[0])>90 || abs((float)$position[1])>180) return ['reason'=>'location','city'=>$city];
        if ($device) $city='Cihaz konumu';
        if ($apiKey==='') return self::met($position,$city,$origin);
        if (!function_exists('curl_init')) return ['reason'=>'unavailable','city'=>$city];
        $parameters=['latitude'=>round((float)$position[0],1),'longitude'=>round((float)$position[1],1),
            'current'=>'temperature_2m,weather_code,is_day','daily'=>'temperature_2m_max,temperature_2m_min',
            'timezone'=>'auto','forecast_days'=>1,'apikey'=>$apiKey];
        $key='vetnet-weather:'.hash('sha256',json_encode($parameters));
        if (function_exists('apcu_fetch') && ($cached=apcu_fetch($key))!==false) return $cached+['city'=>$city];
        $curl=curl_init('https://customer-api.open-meteo.com/v1/forecast?'.http_build_query($parameters));
        curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>6]);
        $response=curl_exec($curl);
        $status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        $data=$status===200 && is_string($response)?json_decode($response,true):null;
        $result=['temperature'=>$data['current']['temperature_2m'] ?? null,'code'=>$data['current']['weather_code'] ?? null,
            'day'=>$data['current']['is_day'] ?? null,'high'=>$data['daily']['temperature_2m_max'][0] ?? null,
            'low'=>$data['daily']['temperature_2m_min'][0] ?? null];
        foreach ($result as $value) if (!is_int($value) && !is_float($value)) return self::met($position,$city,$origin);
        if (function_exists('apcu_store')) apcu_store($key,$result,900);
        return $result+['city'=>$city];
    }
    private static function met(array $position,string $city,string $origin): array
    {
        $failure=['reason'=>'unavailable','city'=>$city];
        if (!function_exists('curl_init')) return $failure;
        $coordinates=http_build_query(['lat'=>round((float)$position[0],1),'lon'=>round((float)$position[1],1)]);
        $key='vetnet-met:'.hash('sha256',$coordinates);
        $file=sys_get_temp_dir().'/'.hash('sha256',__DIR__.$key).'.json';
        $cached=is_file($file)?json_decode((string)@file_get_contents($file),true):null;
        if (is_array($cached) && ($cached['expires'] ?? 0)>time()) return $cached['data']+['city'=>$city];
        $expires=0;
        $curl=curl_init('https://api.met.no/weatherapi/locationforecast/2.0/compact?'.$coordinates);
        curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>6,
            CURLOPT_USERAGENT=>'VetZimo/1.0 (+'.$origin.'/platform/iletisim)',
            CURLOPT_HEADERFUNCTION=>static function($handle,string $line) use (&$expires): int {
                if (stripos($line,'Expires:')===0) $expires=strtotime(trim(substr($line,8))) ?: 0;
                return strlen($line);
            }]);
        $response=curl_exec($curl);
        $status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        $series=$status===200 && is_string($response)?(json_decode($response,true)['properties']['timeseries'] ?? []):[];
        $first=$series[0]['data'] ?? [];
        $temperature=$first['instant']['details']['air_temperature'] ?? null;
        $symbol=$first['next_1_hours']['summary']['symbol_code'] ?? $first['next_6_hours']['summary']['symbol_code'] ?? '';
        if (!is_numeric($temperature) || $symbol==='') return $failure;
        $code=match(true) {
            str_contains($symbol,'snow'),str_contains($symbol,'sleet')=>71,
            str_contains($symbol,'rain'),str_contains($symbol,'thunder')=>61,
            str_contains($symbol,'fog')=>45,
            str_contains($symbol,'cloud')=>3,
            str_contains($symbol,'fair')=>1,
            default=>0,
        };
        $temperatures=[];
        $start=strtotime($series[0]['time'] ?? '') ?: time();
        foreach ($series as $entry) {
            $stamp=strtotime($entry['time'] ?? '');
            if ($stamp===false || $stamp>=$start+86400) break;
            $value=$entry['data']['instant']['details']['air_temperature'] ?? null;
            if (is_numeric($value)) $temperatures[]=(float)$value;
        }
        $result=['temperature'=>(float)$temperature,'code'=>$code,'day'=>!str_contains($symbol,'night'),
            'high'=>$temperatures?max($temperatures):null,'low'=>$temperatures?min($temperatures):null,'provider'=>'MET Norway'];
        $temporary=tempnam(sys_get_temp_dir(),'vet-weather-');
        if ($temporary!==false) {
            if (@file_put_contents($temporary,json_encode(['expires'=>max(time()+900,$expires),'data'=>$result]))!==false) @rename($temporary,$file);
            if (is_file($temporary)) @unlink($temporary);
        }
        return $result+['city'=>$city];
    }

}
