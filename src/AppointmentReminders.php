<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

final class AppointmentReminders
{
    public function __construct(private readonly PDO $db) {}

    public static function jobs(object $state, string $clinic, int $now): array
    {
        $prefs = $state->preferences ?? (object)[];
        $branches = array_column($state->branches ?? [], null, 'id');
        $patients = array_column($state->patients ?? [], null, 'id');
        $clients = array_column($state->clients ?? [], null, 'id');
        $zone = new DateTimeZone('Europe/Istanbul');
        $today = (new DateTimeImmutable('@'.$now))->setTimezone($zone)->format('Y-m-d');
        $jobs = [];
        $defaults = [
            'appointments'=>'{hasta} için randevunuz {tarih}. {klinik}',
            'followups'=>'{hasta} için {tarih} tarihinde {islem} aşısı planlandı. {klinik}',
            'patientBirthday'=>'{hasta} için mutlu yıllar dileriz. {klinik}',
            'customerBirthday'=>'Sayın {musteri}, doğum gününüz kutlu olsun. {klinik}',
        ];
        foreach (['appointments'=>'appointments','followups'=>'followups','patientBirthday'=>'patients','customerBirthday'=>'clients'] as $kind=>$collection) {
            $setting = 'customerReminder_'.$kind.'_';
            $legacy = $kind==='appointments' && !isset($prefs->{$setting.'mode'});
            if (($prefs->{$setting.'mode'} ?? ($legacy && ($prefs->reminder_appointments ?? '')==='Evet' ? 'auto' : 'off'))!=='auto') continue;
            $birthday = str_ends_with($kind,'Birthday');
            foreach ($state->$collection ?? [] as $row) {
                if ($kind==='appointments' && !in_array($row->status ?? '', ['Planlandı','Onaylandı','Bekliyor'],true)) continue;
                if ($kind==='followups' && (($row->kind ?? '')!=='Aşı' || ($row->status ?? '')!=='Planlandı' || !empty($row->done))) continue;
                $branch = $branches[$row->branch] ?? null;
                if (!$branch || ($branch->status ?? '')==='Pasif') continue;
                if ($birthday && (substr($row->birth ?? '',5)!==substr($today,5) || ($row->birth ?? '') >= $today)) continue;
                $due = $birthday ? $today.' '.($prefs->{$setting.'schedule'} ?? '10:00') :
                    ($row->date ?? '').' '.($kind==='followups' ? '09:00' : ($row->time ?? ''));
                $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i',$due,$zone);
                if (!$date || $date->format('Y-m-d H:i')!==$due) continue;
                $at = $date->getTimestamp();
                $hours = max(1,min(168,(int)($prefs->{$setting.'schedule'} ?? 24)));
                if ($birthday ? $at>$now : ($at<=$now || $at>$now+$hours*3600)) continue;
                $patient = $kind==='patientBirthday' ? $row : ($patients[$row->patient ?? ''] ?? null);
                if (!empty($row->patient) && (!$patient || $patient->branch!==$row->branch)) continue;
                $client = $kind==='customerBirthday' ? $row : ($clients[$patient ? ($patient->owner ?? '') : ($row->client ?? '')] ?? null);
                if (!$client || $client->branch!==$row->branch) continue;
                $phone = DealerLogin::normalizePhone($client->phone ?? '');
                $parameters = array_map(static fn(string $value): string => trim(preg_replace('/\s+/u',' ',$value) ?? ''),
                    [$patient->name ?? $client->name,$date->format('d.m.Y H:i'),$branch->name ?: $clinic]);
                if (in_array('',$parameters,true)) continue;
                $message = strtr($prefs->{$setting.'text'} ?? $defaults[$kind],[
                    '{musteri}'=>$client->name,'{hasta}'=>$parameters[0],'{tarih}'=>$parameters[1],
                    '{islem}'=>$row->title ?? $row->service ?? '', '{klinik}'=>$parameters[2],
                ]);
                foreach (['sms','whatsapp','email'] as $channel) {
                    $permission = $channel==='email' ? 'emailPermission' : $channel;
                    if (($client->$permission ?? '')!=='Var') continue;
                    if (($prefs->{$setting.$channel} ?? ($legacy ? ($prefs->{'reminder_'.$channel} ?? '') : ''))!=='Evet') continue;
                    if ($channel==='email' ? !filter_var($client->email ?? '',FILTER_VALIDATE_EMAIL) : !$phone) continue;
                    $jobs[] = ['appointment'=>$row->id,'kind'=>$kind,'branch'=>$row->branch,'due'=>$due,'phone'=>$phone,
                        'email'=>$client->email ?? '', 'channel'=>$channel,'parameters'=>$parameters,'message'=>$message,
                        'waTemplate'=>$prefs->{$setting.'waTemplate'} ?? '','birthday'=>$birthday];
                }
            }
        }
        usort($jobs, static fn(array $a,array $b): int => strcmp($a['due'],$b['due']));
        return $jobs;
    }

    public function run(array $connections, int $now, ?Notifications $notifications=null): array
    {
        if (!function_exists('curl_init')) throw new RuntimeException('cURL gerekli.');
        $lock = $this->db->query("SELECT GET_LOCK(CONCAT('vetnet-reminders-', MD5(DATABASE())), 0)")->fetchColumn();
        $stats = ['accepted'=>0, 'rejected'=>0, 'unknown'=>0];
        if ((int)$lock !== 1) return $stats;
        try {
            $read = $this->db->prepare('SELECT name FROM partner_account WHERE id=? AND active=1');
            $workspaces = new WorkspaceRepository($this->db);
            $exists = $this->db->prepare('SELECT 1 FROM clinic_appointment_reminder WHERE dispatch_key=?');
            $claim = $this->db->prepare("INSERT INTO clinic_appointment_reminder (dispatch_key,status) VALUES (?,'sending')");
            $finish = $this->db->prepare('UPDATE clinic_appointment_reminder SET status=?,provider_reference=? WHERE dispatch_key=?');
            $deadline = microtime(true) + 240;
            // Telefon Bağlantısı açık klinikler: SMS kliniğin kendi hattından, WhatsApp kendi numarasından gider (sağlayıcı gerekmez).
            $gateway = class_exists(PhoneGateway::class) ? new PhoneGateway($this->db) : null;
            $routes = $gateway ? $gateway->routesAll() : [];
            foreach ($routes as $partner => $route) $connections[$partner] ??= [];
            foreach ($connections as $partner => $settings) {
                $read->execute([$partner]);
                $row = $read->fetch();
                if (!$row) continue;
                $state = $workspaces->load('partner:'.$partner)['state'];
                if (!$state) continue;
                // İmzalı müşteri onay formu varsa SMS/WhatsApp/e-posta izni olarak o esas alınır.
                if (class_exists(ClientPermit::class)) (new ClientPermit($this->db))->overlay($partner, $state->clients ?? []);
                // Telefon Bağlantısı'nda "SMS ve WhatsApp birlikte" açıksa otomatik hatırlatmalar iki kanaldan da gider.
                if (!empty($routes[$partner]['both']) && isset($state->preferences)) {
                    foreach (['appointments','followups','patientBirthday','customerBirthday'] as $kind) {
                        if (($state->preferences->{'customerReminder_'.$kind.'_mode'} ?? '')==='auto' &&
                            (($state->preferences->{'customerReminder_'.$kind.'_sms'} ?? '')==='Evet' || ($state->preferences->{'customerReminder_'.$kind.'_whatsapp'} ?? '')==='Evet')) {
                            $state->preferences->{'customerReminder_'.$kind.'_sms'}='Evet';
                            $state->preferences->{'customerReminder_'.$kind.'_whatsapp'}='Evet';
                        }
                    }
                }
                foreach (self::jobs($state, $row['name'], $now) as $job) {
                    if (microtime(true) > $deadline) return $stats;
                    $provider = $settings[$job['channel']] ?? null;
                    $email = $job['channel']==='email';
                    $viaPhone = !$email && $gateway && !empty($routes[$partner][$job['channel']]);
                    if (!$viaPhone && ($email ? (!$notifications || !$notifications->settings()['smtpEnabled']) : !is_array($provider))) continue;
                    if (!$job['birthday'] && (strtotime($job['due'].' +03:00') ?: 0) <= time()) continue;
                    $key = hash('sha256', json_encode([$partner,$job['branch'],$job['appointment'],($job['birthday'] ? substr($job['due'],0,10) : $job['due']),$job['channel'],...($job['kind']==='appointments'?[]:[$job['kind']])], JSON_THROW_ON_ERROR));
                    $exists->execute([$key]);
                    if ($exists->fetchColumn()) continue;
                    if ($viaPhone) {
                        $claim->execute([$key]);
                        try {
                            $expires = $job['birthday'] ? (strtotime(substr($job['due'],0,10).' 21:00 +03:00') ?: null) : (strtotime($job['due'].' +03:00') ?: null);
                            $id = $gateway->enqueue($partner, $job['channel'], $job['phone'], $job['message'], 'reminder', $key, 1, $now, $expires);
                            $finish->execute(['accepted', 'phone:'.$id, $key]);
                            $stats['accepted']++;
                        } catch (\Throwable) { $finish->execute(['rejected', '', $key]); $stats['rejected']++; }
                        continue;
                    }
                    $request = $email ? null : self::request($provider, $job, $key);
                    if (!$email && $request === null) {
                        $stats['rejected']++;
                        continue;
                    }
                    $claim->execute([$key]);
                    if ($email) {
                        $reference = '';
                        try {
                            $notifications->send('smtp',$job['email'],'VetZimo klinik hatırlatması',$job['message']);
                            $status = 'accepted';
                        } catch (\Throwable) { $status = 'unknown'; }
                    } else {
                        [$status,$reference] = self::send($request, $job['channel']);
                    }
                    $finish->execute([$status,$reference,$key]);
                    $stats[$status]++;
                }
            }
            return $stats;
        } finally {
            $this->db->query("SELECT RELEASE_LOCK(CONCAT('vetnet-reminders-', MD5(DATABASE())))");
        }
    }

    public static function request(array $provider, array $job, string $key): ?array
    {
        [$patient,$date,$clinic] = $job['parameters'];
        if ($job['channel'] === 'sms') {
            $account = $provider['account'] ?? '';
            $password = $provider['password'] ?? '';
            $sender = $provider['sender'] ?? '';
            if (!preg_match('/\A[1-9][0-9]{9}\z/', $account) || $password === '' ||
                !preg_match("/\A[A-Za-z0-9ÇĞİÖŞÜçğıöşü .&'()-]{3,11}\z/u", $sender)) return null;
            return ['https://api.netgsm.com.tr/sms/rest/v2/send', 'Basic '.base64_encode($account.':'.$password),
                ['msgheader'=>$sender, 'encoding'=>'UNICODE', 'iysfilter'=>!empty($job['birthday'])?'11':'0', 'referansID'=>substr($key,0,32),
                    'messages'=>[['no'=>substr($job['phone'],3), 'msg'=>$job['message'] ?? "$patient için randevunuz $date. $clinic"]]]];
        }
        $version = $provider['version'] ?? '';
        $phoneId = $provider['phoneId'] ?? '';
        $token = $provider['token'] ?? '';
        $template = ($job['waTemplate'] ?? '') ?: (($job['kind'] ?? 'appointments')==='appointments' ? ($provider['template'] ?? '') : '');
        $language = $provider['language'] ?? 'tr';
        if (!preg_match('/\Av[0-9]{1,3}\.0\z/', $version) || !preg_match('/\A[0-9]{5,30}\z/', $phoneId) ||
            !preg_match('/\A[\x21-\x7e]+\z/', $token) || !preg_match('/\A[a-z0-9_]{1,128}\z/', $template) ||
            !preg_match('/\A[a-z]{2,3}(?:_[A-Z]{2})?\z/', $language)) return null;
        $parameters = array_map(static fn(string $text): array => ['type'=>'text','text'=>$text], $job['parameters']);
        return ["https://graph.facebook.com/$version/$phoneId/messages", 'Bearer '.$token,
            ['messaging_product'=>'whatsapp','to'=>substr($job['phone'],1),'type'=>'template',
                'template'=>['name'=>$template,'language'=>['code'=>$language],
                    'components'=>[['type'=>'body','parameters'=>$parameters]]]]];
    }

    public static function send(array $request, string $channel): array
    {
        [$url,$auth,$body] = $request;
        $curl = curl_init($url);
        curl_setopt_array($curl,[CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>json_encode($body,JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: '.$auth],
            CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>12,
            CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2]);
        $raw = curl_exec($curl);
        $http = (int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        unset($curl); // curl_close PHP 8.5 itibarıyla kullanımdan kalktı
        $data = is_string($raw) ? json_decode($raw,true) : null;
        if ($channel === 'sms') {
            $code = str_pad((string)($data['code'] ?? ''),2,'0',STR_PAD_LEFT);
            $reference = (string)($data['jobid'] ?? '');
            if ($http >= 200 && $http < 300 && in_array($code,['00','01','02'],true) &&
                preg_match('/\A[0-9]{1,40}\z/',$reference)) return ['accepted',$reference];
            if (in_array($code,['20','30','40','50','51','70','80','85'],true)) return ['rejected',''];
        } else {
            $reference = (string)($data['messages'][0]['id'] ?? '');
            if ($http >= 200 && $http < 300 && preg_match('/\A[A-Za-z0-9_.=+\/-]{1,191}\z/',$reference)) {
                return ['accepted',$reference];
            }
        }
        return [$http >= 400 && $http < 500 ? 'rejected' : 'unknown',''];
    }
}
