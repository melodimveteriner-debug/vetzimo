<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class Notifications
{
    private const ID='00000000000000000000000000000002';
    private const DEFAULTS=['host'=>'','port'=>'465','username'=>'','sender'=>'','admin'=>'',
        'recipient'=>'','phoneId'=>'','apiVersion'=>'','template'=>'','language'=>'tr',
        'smtpEnabled'=>false,'waEnabled'=>false,'password'=>'','token'=>''];

    public function __construct(private readonly PDO $db,private readonly string $key,private readonly ?string $partner=null) {}

    private function scopeId(): string
    {
        return $this->partner===null?self::ID:substr(hash("sha256","dealer-notifications:".$this->partner),0,32);
    }

    private function read(): array
    {
        $q=$this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='notifications'");
        $q->execute([$this->scopeId()]);
        $raw=$q->fetchColumn();
        return ($raw ? json_decode($raw,true,32,JSON_THROW_ON_ERROR) : [])+self::DEFAULTS;
    }

    public function dealer(string $partner): self
    {
        return new self($this->db,$this->key,$partner);
    }

    public function settings(): array
    {
        $data=$this->read();
        $data['hasPassword']=$data['password']!=='';
        $data['hasToken']=$data['token']!=='';
        unset($data['password'],$data['token']);
        return $data;
    }

    public function save(object $body): array
    {
        $current=$this->read();
        foreach (self::DEFAULTS as $key=>$default) {
            $value=$body->$key ?? $default;
            if (is_bool($default)) { $current[$key]=$value===true; continue; }
            if (!is_string($value) || strlen($value)>4096 || preg_match('/[\x00-\x1f\x7f]/',$value)) {
                throw new RuntimeException('Bildirim alanı geçersiz.',422);
            }
            if (in_array($key,['password','token'],true)) {
                if (($body->{'clear'.ucfirst($key)} ?? false)===true) $current[$key]='';
                elseif ($value!=='') $current[$key]=Totp::encrypt($value,$this->key);
                continue;
            }
            $current[$key]=trim($value);
        }
        foreach (['sender','admin'] as $field) {
            if ($current[$field]!=='' && !filter_var($current[$field],FILTER_VALIDATE_EMAIL)) throw new RuntimeException('E-posta adreslerini kontrol edin.',422);
        }
        if (!in_array($current['port'],['465','587'],true) ||
            ($current['host']!=='' && !preg_match('/\A[a-z0-9.-]{1,253}\z/i',$current['host']))) {
            throw new RuntimeException('SMTP sunucu adı ve portu geçersiz.',422);
        }
        if ($current['smtpEnabled'] && (!$current['sender'] || !$current['admin'] || !$current['host'] || !$current['username'] || !$current['password'])) {
            throw new RuntimeException('SMTP için sunucu, hesap, parola ve e-posta adreslerini doldurun.',422);
        }
        if ($current['waEnabled']) $this->whatsappPayload($current);
        $q=$this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'notifications',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)");
        $q->execute([$this->scopeId(),json_encode($current,JSON_THROW_ON_ERROR)]);
        return $this->settings();
    }

    private function whatsappPayload(array $s): array
    {
        if (!preg_match('/\A[1-9][0-9]{7,14}\z/',$s['recipient']) || !preg_match('/\A[0-9]{5,30}\z/',$s['phoneId'])
            || !preg_match('/\Av[0-9]{1,3}\.0\z/',$s['apiVersion']) || !preg_match('/\A[a-z0-9_]{1,128}\z/',$s['template'])
            || !preg_match('/\A[a-z]{2,3}(?:_[A-Z]{2})?\z/',$s['language']) || !$s['token']) {
            throw new RuntimeException('WhatsApp alıcısı, Phone Number ID, API sürümü, şablon, dil ve belirteci kontrol edin.',422);
        }
        return ['messaging_product'=>'whatsapp','to'=>$s['recipient'],'type'=>'template',
            'template'=>['name'=>$s['template'],'language'=>['code'=>$s['language']]]];
    }

    public function send(string $channel,?string $recipient=null,string $subject='VetZimo bildirim testi',string $message='VetZimo bağlantı testi.'): void
    {
        if (!function_exists('curl_init')) throw new RuntimeException('Hosting hesabında PHP cURL uzantısını etkinleştirin.',503);
        $s=$this->read();
        if ($channel==='whatsapp') {
            if (!$s['waEnabled']) throw new RuntimeException('WhatsApp bağlantısı kapalı.',422);
            $payload=$this->whatsappPayload($s);
            $url='https://graph.facebook.com/'.$s['apiVersion'].'/'.$s['phoneId'].'/messages';
            $curl=curl_init($url);
            curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR),
                CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.Totp::decrypt($s['token'],$this->key)]]);
        } elseif ($channel==='smtp') {
            if (!$s['smtpEnabled']) throw new RuntimeException('SMTP bağlantısı kapalı.',422);
            $recipient ??= $s['admin'];
            if (!filter_var($recipient,FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Alıcı e-posta adresi geçersiz.',422);
            $ip=gethostbyname($s['host']);
            if (!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4|FILTER_FLAG_GLOBAL_RANGE)) {
                throw new RuntimeException('SMTP sunucusu için genel bir IPv4 adresi bulunamadı.',422);
            }
            $scheme=$s['port']==='465'?'smtps':'smtp';
            $curl=curl_init($scheme.'://'.$s['host'].':'.$s['port']);
            $payload="From: <".$s['sender'].">\r\nTo: <".$recipient.">\r\nDate: ".gmdate(DATE_RFC2822).
                "\r\nSubject: =?UTF-8?B?".base64_encode($subject)."?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n".
                "Content-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($message));
            $stream=fopen('php://temp','w+b');
            fwrite($stream,$payload);
            rewind($stream);
            curl_setopt_array($curl,[CURLOPT_RESOLVE=>[$s['host'].':'.$s['port'].':'.$ip],CURLOPT_USE_SSL=>CURLUSESSL_ALL,
                CURLOPT_USERNAME=>$s['username'],CURLOPT_PASSWORD=>Totp::decrypt($s['password'],$this->key),
                CURLOPT_MAIL_FROM=>'<'.$s['sender'].'>',CURLOPT_MAIL_RCPT=>['<'.$recipient.'>'],CURLOPT_UPLOAD=>true,
                CURLOPT_INFILE=>$stream,CURLOPT_INFILESIZE=>strlen($payload)]);
        } else throw new RuntimeException('Bildirim kanalı geçersiz.',422);
        try {
            curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>12,
                CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_PROXY=>'']);
            $result=curl_exec($curl);
            $code=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
            if ($result===false || $code<200 || $code>=300) {
                $provider=$channel==='whatsapp' && is_string($result) ? (int)(json_decode($result,true)['error']['code'] ?? 0) : 0;
                throw new RuntimeException('Sağlayıcı gönderimi kabul etmedi. Yanıt: '.$code.', bağlantı: '.curl_errno($curl).($provider?', Meta: '.$provider:''),502);
            }
        } finally {
            unset($curl); // curl_close PHP 8.5 itibarıyla kullanımdan kalktı
            if (isset($stream)) fclose($stream);
        }
    }

    public function demoApplication(string $email,string $clinic): void
    {
        $settings=$this->read();
        $jobs=[];
        if ($settings['smtpEnabled']) {
            $jobs[]=['smtp',$email,'Demo başvurunuz alındı','Demo başvurunuz alındı. En kısa sürede sizinle iletişime geçeceğiz.'];
            $jobs[]=['smtp',null,'Yeni VetZimo demo başvurusu','Yeni başvuru: '.$clinic.'. Başvuruyu yönetim panelinden inceleyin.'];
        }
        if ($settings['waEnabled']) $jobs[]=['whatsapp'];
        foreach ($jobs as $job) {
            try { $this->send(...$job); }
            catch (\Throwable $error) { error_log('VetZimo demo notification: '.($error instanceof RuntimeException && $error->getCode()===502 ? $error->getMessage() : get_class($error))); }
        }
    }
}
