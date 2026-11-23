<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class NativePush
{
    private string $accessToken='';
    private int $expires=0;
    private array $credential=[];

    public function __construct(private readonly string $project,string $credentialFile)
    {
        if (!function_exists('curl_init')) throw new RuntimeException('Push için PHP cURL gereklidir.');
        if ($project==='' && $credentialFile==='') return;
        if (!preg_match('/\A[a-z][a-z0-9-]{4,62}\z/D',$project) || !is_readable($credentialFile)) {
            throw new RuntimeException('FCM proje ve hizmet hesabı yapılandırması gerekli.');
        }
        $this->credential=json_decode((string)file_get_contents($credentialFile),true,16,JSON_THROW_ON_ERROR);
        if (!is_string($this->credential['client_email']??null) || ($this->credential['type']??'')!=='service_account' ||
            !is_string($this->credential['private_key']??null)) throw new RuntimeException('FCM hizmet hesabı geçersiz.');
    }

    private static function b64(string $source): string
    {
        return rtrim(strtr(base64_encode($source),'+/','-_'),'=');
    }

    private function post(string $url,string $data,array $headers): array
    {
        $curl=curl_init($url);
        if ($curl===false) throw new RuntimeException('FCM bağlantısı oluşturulamadı.');
        curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$data,CURLOPT_HTTPHEADER=>$headers,
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>9,CURLOPT_FOLLOWLOCATION=>false,
            CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS]);
        $body=curl_exec($curl);
        $status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        if (is_string($body)) return [$status,json_decode($body,true)];
        return [0,null];
    }

    private function token(): string
    {
        $now=time();
        if ($this->expires>$now+60) return $this->accessToken;
        $endpoint='https://oauth2.googleapis.com/token';
        $head=self::b64('{"alg":"RS256","typ":"JWT"}');
        $body=self::b64(json_encode(['iss'=>$this->credential['client_email'],
            'scope'=>'https://www.googleapis.com/auth/firebase.messaging','aud'=>$endpoint,'iat'=>$now,'exp'=>$now+3600],JSON_THROW_ON_ERROR));
        if (!openssl_sign("$head.$body",$sig,$this->credential['private_key'],OPENSSL_ALGO_SHA256)) throw new RuntimeException('FCM yetkilendirmesi imzalanamadı.');
        [$status,$reply]=$this->post($endpoint,http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'=>"$head.$body.".self::b64($sig)]),['Content-Type: application/x-www-form-urlencoded']);
        if ($status!==200 || !is_string($reply['access_token']??null)) throw new RuntimeException('FCM erişim belirteci alınamadı.');
        $this->accessToken=$reply['access_token'];
        $this->expires=$now+min(3600,(int)($reply['expires_in']??0));
        return $this->accessToken;
    }

    public static function message(string $token,string $id,int $badge,bool $audible): array
    {
        $aps=['badge'=>$badge,'category'=>'VETZIMO_UPDATE'];
        if ($audible) $aps['sound']='default';
        return ['message'=>['token'=>$token,
            'notification'=>['title'=>'VetZimo','body'=>'VetZimo • 🔔'],
            'data'=>['id'=>$id],
            'android'=>['priority'=>'HIGH','ttl'=>'1800s','notification'=>[
                'tag'=>'notice-'.$id,'channel_id'=>$audible?'vetzimo_updates':'vetzimo_silent',
                'notification_count'=>$badge,'visibility'=>'PRIVATE']],
            'apns'=>['headers'=>['apns-push-type'=>'alert','apns-collapse-id'=>'notice-'.$id,
                'apns-expiration'=>(string)(time()+1800)],
                'payload'=>['aps'=>$aps]],
        ]];
    }

    public function send(string $token,string $id,int $badge,bool $audible): string
    {
        $url='https://fcm.googleapis.com/v1/projects/'.$this->project.'/messages:send';
        [$status,$reply]=$this->post($url,json_encode(self::message($token,$id,$badge,$audible),JSON_THROW_ON_ERROR),[
            'Content-Type: application/json','Authorization: Bearer '.$this->token(),
        ]);
        if ($status===200 && !empty($reply['name'])) return 'sent';
        foreach (($reply['error']['details']??[]) as $error) if (($error['errorCode']??'')==='UNREGISTERED') return 'unregistered';
        if ($status===401) $this->expires=0;
        return 'retry';
    }

    public function work(PDO $db,array $config,int $now): void
    {
        $windowsSettings=$config['nativeWindowsPush']??[];
        $windows=NativeWindowsPush::configured($windowsSettings)?new NativeWindowsPush($windowsSettings):null;
        if (!$this->credential && !$windows) throw new RuntimeException('Yapılandırılmış gönderim sağlayıcısı bulunamadı.');
        $platformFilter=$windows?($this->credential?"":" AND d.platform='windows'"):" AND d.platform<>'windows'";
        $db->prepare('DELETE FROM native_device WHERE seen_at<? ORDER BY seen_at LIMIT 100')->execute([$now-60*86400]);
        $scan=$db->prepare("SELECT n.id,n.target,n.kind,n.customer_id,n.branch_id,n.membership_id AS notice_membership,
            d.id AS device_id,d.platform,d.token_cipher,d.mute,d.tone,COALESCE(j.attempts,0) AS tried,
            m.id AS membership_id,m.partner_id,m.account_id,m.role,m.modules,m.branch_id AS member_branch,
            m.customer_id AS member_customer,a.identifier
            FROM clinic_delivery_notice n JOIN identity_membership m
            ON m.partner_id=n.partner_id AND m.status='active' AND (
              (m.role='customer' AND n.kind<>'clinic' AND m.customer_id=n.customer_id AND (n.membership_id='' OR n.membership_id=m.id))
              OR (m.role<>'customer' AND n.kind IN ('clinic','native_visit_clinic')))
            JOIN native_device d ON d.membership_id=m.id AND d.account_id=m.account_id
            JOIN identity_account a ON a.id=m.account_id AND a.blocked=0 AND a.version=d.account_version
            JOIN partner_account p ON p.id=m.partner_id AND p.active=1
            LEFT JOIN native_push_delivery j ON j.notice_id=n.id AND j.device_id=d.id
            WHERE n.created_at>=FROM_UNIXTIME(?) AND n.created_at>=FROM_UNIXTIME(d.registered_at)
              AND d.seen_at>=? AND (j.notice_id IS NULL OR (j.outcome='retry' AND j.attempts<6 AND j.next_at<=?))
            $platformFilter ORDER BY n.id,d.id LIMIT 30");
        $scan->execute([$now-86400,$now-60*86400,$now]);
        $store=$db->prepare('INSERT INTO native_push_delivery(notice_id,device_id,outcome,attempts,next_at)
            VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE outcome=VALUES(outcome),attempts=VALUES(attempts),next_at=VALUES(next_at)');
        $app=new NativeApp($db,$config);
        $repo=new WorkspaceRepository($db);
        $policies=[];
        foreach($db->query('SELECT category,role,enabled FROM native_push_policy')->fetchAll() as $policy) {
            $policies[$policy['category']][$policy['role']]=(bool)$policy['enabled'];
        }
        foreach ($scan->fetchAll() as $row) {
            $actor=$row;
            $actor['customer_id']=$row['member_customer'];
            $actor['branch_id']=$row['member_branch'];
            $branch=null;
            if ($actor['role']!=='dealer') {
                $branches=$repo->branches('partner:'.$actor['partner_id']);
                $branch=ClinicAccess::branch((object)['branches'=>$branches],$actor['branch_id']);
            }
            $sameBranch=$actor['role']==='dealer' || ($branch && (($branch->sharedWith??'')?:$branch->id)===$row['branch_id']);
            if ($sameBranch && $actor['role']==='customer') {
                $sameBranch=ClinicAccess::valid($actor,$repo->bookingState('partner:'.$actor['partner_id'],$actor['customer_id']));
            }
            if ($actor['role']!=='customer') $actor=(new Commerce($db))->packageActor($actor);
            $detail=$sameBranch?NativeApp::noticeDetails($actor,$row):null;
            $category=$detail['category']??null;
            $status='rejected';
            if ($category && ($policies[$category][$actor['role']]??true) &&
                !in_array($category,json_decode($row['mute'],true)??[],true)) {
                $inbox=$app->inbox($actor,$now);
                $eligible=array_filter($inbox['items'],static fn($item)=>$item['id']===(string)$row['id'] && $item['unread']);
                if ($eligible) {
                    try {
                        $token=Totp::decrypt($row['token_cipher'],$config['encryptionKey']??'');
                        $status=$row['platform']==='windows'
                            ?$windows->send($token,(string)$row['id'],$row['tone']==='default')
                            :$this->send($token,(string)$row['id'],$inbox['unread'],$row['tone']==='default');
                    } catch (\Throwable) { $status='retry'; }
                }
            }
            if ($status==='unregistered') {
                $db->prepare('DELETE FROM native_device WHERE id=? AND token_cipher=?')->execute([$row['device_id'],$row['token_cipher']]);
                continue;
            }
            $tries=1+(int)$row['tried'];
            $store->execute([$row['id'],$row['device_id'],$status,$tries,$now+60*2**$tries]);
        }
    }
}
