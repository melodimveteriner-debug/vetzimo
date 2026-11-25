<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class BulkClinicMessages
{
    public function __construct(private readonly PDO $db,private readonly array $config) {}

    private static function channelGrant(array $actor,string $channel,bool $send): bool
    {
        return in_array($channel,['sms','whatsapp'],true) &&
            ClinicAccess::allowed($actor,'messages',$send) &&
            ClinicAccess::action($actor,$channel.($send?'Send':'History'),$send);
    }

    public function history(array $actor,string $channel): array
    {
        if (!self::channelGrant($actor,$channel,false)) throw new RuntimeException('Bu kanalın geçmişini görüntüleme izniniz yok.',403);
        $params=[$actor['partner_id'],$channel];
        $scope='';
        if ($actor['role']!=='dealer') { $scope=' AND branch_id=?'; $params[]=$actor['branch_id']; }
        $q=$this->db->prepare('SELECT id,masked_phone,status,units,created_at FROM clinic_bulk_message
            WHERE partner_id=? AND channel=?'.$scope.' ORDER BY created_at DESC,id DESC LIMIT 200');
        $q->execute($params);
        return ['items'=>$q->fetchAll()];
    }

    public function bulk(array $actor,object $input,bool $preview): array
    {
        $channel=$input->channel??null;
        if (!is_string($channel) || !self::channelGrant($actor,$channel,true) ||
            !ClinicAccess::allowed($actor,'clients') || !ClinicAccess::allowed($actor,'patients')) {
            throw new RuntimeException('Bu kanalı kullanmak için gönderim, müşteri ve hasta izinleri gerekir.',403);
        }
        $request=$input->requestId??'';
        $iys=$input->iysfilter??'0';
        $targets=$input->targets??null;
        $branch=$input->branchId??null;
        if (!is_string($branch) || !is_array($targets) || !$targets || count($targets)>($preview?60:8) ||
            !in_array($iys,['0','11','12'],true) || (!$preview && (!is_string($request) ||
            !preg_match('/\A[A-Za-z0-9-]{16,80}\z/D',$request) || ($input->confirm??null)!==true))) {
            throw new RuntimeException('Gönderim bilgilerini ve onayı kontrol edin.',422);
        }
        $partner=$actor['partner_id'];
        $provider=$this->config['appointmentReminderConnections'][$partner][$channel]??[];
        // Telefon Bağlantısı açıksa mesaj kliniğin kendi hattından gider: kredi düşmez, WhatsApp'ta onaylı şablon gerekmez.
        $viaPhone=(bool)(new PhoneGateway($this->db))->route($partner,$channel);
        if (!$preview) $this->db->beginTransaction();
        try {
            if (!$preview) {
                $lock=$this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');
                $lock->execute([$partner]); $lock->fetchColumn();
            }
            $state=(new WorkspaceRepository($this->db))->load('partner:'.$partner)['state'];
            (new ClientPermit($this->db))->overlay($partner,$state->clients??[]);
            $visible=ClinicAccess::visible($state,$actor);
            $clinic=ClinicAccess::branch($visible,$branch);
            if (!$clinic) throw new RuntimeException('Seçilen şubeye erişiminiz yok.',403);
            $dataBranch=($clinic->sharedWith??'')?:$clinic->id;
            $records=static fn($key)=>array_column(array_values(array_filter($visible->$key??[],
                static fn($row)=>$row->branch===$dataBranch)),null,'id');
            $templateId=$input->templateId??'';
            $template=is_string($templateId)?($records('templates')[$templateId]??null):null;
            $body=$template?($template->message??''):(($channel==='sms' || $viaPhone) && is_string($input->message??null)?trim($input->message):'');
            if (!preg_match('/\A.{1,912}\z/usD',$body) || ($template && $template->channel!==($channel==='sms'?'SMS':'WhatsApp'))) {
                throw new RuntimeException('Bu kanala ait geçerli bir mesaj metni veya şablon seçin.',422);
            }
            if (!$viaPhone && $channel==='whatsapp' && ($body!==($provider['bulkBody']??null) || empty($provider['bulkTemplate']))) {
                throw new RuntimeException('Yönetimde tanımlanan onaylı WhatsApp toplu şablonunu seçin.',422);
            }
            $clients=$records('clients'); $patients=$records('patients');
            $vaccines=ClinicAccess::allowed($actor,'followups')?$records('followups'):[];
            $balance=$preview?0:$this->balance($partner,$channel);
            // {bakiye}: müşterinin açık borcu (satış - peşin tahsilat - sonraki tahsilatlar). Borcu olmayan alıcı atlanır.
            $debts=[];
            if (str_contains($body,'{bakiye}')) {
                if (!ClinicAccess::allowed($actor,'sales')) throw new RuntimeException('Bakiye alanı için satış görüntüleme izni gerekir.',403);
                $collected=[];
                foreach ($records('collections') as $row) $collected[$row->sale??'']=($collected[$row->sale??'']??0)+Finance::money($row->amount??'0');
                foreach ($records('sales') as $sale) {
                    if (($sale->client??'')==='') continue;
                    $debts[$sale->client]=($debts[$sale->client]??0)+Finance::money($sale->amount??'0')-Finance::money($sale->paid??'0')-($collected[$sale->id]??0);
                }
            }
            $results=[]; $phones=[];
            foreach ($targets as $target) {
                if (!$target instanceof \stdClass || !is_string($target->client??null) ||
                    !is_string($target->patient??'') || !is_string($target->vaccine??'')) throw new RuntimeException('Alıcı bilgisi geçersiz.',422);
                $client=$clients[$target->client]??null;
                $patient=$patients[$target->patient??'']??null;
                $vaccine=$vaccines[$target->vaccine??'']??null;
                $phone=DealerLogin::normalizePhone($client->phone??'');
                $result=['client'=>$client->id??'','patient'=>$patient->id??'','vaccine'=>$vaccine->id??'','name'=>$client->name??'','status'=>'skipped'];
                if (!$client || $phone==='' || ($client->$channel??'')!=='Var' || ($viaPhone && $iys!=='0' && ($client->marketingConsent??'')!=='Var') ||
                    (!empty($target->patient) && (!$patient || $patient->owner!==$client->id)) ||
                    (!empty($target->vaccine) && (!$vaccine || $vaccine->patient!==($patient->id??'') || ($vaccine->kind??'')!=='Aşı' ||
                    ($vaccine->status??'')==='İptal')) || isset($phones[$phone])) {
                    $results[]= $result+['reason'=>'Kayıt, kanal izni veya benzersiz telefon doğrulanamadı.'];continue;
                }
                $date=($vaccine->done??'')?:($vaccine->date??'');
                $values=['sahip'=>$client->name,'hasta'=>$patient->name??'','asi'=>$vaccine->title??'',
                    'asi_tarihi'=>preg_match('/\A\d{4}-\d{2}-\d{2}\z/D',$date)?implode('.',array_reverse(explode('-',$date))):'',
                    'klinik'=>$clinic->name,'klinik_telefon'=>($clinic->phone??'')?:($state->preferences->phone??''),
                    'bakiye'=>($debts[$client->id]??0)>0?number_format(($debts[$client->id])/100,2,',','.'):''];
                $variables=[];$missing=false;
                $filled=preg_replace_callback('/\{([a-z_]+)\}/',static function($m) use ($values,&$variables,&$missing) {
                    $value=trim($values[$m[1]]??'');
                    if ($value==='') $missing=true;
                    $variables[]=$value;
                    return $value;
                },$body);
                if ($missing || preg_match('/[{}]/',$filled) || strlen($filled)>3800) {
                    $results[]=$result+['reason'=>'Şablondaki alanlar tamamlanamadı.'];continue;
                }
                $phones[$phone]=true;
                $characters=preg_match_all('/./us',$filled)+preg_match_all('/[\x{10000}-\x{10FFFF}]/u',$filled);
                $units=$viaPhone?0:($channel==='whatsapp'?1:($characters<=70?1:(int)ceil($characters/67)));
                $proof=hash_hmac('sha256',json_encode([$actor['membership_id'],$partner,$branch,$channel,$iys,$client->id,$phone,$filled,$variables],
                    JSON_THROW_ON_ERROR),$this->config['rateSecret']);
                $result['body']=$filled;$result['units']=$units;
                if ($preview) {
                    $result['status']='ready';$result['proof']=$proof;
                } elseif (!is_string($target->proof??null) || !hash_equals($proof,$target->proof)) {
                    $result['reason']='Alıcı veya içerik değişti. Yeniden önizleyin.';
                } else {
                    $id=hash('sha256',implode('|',[$partner,$actor['membership_id'],$branch,$channel,$request,$phone]));
                    $existing=$this->db->prepare('SELECT status FROM clinic_bulk_message WHERE id=?');
                    $existing->execute([$id]);
                    if ($status=$existing->fetchColumn()) {
                        $result['status']=$status;
                    } elseif ($units>$balance) {
                        $result['reason']='Paketinizin aylık gönderim sınırı doldu.';
                    } else {
                        $job=['channel'=>$channel,'phone'=>$phone,'message'=>$filled,'parameters'=>$variables,
                            'iys'=>$iys,'waTemplate'=>$provider['bulkTemplate']??'', 'approvedBodyHash'=>hash('sha256',$body),'via'=>$viaPhone?'phone':'provider'];
                        if (!$viaPhone && !$this->providerRequest($provider,$job,$id)) throw new RuntimeException('Kanal sağlayıcısı bu bayi için hazır değil.',422);
                        $this->db->prepare('INSERT INTO clinic_bulk_message(id,partner_id,branch_id,data_branch,membership_id,channel,client_id,masked_phone,payload,units)
                            VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([$id,$partner,$branch,$dataBranch,$actor['membership_id'],$channel,$client->id,
                                '+90 ••• ••• •• '.substr($phone,-2),json_encode($job,JSON_THROW_ON_ERROR),$units]);
                        $balance-=$units;
                        $result['status']='queued';
                    }
                }
                $results[]=$result;
            }
            if (!$preview) $this->db->commit();
            return ['results'=>$results,'channel'=>$channel];
        } catch (\Throwable $error) {
            if (!$preview && $this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    /** Klinik "Kredi ve limitler" ekranı için kanal bağlantı durumu. */
    public function session(array $actor): array
    {
        $connections=$this->config['appointmentReminderConnections'][$actor['partner_id']]??[];
        $gateway=new PhoneGateway($this->db);
        return ['role'=>$actor['role'],'provider'=>[
            'sms'=>!empty($connections['sms']) || (bool)$gateway->route($actor['partner_id'],'sms'),
            'whatsapp'=>!empty($connections['whatsapp']) || (bool)$gateway->route($actor['partner_id'],'whatsapp'),
        ],'phone'=>['sms'=>(bool)$gateway->route($actor['partner_id'],'sms'),'whatsapp'=>$gateway->route($actor['partner_id'],'whatsapp')]];
    }

    /** Bayi hesabı: profil, kanal bakiyeleri, kullanım, kredi hareketleri ve gönderim özeti. */
    public function account(array $actor): array
    {
        if ($actor['role']!=='dealer') throw new RuntimeException('Kredi ve limit bilgileri yalnızca bayi yöneticisine açıktır.',403);
        $partner=$actor['partner_id'];
        $q=$this->db->prepare('SELECT id,code,name,email,contact,phone,city,active,created_at,last_seen FROM partner_account WHERE id=?');
        $q->execute([$partner]);
        $account=$q->fetch(PDO::FETCH_ASSOC);
        if (!$account) throw new RuntimeException('Bayi hesabı bulunamadı.',404);
        $account['active']=(int)$account['active'];
        $session=$this->session($actor)['provider'];
        // Gün ve ay sınırları Türkiye saatine göre hesaplanır.
        $local=new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul'));
        $utc=new \DateTimeZone('UTC');
        $day=$local->setTime(0,0)->setTimezone($utc)->format('Y-m-d H:i:s');
        $month=$local->modify('first day of this month')->setTime(0,0)->setTimezone($utc)->format('Y-m-d H:i:s');
        $used=$this->db->prepare("SELECT channel,
                COALESCE(SUM(CASE WHEN created_at>=? THEN units END),0) AS day_used,
                COALESCE(SUM(CASE WHEN created_at>=? THEN units END),0) AS month_used
            FROM clinic_bulk_message WHERE partner_id=? AND status<>'rejected' AND created_at>=? GROUP BY channel");
        $used->execute([$day,$month,$partner,min($day,$month)]);
        $usage=array_column($used->fetchAll(PDO::FETCH_ASSOC),null,'channel');
        $limits=[];
        foreach (['sms','whatsapp'] as $channel) {
            $balance=max(0,$this->balance($partner,$channel));
            $dayUsed=(int)($usage[$channel]['day_used']??0);
            $monthUsed=(int)($usage[$channel]['month_used']??0);
            // Üst sınır paketteki aylık gönderim sınırıdır (boşsa sınırsız).
            $limits[]=['channel'=>$channel,'unlimited'=>$balance>=1000000000,'balance'=>$balance>=1000000000?null:$balance,'day_used'=>$dayUsed,'day_cap'=>$balance>=1000000000?null:$dayUsed+$balance,
                'month_used'=>$monthUsed,'month_cap'=>$balance>=1000000000?null:$monthUsed+$balance,'enabled'=>$session[$channel]?1:0];
        }
        $rows=[];
        $counts=$this->db->prepare('SELECT channel,status,COUNT(*) AS count FROM clinic_bulk_message WHERE partner_id=? GROUP BY channel,status ORDER BY channel,status');
        $counts->execute([$partner]);
        return ['account'=>$account,'limits'=>$limits,'ledger'=>$rows,
            'counts'=>array_map(static fn($row)=>[...$row,'count'=>(int)$row['count']],$counts->fetchAll(PDO::FETCH_ASSOC))];
    }

    /** Kalan aylık gönderim hakkı: paketteki aylık sınır − bu ay telefon hattı ve sağlayıcıyla gönderilenler. Sınır yoksa sınırsız. */
    private function balance(string $partner,string $channel): int
    {
        $usage=(new PhoneGateway($this->db))->monthlyUsage($partner,time())[$channel];
        if ($usage['limit']===null) return 1000000000;
        $start=(new \DateTimeImmutable('first day of this month 00:00',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d H:i:s');
        $q=$this->db->prepare("SELECT COALESCE(SUM(units),0) FROM clinic_bulk_message WHERE partner_id=? AND channel=? AND status<>'rejected' AND created_at>=?");
        $q->execute([$partner,$channel,$start]);
        return max(0,$usage['limit']-$usage['used']-(int)$q->fetchColumn());
    }

    private function providerRequest(array $provider,array $job,string $id): ?array
    {
        $validate=$job;
        $validate['parameters']=$job['channel']==='sms'?['','','']:[...$job['parameters'],'','',''];
        if ($job['channel']==='whatsapp' && (($provider['bulkTemplate']??'')!==$job['waTemplate'] ||
            !hash_equals($job['approvedBodyHash'],hash('sha256',$provider['bulkBody']??'')))) return null;
        $request=AppointmentReminders::request($provider,$validate,$id);
        if (!$request) return null;
        if ($job['channel']==='sms') $request[2]['iysfilter']=$job['iys'];
        elseif ($job['parameters']) $request[2]['template']['components'][0]['parameters']=array_slice($request[2]['template']['components'][0]['parameters'],0,count($job['parameters']));
        else unset($request[2]['template']['components']);
        return $request;
    }

    public function deliver(): void
    {
        if (!function_exists('curl_init')) return;
        $lock="CONCAT('vetzimo-bulk-',MD5(DATABASE()))";
        if (!(int)$this->db->query("SELECT GET_LOCK($lock,0)")->fetchColumn()) return;
        try {
            // An interrupted provider call has an unknown result and must not be sent a second time.
            $this->db->exec("UPDATE clinic_bulk_message SET status='unknown',payload='{}' WHERE status='sending'");
            $pending=$this->db->query("SELECT * FROM clinic_bulk_message WHERE status='queued' ORDER BY created_at,id LIMIT 30")->fetchAll();
            foreach ($pending as $row) {
                $q=$this->db->prepare("SELECT m.*,p.name AS partner_name FROM identity_membership m JOIN partner_account p ON p.id=m.partner_id
                    WHERE m.id=? AND m.partner_id=? AND m.status='active' AND p.active=1");
                $q->execute([$row['membership_id'],$row['partner_id']]);
                $member=$q->fetch();
                if ($member) $member=(new Commerce($this->db))->packageActor($member);
                $job=json_decode($row['payload'],true,16,JSON_THROW_ON_ERROR);
                $provider=$this->config['appointmentReminderConnections'][$row['partner_id']][$row['channel']]??[];
                $viaPhone=($job['via']??'')==='phone';
                $request=$viaPhone?['phone']:$this->providerRequest($provider,$job,$row['id']);
                $status='rejected';$reference='';
                if ($member && $request && self::channelGrant($member,$row['channel'],true) && ClinicAccess::allowed($member,'clients') &&
                    ClinicAccess::allowed($member,'patients') && ($member['role']==='dealer' || $member['branch_id']===$row['branch_id'])) {
                    $state=(new WorkspaceRepository($this->db))->load('partner:'.$row['partner_id'])['state'];
                    (new ClientPermit($this->db))->overlay($row['partner_id'],$state->clients??[]);
                    $branch=ClinicAccess::branch($state,$row['branch_id']);
                    $client=array_column($state->clients??[],null,'id')[$row['client_id']]??null;
                    $channel=$row['channel'];
                    if ($branch && (($branch->sharedWith??'')?:$branch->id)===$row['data_branch'] && $client &&
                        $client->branch===$row['data_branch'] && ($client->$channel??'')==='Var' &&
                        DealerLogin::normalizePhone($client->phone??'')===$job['phone']) {
                        $this->db->prepare("UPDATE clinic_bulk_message SET status='sending' WHERE id=?")->execute([$row['id']]);
                        if ($viaPhone) {
                            try {$reference='phone:'.(new PhoneGateway($this->db))->enqueue($row['partner_id'],$channel,$job['phone'],$job['message'],'bulk',$row['id'],2,time(),time()+3*86400);$status='accepted';}
                            catch (\Throwable) {$status='rejected';}
                        } else {
                            try {[$status,$reference]=AppointmentReminders::send($request,$channel);}
                            catch (\Throwable) {$status='unknown';}
                        }
                    }
                }
                $this->db->prepare("UPDATE clinic_bulk_message SET status=?,provider_ref=?,payload='{}' WHERE id=?")
                    ->execute([$status,$reference,$row['id']]);
            }
        } finally {
            $this->db->query("SELECT RELEASE_LOCK($lock)");
        }
    }
}
