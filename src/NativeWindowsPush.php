<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use RuntimeException;

final class NativeWindowsPush
{
    private string $accessToken='';
    private int $expires=0;

    public function __construct(private readonly array $settings) {}

    public static function configured(array $settings): bool
    {
        foreach (['tenant','client'] as $key) {
            if (!is_string($settings[$key]??null) ||
                !preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/iD',$settings[$key])) return false;
        }
        return is_string($settings['secret']??null) && trim($settings['secret'])!=='';
    }

    public static function channelAllowed(string $url): bool
    {
        if (strlen($url)>3072 || preg_match('/[\x00-\x20\x7f\\\\]/',$url)) return false;
        $parts=parse_url($url);
        if (!$parts || ($parts['scheme']??'')!=='https' ||
            isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['fragment']) ||
            !preg_match('/\A(?:[a-z0-9-]+\.)+notify\.windows\.com\z/iD',$parts['host']??'')) return false;
        return preg_match('~\A/[A-Za-z0-9/_-]*\z~D',$parts['path']??'/')===1 &&
            preg_match('~\Atoken=[A-Za-z0-9%+/_=.-]+\z~Di',$parts['query']??'')===1;
    }

    private function post(string $url,string $body,array $headers): array
    {
        $curl=curl_init($url);
        if ($curl===false) throw new RuntimeException('WNS bağlantısı başlatılamadı.');
        curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_HTTPHEADER=>$headers,
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,
            CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>9]);
        $response=curl_exec($curl);
        return [(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE),is_string($response)?$response:''];
    }

    private function token(): string
    {
        $now=time();
        if ($this->expires>$now+60) return $this->accessToken;
        [$status,$body]=$this->post('https://login.microsoftonline.com/'.$this->settings['tenant'].'/oauth2/v2.0/token',
            http_build_query(['grant_type'=>'client_credentials','client_id'=>$this->settings['client'],
                'client_secret'=>$this->settings['secret'],'scope'=>'https://wns.windows.com/.default']),
            ['Content-Type: application/x-www-form-urlencoded']);
        $value=json_decode($body,true);
        if ($status!==200 || !is_string($value['access_token']??null) ||
            !preg_match('/\A[A-Za-z0-9._~-]+\z/D',$value['access_token'])) throw new RuntimeException('WNS yetkilendirme başarısız.');
        $this->accessToken=$value['access_token'];
        $this->expires=$now+min(3600,(int)($value['expires_in']??0));
        return $this->accessToken;
    }

    public static function toast(string $id,bool $audible): string
    {
        if (!preg_match('/\A[1-9][0-9]{0,18}\z/D',$id)) throw new RuntimeException('Bildirim kimliği geçersiz.');
        return '<toast launch="'.$id.'"><visual><binding template="ToastGeneric"><text>VetZimo</text><text>VetZimo • 🔔</text></binding></visual>'.
            ($audible?'':'<audio silent="true"/>').'</toast>';
    }

    public function send(string $channel,string $id,bool $audible): string
    {
        if (!self::channelAllowed($channel)) return 'unregistered';
        [$status]=$this->post($channel,self::toast($id,$audible),['Content-Type: text/xml; charset=utf-8',
            'X-WNS-Type: wns/toast','X-WNS-TTL: 1800','Authorization: Bearer '.$this->token()]);
        if ($status===200) return 'sent';
        if ($status===404 || $status===410) return 'unregistered';
        if ($status===401) $this->expires=0;
        return 'retry';
    }
}
