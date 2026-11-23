<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

final class GoogleRoadRoutes
{
    public const MAX_STOPS=15;

    public static function apiKey(array $config): string
    {
        return trim((string)(getenv('VETNET_GOOGLE_ROUTES_API_KEY') ?: ($config['googleRoutesApiKey']??'')));
    }

    public static function coordinates(mixed $lat,mixed $lon): ?array
    {
        if (!is_numeric($lat)||!is_numeric($lon)) return null;
        $lat=(float)$lat;
        $lon=(float)$lon;
        if (!is_finite($lat)||!is_finite($lon)||abs($lat)>90||abs($lon)>180) return null;
        return ['latitude'=>round($lat,5),'longitude'=>round($lon,5)];
    }

    public function matrix(string $key,array $start,array $stops): array
    {
        if ($key==='') throw new RuntimeException('Google yol hesabı için sunucuya Routes API anahtarı eklenmeli.',503);
        if (!function_exists('curl_init')) throw new RuntimeException('Google yol hesabı için sunucuda PHP cURL etkin olmalı.',503);
        $waypoint=static fn(array $coordinates)=>['waypoint'=>['location'=>['latLng'=>$coordinates]]];
        $payload=['origins'=>array_map($waypoint,[$start,...$stops]),'destinations'=>array_map($waypoint,$stops),
            'travelMode'=>'DRIVE','routingPreference'=>'TRAFFIC_UNAWARE'];
        $transfer=curl_init('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
        curl_setopt_array($transfer,[
            CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Goog-Api-Key: '.$key,
                'X-Goog-FieldMask: originIndex,destinationIndex,status,condition,distanceMeters,duration'],
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>12,
        ]);
        try {
            $body=curl_exec($transfer);
            $status=(int)curl_getinfo($transfer,CURLINFO_RESPONSE_CODE);
        } finally {
            unset($transfer); // curl_close PHP 8.5 itibarıyla kullanımdan kalktı
        }
        if ($status===429) throw new RuntimeException('Google yol hesabı kotası dolu. Daha sonra yeniden deneyin.',503);
        if (in_array($status,[400,401,403],true)) throw new RuntimeException('Google yol hesabı reddedildi. Routes API ayarlarını ve anahtar izinlerini kontrol edin.',503);
        $elements=is_string($body)&&$status===200?json_decode($body,true):null;
        if (!is_array($elements)||!array_is_list($elements)) throw new RuntimeException('Google yol mesafeleri şu anda alınamadı. Yeniden deneyin.',502);
        return self::parse($elements,count($stops));
    }

    public static function parse(array $elements,int $count): array
    {
        $matrix=array_fill(0,$count+1,array_fill(0,$count,null));
        foreach ($elements as $item) {
            if (($item['condition']??'')!=='ROUTE_EXISTS'||($item['status']['code']??0)!==0) continue;
            // Protobuf JSON can omit scalar fields with a value of zero.
            $origin=$item['originIndex']??0;
            $destination=$item['destinationIndex']??0;
            $meters=$item['distanceMeters']??0;
            $duration=$item['duration']??null;
            if (!is_int($origin)||!is_int($destination)||!isset($matrix[$origin])||$destination<0||$destination>=$count||
                !is_int($meters)||$meters<0||!is_string($duration)||!preg_match('/\A([0-9]+)(?:\.[0-9]+)?s\z/D',$duration,$matches)) continue;
            $matrix[$origin][$destination]=['meters'=>$meters,'seconds'=>(int)$matches[1]];
        }
        return $matrix;
    }
}
