<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

final class WebBooking
{
    public function __construct(private readonly PDO $db,private readonly WebBuilder $web) {}
    public static function booked(object $record): bool
    {
        return !in_array($record->status??'',['İptal','İptal Edildi','Reddedildi','Tamamlandı','Gelmedi'],true);
    }
    public static function needsAlert(object $record): bool
    {
        $when = ($record->date ?? '').'T'.($record->time ?? '');
        return self::booked($record) && ($record->status ?? '') !== 'Görüşüldü' &&
            ($record->reviewedFor ?? '') !== $when;
    }
    private static function minutes(string $time): int
    {
        if (!preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/D',$time)) return -1;
        return (int)substr($time,0,2)*60+(int)substr($time,3,2);
    }
    private static function clock(int $minutes): string
    {
        return sprintf('%02d:%02d',intdiv($minutes,60),$minutes%60);
    }
    public static function overlap(object $slot,object $other): bool
    {
        if ($slot->id===$other->id || $slot->branch!==$other->branch || $slot->date!==$other->date || !self::booked($other)) return false;
        $start=self::minutes($other->time??'');
        if ($start<0) return true;
        $end=self::minutes($other->endTime??'');
        return self::minutes($slot->time)<($end>$start?$end:$start+30) && $start<self::minutes($slot->endTime);
    }
    private function workspace(string $partner): array
    {
        return (new WorkspaceRepository($this->db))->load('partner:'.$partner);
    }
    /** Yalnız şube + randevu (herkese açık saat listesi ve sık yoklanan web randevu uyarıları tüm kliniği belleğe almaz). */
    private function appointmentsOnly(string $partner): ?object
    {
        return (new ClinicRecords($this->db))->collections('partner:'.$partner, ['appointments'])
            ?? $this->workspace($partner)['state'];
    }
    public static function returnPath(mixed $value): ?string
    {
        if (!is_string($value) || strlen($value)>270 ||
            !preg_match('~\A/(?:web|siteler)/[a-z0-9-]{1,63}/(?:randevu|evde-hizmet|evden-takip)(?:\?[A-Za-z0-9_=&-]+)?\z~D',$value)) return null;
        [$path,$query]=array_pad(explode('?',$value,2),2,'');
        parse_str($query,$fields);
        $path=preg_replace('~^/siteler/~','/web/',$path);
        $safe=[];
        foreach (['branch'=>'[A-Za-z0-9_-]{1,80}','date'=>'[0-9]{4}-[0-9]{2}-[0-9]{2}','duzenle'=>'web-[a-f0-9]{32}'] as $key=>$pattern) {
            if (is_string($fields[$key]??null) && preg_match('~\A'.$pattern.'\z~D',$fields[$key])) $safe[$key]=$fields[$key];
        }
        return $path.($safe?'?'.http_build_query($safe):'');
    }

    public static function mathQuestion(string $partner,string $key,int $now): array
    {
        $left=random_int(3,15);
        $right=random_int(1,10);
        $op=$right<=$left&&random_int(0,1)===1?'-':'+';
        $payload=$now.','.$left.','.$op.','.$right.','.bin2hex(random_bytes(12));
        $sig=hash_hmac('sha256',"web-booking\n".$partner."\n".$payload,$key);
        return ['label'=>$left.' '.($op==='-'?'−':'+').' '.$right.' = ?', 'token'=>$payload.'.'.$sig];
    }

    public static function verifyMath(string $partner,string $key,int $now,array $post): void
    {
        $token=$post['security_token']??'';
        $answer=$post['security_answer']??'';
        if (!is_string($token) || !is_string($answer) || !preg_match('/\A[0-9]{1,2}\z/D',trim($answer)) ||
            !preg_match('/\A((\d{1,12}),(\d{1,2}),([+-]),(\d{1,2}),[a-f0-9]{24})\.([a-f0-9]{64})\z/D',$token,$m) ||
            (int)$m[2]>$now || (int)$m[2]<$now-900 ||
            !hash_equals(hash_hmac('sha256',"web-booking\n".$partner."\n".$m[1],$key),$m[6]) ||
            (int)$answer!==($m[4]==='-'?(int)$m[3]-(int)$m[5]:(int)$m[3]+(int)$m[5])) {
            throw new RuntimeException('Güvenlik sorusunu cevaplayıp yeniden gönderin.',422);
        }
    }

    public function verifiedClient(string $partner,?array $actor,object $state): ?object
    {
        if (($actor['role']??null)!=='customer' || $actor['partner_id']!==$partner || !ClinicAccess::valid($actor,$state)) return null;
        if (!$this->web->query('SELECT COALESCE(NULLIF(phone_verified_at,0),verified_at) FROM identity_account WHERE id=?',[$actor['account_id']])->fetchColumn()) return null;
        $branch=ClinicAccess::branch($state,$actor['branch_id']);
        $scope=($branch->sharedWith??'')?:$branch->id;
        foreach ($state->clients??[] as $client) if ($client->id===$actor['customer_id'] && $client->branch===$scope) return $client;
        return null;
    }

    public function formIdentity(string $partner,?array $actor): array
    {
        if (($actor['role']??null)!=='customer' || $actor['partner_id']!==$partner) return [null,[]];
        $state=(new WorkspaceRepository($this->db))->bookingState('partner:'.$partner,$actor['customer_id'])
            ?? $this->workspace($partner)['state'] ?? (object)[];
        $client=$this->verifiedClient($partner,$actor,$state);
        if (!$client) return [null,[]];
        $patients=array_values(array_filter($state->patients??[],static fn($p)=>$p->owner===$client->id && $p->branch===$client->branch));
        return [$client,$patients];
    }

    public function verifiedPatients(string $partner,?array $actor): array
    {
        return $this->formIdentity($partner,$actor)[1];
    }

    public static function changeable(object $row): bool
    {
        $now=new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul'));
        return in_array($row->status??'',['Onay Bekliyor','Onaylandı','Planlandı','Bekliyor'],true)
            && (($row->date??'').' '.($row->time??''))>$now->format('Y-m-d H:i');
    }

    public static function changeVersion(object $row): string
    {
        return hash('sha256',$row->date.'|'.$row->time.'|'.$row->status.'|'.$row->patient);
    }

    public function ownerAppointment(array $site,?array $actor,string $id,?object $state=null): array
    {
        if (!preg_match('/\Aweb-[a-f0-9]{32}\z/D',$id)) throw new RuntimeException('Randevu bulunamadı.',404);
        $state??=$this->workspace($site['partner_id'])['state']??(object)[];
        $client=$this->verifiedClient($site['partner_id'],$actor,$state);
        if (!$client || (ClinicAccess::modules($actor)->appointments??'none')!=='read') throw new RuntimeException('Randevu bulunamadı.',404);
        $visit=$this->web->query('SELECT visit_branch FROM clinic_web_appointment WHERE partner_id=? AND id=?',[$site['partner_id'],$id])->fetchColumn();
        $patientIds=[];
        foreach ($state->patients??[] as $pet) if ($pet->owner===$client->id && $pet->branch===$client->branch) $patientIds[$pet->id]=true;
        foreach ($state->appointments??[] as $row) {
            if ($visit && $row->id===$id && $row->branch===$client->branch && $row->client===$client->id && isset($patientIds[$row->patient])) {
                return [$row,$visit];
            }
        }
        throw new RuntimeException('Randevu bulunamadı.',404);
    }

    public function change(array $site,array $draft,?array $actor,array $post): void
    {
        $partner=$site['partner_id'];
        $this->web->transaction(function() use($site,$draft,$actor,$post,$partner) {
            $current=$this->web->site($partner,true);
            if (!$current || $current['control_status']==='paused' || $current['published']!==$site['published']) throw new RuntimeException('Randevu sayfasını yenileyin.',409);
            $data=$this->workspace($partner);
            $state=$data['state']??(object)[];
            [$row,$branch]=$this->ownerAppointment($site,$actor,WebBuilder::text($post['duzenle']??'',36),$state);
            $version=$post['change_version']??'';
            if (!self::changeable($row) || !is_string($version) || !hash_equals(self::changeVersion($row),$version)) {
                throw new RuntimeException('Bu randevu değişmiş veya artık düzenlenemiyor.',409);
            }
            $before=self::eventFields($row);
            if (($post['action']??'')==='cancel') {
                $row->status='İptal Edildi';
                $this->web->query('DELETE FROM clinic_web_mail WHERE partner_id=? AND appointment_id=? AND sent_at IS NULL',[$partner,$row->id]);
            } else {
                $date=WebBuilder::text($post['date']??'',10);
                $time=WebBuilder::text($post['time']??'',5);
                $slot=$this->slots($site,$draft,$branch,$date,$state,$this->staffFor($site,$draft,$branch,$row->clinician??''),$row->id)[$time]??null;
                if (!$slot || $slot->branch!==$row->branch) throw new RuntimeException('Bu saat uygun değil. Başka bir saat seçin.',409);
                foreach (['date','time','endTime','clinician'] as $key) $row->$key=$slot->$key;
                $row->status=!empty($draft['booking']['autoConfirm'])?'Onaylandı':'Onay Bekliyor';
            }
            if (!(new WorkspaceRepository($this->db))->save('partner:'.$partner,$data['revision'],$state)) {
                throw new RuntimeException('Takvim güncellendi. Tekrar deneyin.',409);
            }
            $this->event($partner,$row->id,$actor,$before,self::eventFields($row));
            if (class_exists(DeliveryNotice::class)) (new DeliveryNotice($this->db))->add($partner,$branch,'','clinic',
                'web-change:'.$row->id.':'.$this->db->lastInsertId(),$row->status==='İptal Edildi'?'Web randevusu iptal edildi':'Web randevusu güncellendi',
                '/clinic#record/appointments/'.rawurlencode($row->id));
        });
    }

    /** Aynı kişiyi farklı yazımlarda (büyük/küçük harf, aksan, ı/i, fazla boşluk) eşleştirir. */
    public static function person(string $name): string
    {
        $name=mb_strtolower(str_replace(['I','İ'],['ı','i'],trim($name)),'UTF-8');
        if (class_exists(\Normalizer::class)) $name=(string)\Normalizer::normalize($name,\Normalizer::FORM_D);
        return str_replace('ı','i',preg_replace(['/\p{Mn}+/u','/\s+/u'],['',' '],$name)??$name);
    }
    /** Web randevusunda ziyaretçinin seçebileceği personel: [üyelik kimliği => ad]. Tek görevli seçildiyse ya da liste boşsa seçim yoktur. */
    public function staffOptions(array $site,array $draft,string $branch): array
    {
        $rules=$draft['booking']??[];
        if (($rules['providers'][$branch]??'')!=='') return [];
        $roster=$this->web->roster($site['partner_id'],$branch);
        $chosen=$rules['staff'][$branch]??null;
        return is_array($chosen)?array_intersect_key($roster,array_flip($chosen)):$roster;
    }
    /** Taşınan randevu aynı kişide kalır; kişi artık listede değilse ilk uygun kişiye geçer. */
    public function staffFor(array $site,array $draft,string $branch,string $name): string
    {
        $hit=array_search(self::person($name),array_map([self::class,'person'],$this->staffOptions($site,$draft,$branch)),true);
        return $hit===false?'':(string)$hit;
    }
    private function onLeave(string $partner,array $members,string $day): array
    {
        if (!$members) return [];
        $query=$this->db->prepare('SELECT member_id,starts,ends FROM clinic_staff_plan WHERE partner_id=? AND kind=\'leave\' AND status=\'approved\' AND starts<? AND ends>? AND member_id IN ('.implode(',',array_fill(0,count($members),'?')).')');
        $query->execute([$partner,$day.' 23:59:59',$day.' 00:00:00',...$members]);
        $leave=[];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) $leave[$row['member_id']][]=[substr($row['starts'],0,16),substr($row['ends'],0,16)];
        return $leave;
    }
    public function slots(array $site,array $draft,string $branch,string $day,?object $state=null,string $staff='',string $ignore=''): array
    {
        $rules=$draft['booking']??[];
        $start=date_create_immutable_from_format('!Y-m-d',$day,new DateTimeZone('Europe/Istanbul'));
        $now=new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul'));
        if (empty($rules['enabled']) || !$start || $start->format('Y-m-d')!==$day || $day<$now->format('Y-m-d') ||
            $day>$now->modify('+60 days')->format('Y-m-d') || !in_array($branch,$rules['branches']??[],true) ||
            in_array($day,$rules['holidays']??[],true)) return [];
        $state??=$this->appointmentsOnly($site['partner_id']);
        $branchRow=null;
        foreach ($state->branches??[] as $row) if ($row->id===$branch && ($row->status??'')!=='Pasif') $branchRow=$row;
        if (!$branchRow) return [];
        $dataBranch=($branchRow->sharedWith??'')?:$branchRow->id;
        $duration=(int)($rules['duration']??30);
        if (!in_array($duration,[15,20,30,45,60],true)) return [];
        $provider=$rules['providers'][$branch]??'';
        $roster=$provider!==''?$this->web->roster($site['partner_id'],$branch):[];
        if ($provider!=='' && !isset($roster[$provider])) return [];
        $providerHours=$rules['providerHours'][$branch][$start->format('N')]??[];
        $busy=array_filter($state->appointments??[],static fn($row)=>$row->branch===$dataBranch && $row->date===$day && self::booked($row) && ($ignore==='' || ($row->id??'')!==$ignore));
        $team=$provider===''?$this->staffOptions($site,$draft,$branch):[];
        if ($staff!=='' && !isset($team[$staff])) return [];
        if ($team) {
            // Personel kipinde her çalışan ayrı bir takvimdir; adı eşleşmeyen (atanmamış) randevular ortak kapasiteden düşer.
            $everyone=array_map([self::class,'person'],$this->web->roster($site['partner_id'],$branch));
            $keys=array_map([self::class,'person'],$team);
            $leave=$this->onLeave($site['partner_id'],array_map('strval',array_keys($team)),$day);
        }
        $times=[];
        foreach ($rules['hours'][$branch][$start->format('N')]??[] as [$from,$to]) {
            $startMinute=self::minutes($from);$endMinute=self::minutes($to);
            for ($minute=$startMinute;$startMinute>=0 && $minute+$duration<=$endMinute;$minute+=$duration) {
                $time=self::clock($minute);
                if ($day===$now->format('Y-m-d') && $time<=$now->format('H:i')) continue;
                $end=self::clock($minute+$duration);
                if ($provider!=='' && !array_filter($providerHours,static fn($range)=>$range[0]<=$time && $end<=$range[1])) continue;
                $slot=(object)['id'=>'','branch'=>$dataBranch,'date'=>$day,'time'=>$time,'endTime'=>$end,'clinician'=>$roster[$provider]??'Klinik ataması bekleniyor'];
                if ($team) {
                    $free=$team;$shared=0;
                    foreach ($busy as $other) if (self::overlap($slot,$other)) {
                        $who=self::person($other->clinician??'');
                        $hit=$who===''?false:array_search($who,$keys,true);
                        if ($hit!==false) unset($free[$hit]); elseif ($who==='' || !in_array($who,$everyone,true)) $shared++;
                    }
                    foreach ($leave as $member=>$ranges) foreach ($ranges as [$from,$to]) {
                        if ($from<$day.' '.$end && $day.' '.$time<$to) unset($free[$member]);
                    }
                    if (count($free)-$shared<1 || ($staff!=='' && !isset($free[$staff]))) continue;
                    $slot->clinician=$staff!==''?$team[$staff]:reset($free);
                    $times[$time]=$slot;
                    continue;
                }
                foreach ($busy as $other) if (self::overlap($slot,$other)) continue 2;
                $times[$time]=$slot;
            }
        }
        ksort($times);
        return $times;
    }
    public function book(array $site,array $draft,?array $actor,array $post): string
    {
        $partner=$site['partner_id'];
        $requested=WebBuilder::text($post['branch']??'',80);
        $day=WebBuilder::text($post['date']??'',10);
        $time=WebBuilder::text($post['time']??'',5);
        $patientId=WebBuilder::text($post['patient_id']??'',80);
        $visitor=[];
        foreach (['name'=>160,'phone'=>32,'email'=>254,'animal'=>160,'species'=>80,'service'=>250,'notes'=>1500] as $key=>$limit) {
            $visitor[$key]=WebBuilder::text($post[$key]??'',$limit);
        }
        if ($patientId!=='') {
            $visitor['phone']=$actor['identifier']??'';
            $visitor['name']=$actor['name']??'';
        }
        $visitor['phone']=WebBuilder::phone($visitor['phone']);
        if (!$visitor['name'] || !$visitor['phone'] || !$visitor['service'] || (!$patientId && (!$visitor['animal'] || !$visitor['species'])) ||
            ($visitor['email'] && !filter_var($visitor['email'],FILTER_VALIDATE_EMAIL)) || ($post['consent']??'')!=='yes') {
            throw new RuntimeException('Ad, telefon, hayvan bilgisi, ziyaret nedeni ve aydınlatma onayı gerekli.',422);
        }
        $this->db->beginTransaction();
        try {
            $current=$this->web->site($partner,true);
            if (!$current || $current['control_status']==='paused' || $current['published']!==$site['published']) throw new RuntimeException('Site yayın bilgisi değişti. Sayfayı yenileyin.',409);
            // Ziyaretçi talebi (hasta sahibi oturumu yok): yalnız randevular okunur ve tek satır eklenir; büyük klinikte
            // tüm çalışma alanı belleğe alınıp yeniden yazılmaz. Eski biçimde veya oturumlu talepte tam yol kullanılır.
            $fast=false;
            if ($patientId==='' && (new WorkspaceRepository($this->db))->appendable('partner:'.$partner)) {
                $lock=$this->db->prepare('SELECT revision FROM clinic_workspace WHERE user_id=? FOR UPDATE');
                $lock->execute(['partner:'.$partner]);
                $revision=$lock->fetchColumn();
                $light=$revision===false?null:(new ClinicRecords($this->db))->collections('partner:'.$partner,['appointments']);
                if ($light) { $data=['revision'=>(int)$revision,'state'=>$light]; $fast=true; }
            }
            if (!$fast) $data=$this->workspace($partner);
            $state=$data['state'];
            if ($requested==='' && $state) {
                $enabled=array_values(array_filter($state->branches??[],static fn($row)=>
                    ($row->status??'')!=='Pasif' && in_array($row->id,$draft['booking']['branches']??[],true)));
                if (count($enabled)===1) $requested=$enabled[0]->id;
            }
            $staff=WebBuilder::text($post['staff']??'',80);
            $slot=$state?$this->slots($site,$draft,$requested,$day,$state,$staff)[$time]??null:null;
            if (!$slot) throw new RuntimeException('Bu saat artık uygun değil. Başka bir saat seçin.',409);
            $slot->client='';
            $slot->patient='';
            $client=$patientId!==''?$this->verifiedClient($partner,$actor,$state):null;
            if ($client && $client->branch===$slot->branch) foreach ($state->patients??[] as $patient) {
                if ($patient->id===$patientId && $patient->branch===$slot->branch && $patient->owner===$client->id) {
                    $slot->client=$client->id;$slot->patient=$patient->id;
                    $visitor['animal']=$patient->name;$visitor['species']=$patient->species??'';
                    $visitor['name']=$client->name;
                    break;
                }
            }
            if ($patientId!=='' && $slot->patient==='') throw new RuntimeException('Hasta, telefon veya şube bilgisi doğrulanamadı.',422);
            $visitor['release']=(string)$site['published'];
            $visitor['privacy_sha256']=hash('sha256',$draft['booking']['privacy']);
            $slot->id='web-'.bin2hex(random_bytes(16));
            $slot->status=!empty($draft['booking']['autoConfirm'])?'Onaylandı':'Onay Bekliyor';
            $slot->service=$visitor['service'];
            $slot->notes=implode("\n",array_filter(['Kaynak: Web Sitesi',($slot->patient?'Doğrulanmış hasta sahibi: ':'Ziyaretçi: ').$visitor['name'],
                'Telefon: '.$visitor['phone'],$visitor['email']?'E-posta: '.$visitor['email']:'','Hayvan: '.$visitor['animal'].' · '.$visitor['species'],$visitor['notes']]));
            $slot->createdBy='Web Sitesi';$slot->createdAt=gmdate('c');
            $repository=new WorkspaceRepository($this->db);
            if ($fast) {
                if ($repository->append('partner:'.$partner,$data['revision'],'appointments',$slot)===null) throw new RuntimeException('Takvim güncellendi. Saati yeniden seçin.',409);
            } else {
                // Yalnız yeni randevu eklenir: önceki durum verilir ki değişmeyen tablolar yeniden yazılmasın.
                $original=clone $state;
                $state->appointments[]=$slot;
                if (!$repository->save('partner:'.$partner,$data['revision'],$state,$original)) throw new RuntimeException('Takvim güncellendi. Saati yeniden seçin.',409);
            }
            $this->web->query('INSERT INTO clinic_web_appointment(partner_id,id,visit_branch,visitor) VALUES (?,?,?,?)',[$partner,$slot->id,$requested,WebBuilder::json($visitor)]);
            $this->event($partner,$slot->id,['account_id'=>$slot->patient?$actor['account_id']:'','name'=>$slot->patient?$actor['name']:'Web Sitesi','role'=>$slot->patient?'customer':'visitor'],[],self::eventFields($slot));
            $this->web->query('INSERT INTO clinic_web_mail(partner_id,appointment_id,next_at) VALUES (?,?,?)',[$partner,$slot->id,time()]);
            if (class_exists(DeliveryNotice::class)) {
                $email=$visitor['email']?:($client->email??'');
                $target=$slot->client?'/hasta-sahibi?bildirim=appointments&kayit='.rawurlencode($slot->id):'/web/'.$site['slug'].'/randevu?kayit='.rawurlencode($slot->id);
                if ($slot->client||$email) (new DeliveryNotice($this->db))->add($partner,$slot->branch,$slot->client,
                    $slot->client?'appointments':'guest','web-book:'.$slot->id,'Web randevusu · '.$slot->status,$target,$email);
            }
            $this->web->stat($partner,'requests');
            $this->db->commit();
            return $slot->id;
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }
    private static function eventFields(object $row): array
    {
        return array_intersect_key((array)$row,array_fill_keys(['status','date','time','endTime','clinician','client','patient'],true));
    }
    private function event(string $partner,string $id,array $actor,array $before,array $after): void
    {
        $this->web->query('INSERT INTO clinic_web_appointment_event(partner_id,appointment_id,account_id,actor_name,actor_role,event,occurred_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP())',
            [$partner,$id,$actor['account_id'],$actor['name'],$actor['role'],WebBuilder::json(['before'=>$before,'after'=>$after])]);
    }
    public function auditWorkspace(object $prior,object $next,array $actor): void
    {
        $before=array_column($prior->appointments??[],null,'id');
        $after=array_column($next->appointments??[],null,'id');
        $webRows=array_filter($before,static fn($r)=>preg_match('/\Aweb-[a-f0-9]{32}\z/D',$r->id));
        if (!$webRows) return;
        foreach ($webRows as $id=>$old) {
            $row=$after[$id]??null;
            if (!$row || $row->branch!==$old->branch) throw new RuntimeException('Web randevusu silinemez veya başka şubeye taşınamaz.',422);
            $a=self::eventFields($old);$b=self::eventFields($row);
            if ($a!==$b && $this->web->query('SELECT id FROM clinic_web_appointment WHERE partner_id=? AND id=?',[$actor['partner_id'],$id])->fetchColumn()) {
                $this->event($actor['partner_id'],$id,$actor,$a,$b);
            }
        }
        foreach ($after as $id=>$row) {
            $old=$before[$id]??null;
            if (!self::booked($row) || ($old && self::booked($old) && ($row->date??'')===($old->date??'') && ($row->time??'')===($old->time??'') && ($row->endTime??'')===($old->endTime??''))) continue;
            if (self::minutes($row->time??'')<0) continue;
            $slot=clone $row;
            if (self::minutes($slot->endTime??'')<=self::minutes($slot->time)) $slot->endTime=self::clock(min(1439,self::minutes($slot->time)+30));
            foreach (isset($webRows[$id])?$after:array_intersect_key($after,$webRows) as $other) {
                if (self::overlap($slot,$other)) throw new RuntimeException('Bu saat bir web randevusuyla çakışıyor.',409);
            }
        }
    }
    public function alerts(array $actor,string $branch): array
    {
        if (!ClinicAccess::allowed($actor,'appointments')) throw new RuntimeException('Randevu erişimi yok.',403);
        $state=$this->appointmentsOnly($actor['partner_id']);
        $visible=ClinicAccess::visible($state,$actor);
        $appointments=array_column($visible->appointments??[],null,'id');
        $rows=$this->web->query('SELECT a.id,a.visit_branch,a.visitor,e.id AS event_id,
                UNIX_TIMESTAMP(COALESCE(e.occurred_at,a.created_at)) + 86400 AS expires_at
            FROM clinic_web_appointment a LEFT JOIN clinic_web_appointment_event e ON e.id=(
                SELECT x.id FROM clinic_web_appointment_event x WHERE x.partner_id=a.partner_id AND x.appointment_id=a.id
                ORDER BY x.id DESC LIMIT 1)
            WHERE a.partner_id=? AND a.visit_branch=? AND COALESCE(e.occurred_at,a.created_at)>UTC_TIMESTAMP()-INTERVAL 24 HOUR
            ORDER BY event_id DESC,a.id DESC', [$actor['partner_id'],$actor['role']==='dealer'?$branch:$actor['branch_id']]);
        $branches=array_column($visible->branches??[],'name','id');
        $items=[];
        while (count($items)<50 && ($row=$rows->fetch())) {
            $item=$appointments[$row['id']]??null;
            if (!$item || !self::needsAlert($item)) continue;
            $visitor=WebBuilder::decode($row['visitor']);
            $items[]=['id'=>$item->id,'name'=>$visitor['animal']?:$visitor['name'],'date'=>$item->date,'time'=>$item->time,
                'status'=>$item->status,'event'=>$row['event_id']??0,'branch'=>$branches[$row['visit_branch']]??'Şube',
                'expiresAt'=>(int)$row['expires_at']];
        }
        return $items;
    }
}
