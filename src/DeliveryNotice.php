<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;

final class DeliveryNotice
{
    public function __construct(private readonly PDO $db) {}

    public function add(string $partner,string $branch,string $client,string $kind,string $key,string $title,string $target,
        string $email='',string $membership=''): void
    {
        try {
            $this->db->prepare('INSERT INTO clinic_delivery_notice(partner_id,branch_id,customer_id,membership_id,recipient_email,kind,dedupe,title,target,next_at)
                VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id')->execute(
                [$partner,$branch,$client,$membership,filter_var($email,FILTER_VALIDATE_EMAIL)?:'',$kind,hash('sha256',$key),$title,$target,time()]);
        } catch (PDOException $error) {
            if ($error->getCode()!=='42S02') throw $error;
        }
    }

    public function appointments(string $partner,object $before,object $after,int $revision): void
    {
        $old=array_column($before->appointments??[],null,'id');
        $patients=array_column($after->patients??[],null,'id');
        $clients=array_column($after->clients??[],null,'id');
        foreach ($after->appointments??[] as $row) {
            if (str_starts_with($row->id,'visit-')) continue;
            $prior=$old[$row->id]??null;
            $keys=['status','date','time','endTime','patient','client'];
            if ($prior && array_intersect_key((array)$prior,array_flip($keys))==array_intersect_key((array)$row,array_flip($keys))) continue;
            $label=$prior?'Randevu güncellendi':'Yeni randevu';
            $status=$row->status??'';
            if (in_array($status,['Onaylandı','İptal Edildi','İptal','Reddedildi','Tamamlandı'],true)) $label='Randevu · '.$status;
            $clinicTarget='/clinic#record/appointments/'.rawurlencode($row->id);
            $this->add($partner,$row->branch,'','clinic',"appointment:clinic:$revision:$row->id",$label,$clinicTarget);
            $patient=$patients[$row->patient??'']??null;
            $clientId=$patient&&$patient->branch===$row->branch?$patient->owner:($row->client??'');
            $client=$clients[$clientId]??null;
            if ($client&&$client->branch===$row->branch) {
                $this->add($partner,$row->branch,$clientId,'appointments',"appointment:owner:$revision:$row->id",$label,
                    '/hasta-sahibi?bildirim=appointments&kayit='.rawurlencode($row->id),$client->email??'');
            } elseif (!$clientId&&str_starts_with($row->id,'web-')) {
                $q=$this->db->prepare('SELECT a.visitor,s.slug FROM clinic_web_appointment a JOIN clinic_web_site s ON s.partner_id=a.partner_id
                    WHERE a.partner_id=? AND a.id=?');
                $q->execute([$partner,$row->id]);
                $booking=$q->fetch();
                if ($booking) {
                    $email=WebBuilder::decode($booking['visitor'])['email']??'';
                    if ($email) $this->add($partner,$row->branch,'','guest',"appointment:guest:$revision:$row->id",$label,
                        '/web/'.$booking['slug'].'/randevu?kayit='.rawurlencode($row->id),$email);
                }
            }
        }
    }

    public function queueClinicReminders(int $now, float $budget=20.0): void
    {
        $day=WebBuilder::today();
        $limit=(new \DateTimeImmutable($day))->modify('+30 days')->format('Y-m-d');
        $workspace=new WorkspaceRepository($this->db);
        $records=new ClinicRecords($this->db);
        $closed=['Tamamlandı','İptal','İptal Edildi','Reddedildi','Gelmedi'];
        // Aşı/takip uyarısı yalnız son 7 günde vadesi gelenler için açılır; içe aktarılan yıllar öncesine ait
        // yapılmamış kayıtlar kliniğe binlerce e-posta olarak düşmez.
        $since=(new \DateTimeImmutable($day))->modify('-7 days')->format('Y-m-d');
        // 10.000 bayide tek çalışmada tüm bayiler taranmaz: her çalışma en fazla $budget sn sürer ve kaldığı bayiden devam eder
        // (randevu uyarısı 24 saat önceden açıldığından birkaç çalışmalık tur gecikme yaratmaz).
        $cursorId='00000000000000000000000000000010';
        $cursor=$this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='delivery_cursor'");
        $cursor->execute([$cursorId]);
        $after=(string)(json_decode((string)$cursor->fetchColumn(),true)['after'] ?? '');
        $list=$this->db->prepare('SELECT id FROM partner_account WHERE active=1 AND id>? ORDER BY id LIMIT 2000');
        $deadline=microtime(true)+$budget;
        $last='';
        $list->execute([$after]);
        $partners=$list->fetchAll(PDO::FETCH_COLUMN);
        if (!$partners && $after!=='') { $list->execute(['']); $partners=$list->fetchAll(PDO::FETCH_COLUMN); }
        foreach ($partners as $partner) {
            if (microtime(true)>$deadline) break;
            $last=$partner;
            $state=$records->collections('partner:'.$partner,['appointments','stays','followups','products','stockLots'])
                ?? $workspace->load('partner:'.$partner)['state'];
            if (!$state) continue;
            foreach (['appointments','stays'] as $type) foreach ($state->$type??[] as $row) {
                $status=$row->status??'';
                $when=$type==='stays'?($row->end??''):($row->date??'').'T'.($row->time??'');
                if ($type==='stays'?!in_array($status,['Planlandı','Yatışta'],true):in_array($status,$closed,true)) continue;
                $timestamp=strtotime($when.'+03:00');
                if ($timestamp===false||$timestamp<$now||$timestamp>$now+86400||($row->reviewedFor??'')===$when) continue;
                $this->add($partner,$row->branch,'','clinic',"reminder:$type:$row->id:$when",
                    $type==='stays'?'Konaklama süresi yaklaşıyor':'Yaklaşan randevu','/clinic#record/'.$type.'/'.rawurlencode($row->id));
            }
            foreach ($state->followups??[] as $row) {
                if (empty($row->date)||$row->date>$day||$row->date<$since||!empty($row->done)||in_array($row->status??'',$closed,true)||($row->status??'')==='Yapıldı') continue;
                $this->add($partner,$row->branch,'','clinic',"followup:$row->id:$row->date",
                    'Aşı ve takip uyarısı','/clinic#record/followups/'.rawurlencode($row->id));
            }
            $lots=[];
            foreach ($state->stockLots??[] as $lot) $lots[$lot->product][]=$lot;
            foreach ($state->products??[] as $row) {
                if (($row->archived??'')==='Evet'||($row->track??'')==='Hayır'||($row->category??'')==='Hizmet') continue;
                $target='/clinic#product/'.rawurlencode($row->id);
                $min=$row->min??'';
                $stock=$row->stock??'';
                $key=$stock.':'.$min;
                if ($min!==''&&is_numeric($min)&&is_numeric($stock)&&(float)$stock<=(float)$min&&($row->criticalReviewedFor??'')!==$key) {
                    $this->add($partner,$row->branch,'','clinic',"critical:$row->id:$key",'Kritik stok uyarısı',$target);
                }
                foreach ($lots[$row->id]??[$row] as $lot) {
                    $expiry=$lot->expiry??'';
                    if ($expiry<$day||$expiry>$limit||(float)($lot->remaining??$stock)<=0||($lot->reviewedFor??'')===$expiry) continue;
                    $this->add($partner,$row->branch,'','clinic',"expiry:$lot->id:$expiry",'Son kullanma tarihi yaklaşıyor',$target);
                }
            }
        }
        $next=count($partners)<2000 && $last===end($partners) ? '' : $last;
        $this->db->prepare("INSERT INTO center_management(id,kind,payload) VALUES (?,'delivery_cursor',?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)")
            ->execute([$cursorId,json_encode(['after'=>$next,'at'=>$now])]);
    }

    public function send(Notifications $smtp,string $origin,int $now): void
    {
        $q=$this->db->prepare("SELECT * FROM clinic_delivery_notice WHERE sent_at IS NULL AND next_at<=? AND attempts<10
            AND (kind='clinic' OR recipient_email<>'') ORDER BY next_at,id LIMIT 50");
        $q->execute([$now]);
        $recipient=$this->db->prepare("SELECT c.email FROM clinic_contact c JOIN identity_membership m ON m.id=c.membership_id
            JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            WHERE m.partner_id=? AND m.status='active' AND (m.role='dealer' OR (m.role='branch' AND m.branch_id=?)) AND c.email<>''
            ORDER BY (m.role='dealer') DESC,m.id LIMIT 1");
        $update=$this->db->prepare('UPDATE clinic_delivery_notice SET sent_at=?,next_at=?,attempts=attempts+1 WHERE id=?');
        foreach ($q->fetchAll() as $row) {
            $sent=null;
            try {
                $dealer=$smtp->dealer($row['partner_id']);
                $settings=$dealer->settings();
                $mailer=$settings['smtpEnabled']?$dealer:$smtp;
                $email=$row['recipient_email'];
                if ($row['kind']==='clinic') {
                    $recipient->execute([$row['partner_id'],$row['branch_id']]);
                    $email=$settings['admin']?:$recipient->fetchColumn();
                }
                if (!$email) throw new \RuntimeException('Bildirim e-posta adresi eksik.');
                $mailer->send('smtp',$email,'VetZimo — '.$row['title'],$row['title']."\n\n".rtrim($origin,'/').$row['target']);
                $sent=time();
            } catch (\Throwable $failure) {
                error_log('VetZimo bildirim e-postası yeniden denenecek. Kayıt: '.$row['id']);
            }
            $update->execute([$sent,$now+min(43200,180*2**min(8,(int)$row['attempts'])),$row['id']]);
        }
    }

    public function owner(array $actor,object $state,?string $read): array
    {
        $branch=ClinicAccess::branch($state,$actor['branch_id']);
        $scope=[$actor['partner_id'],($branch->sharedWith??'')?:$actor['branch_id'],$actor['customer_id'],$actor['membership_id']];
        $modules=ClinicAccess::modules($actor);
        $kinds=['homecare'];
        foreach (['appointments','shares','exam','lab','xray'] as $kind) if (($modules->$kind??'')==='read') $kinds[]=$kind;
        $allowed=implode(',',array_fill(0,count($kinds),'?'));
        $where="partner_id=? AND branch_id=? AND customer_id=? AND (membership_id='' OR membership_id=?) AND kind IN ($allowed)";
        $params=[...$scope,...$kinds];
        $homeWhere='r.partner_id=? AND r.customer_id=? AND e.action NOT IN (\'request\',\'record\') AND e.author<>?';
        $homeParams=[$scope[0],$scope[2],$actor['account_id']];
        if ($read!==null && preg_match('/\A(notice|visit):([1-9][0-9]{0,18})\z/D',$read,$m)) {
            if ($m[1]==='notice') $this->db->prepare("UPDATE clinic_delivery_notice SET read_at=? WHERE $where AND id=? AND read_at IS NULL")
                ->execute([time(),...$params,$m[2]]);
            else $this->db->prepare("INSERT IGNORE INTO clinic_visit_read(membership_id,event_id)
                SELECT ?,e.id FROM clinic_visit_event e JOIN clinic_visit_request r ON r.id=e.visit_id WHERE $homeWhere AND e.id=?")
                ->execute([$scope[3],...$homeParams,$m[2]]);
        }
        $rows=[];
        $q=$this->db->prepare("SELECT id,title,target,created_at,read_at FROM clinic_delivery_notice WHERE $where ORDER BY id DESC LIMIT 45");
        $q->execute($params);
        foreach ($q->fetchAll() as $row) $rows[]=['id'=>'notice:'.$row['id'],'title'=>$row['title'],'url'=>$row['target'],
            'time'=>$row['created_at'],'unread'=>$row['read_at']===null];
        $q=$this->db->prepare("SELECT e.id,e.status,e.action,e.created_at,r.id AS visit_id,x.event_id AS seen FROM clinic_visit_event e
            JOIN clinic_visit_request r ON r.id=e.visit_id LEFT JOIN clinic_visit_read x ON x.event_id=e.id AND x.membership_id=?
            WHERE $homeWhere ORDER BY e.id DESC LIMIT 45");
        $q->execute([$scope[3],...$homeParams]);
        foreach ($q->fetchAll() as $row) $rows[]=['id'=>'visit:'.$row['id'],'title'=>'Evde Hizmet · '.($row['action']==='verify'?'Ödeme tahsil edildi':HomeVisit::STATUS[$row['status']]),
            'url'=>'/hasta-sahibi?bildirim=visit&talep='.$row['visit_id'],'time'=>$row['created_at'],'unread'=>$row['seen']===null];
        usort($rows,static fn($a,$b)=>[$b['unread'],$b['time'],$b['id']]<=>[$a['unread'],$a['time'],$a['id']]);
        return array_slice($rows,0,50);
    }
}
