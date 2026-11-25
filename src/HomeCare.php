<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

require_once __DIR__.'/HomeCareTriage.php';
require_once __DIR__.'/ClinicRecords.php';

final class HomeCare
{
    private const OBSERVATIONS=['routine','change','contact'];
    private const DECISIONS=['reviewed','contact','called'];
    private const CHECKIN_FIELDS=[
        'appetite'=>['usual','less','none'],
        'water'=>['usual','less','more'],
        'activity'=>['usual','less','more'],
        'medication'=>['given','missed','none'],
        'stool'=>['normal','soft','diarrhea','bloody','none'],
        'urine'=>['normal','less','more','bloody','unable'],
        'vomit'=>['0','1','2','3plus'],
        'comfort'=>['calm','restless','pain'],
        'wound'=>['clean','red','discharge','open'],
    ];

    public function __construct(private readonly PDO $db) {}

    private const LEVEL_RANK="CASE triage WHEN 'urgent' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END";

    /**
     * Yalnız gereken hasta ve müşteri satırlarını okur (büyük klinikte tüm alanı belleğe almaz).
     * Hasta sahibinin kendi müşteri kaydı yetki denetimi için her zaman eklenir. Bir satır
     * bulunamazsa (eski biçimli alan) güvenli tam yüklemeye geçilir.
     */
    private function workspace(array $actor,array $patients=[],array $clients=[],bool $strict=true): object
    {
        if ($actor['role']==='customer') $clients[]=$actor['customer_id'];
        $wanted=['patients'=>array_values(array_unique($patients)),'clients'=>array_values(array_unique($clients))];
        $state=(new ClinicRecords($this->db))->slice('partner:'.$actor['partner_id'],$wanted);
        if ($state && $strict) {
            foreach ($wanted as $collection=>$ids) {
                $found=array_column($state->$collection,null,'id');
                foreach ($ids as $id) if (!isset($found[$id])) { $state=null; break 2; }
            }
        }
        $state??=(new WorkspaceRepository($this->db))->load('partner:'.$actor['partner_id'])['state'];
        if (!$state || !ClinicAccess::valid($actor,$state)) throw new RuntimeException('Klinik erişimi doğrulanamadı.',403);
        return $state;
    }

    /** Hasta sahibine gösterilecek klinik telefonları: şube telefonu ve varsa acil / nöbet telefonu. */
    private function contact(array $actor,object $state,string $branchId): array
    {
        $branch=ClinicAccess::branch($state,$branchId);
        $phone=trim((string)($branch->phone ?? ''));
        if ($phone==='') $phone=trim((string)($state->preferences->phone ?? ''));
        if ($phone==='') {
            $q=$this->db->prepare('SELECT phone FROM partner_account WHERE id=?');
            $q->execute([$actor['partner_id']]);
            $phone=trim((string)$q->fetchColumn());
        }
        $emergency=trim((string)($branch->emergencyPhone ?? $state->preferences->emergencyPhone ?? ''));
        return ['clinic'=>$branch->name ?? '','phone'=>mb_substr($phone,0,40),'emergency'=>$emergency===$phone?'':mb_substr($emergency,0,40)];
    }

    private function dataBranch(object $state,string $branchId): string
    {
        $branch=ClinicAccess::branch($state,$branchId);
        if (!$branch) throw new RuntimeException('Şube bulunamadı.',404);
        return ($branch->sharedWith ?? '') ?: $branch->id;
    }

    private function patientScope(array $actor,object $state,string $id): array
    {
        $customer=$actor['role']==='customer';
        $branch=$actor['role']==='dealer'?null:$this->dataBranch($state,$actor['branch_id']);
        foreach ($state->patients ?? [] as $patient) {
            if ($patient->id!==$id || ($branch!==null && $branch!==$patient->branch)) continue;
            if ($customer && $patient->owner!==$actor['customer_id']) break;
            if (empty($patient->owner)) break;
            return [$actor['partner_id'],$patient->id,$patient->owner,$patient->branch];
        }
        throw new RuntimeException('Evde takip kaydı bulunamadı.',404);
    }

    public function queue(array $actor,string $branchId): array
    {
        if (!ClinicAccess::allowed($actor,'patients')) throw new RuntimeException('Evde takip erişimi yok.',403);
        // Şube yalnız üst veriden doğrulanır; ardından yalnız bekleyen gözlemlerin hastaları okunur.
        $meta=$this->workspace($actor);
        $branch=$this->dataBranch($meta,$actor['role']==='dealer'?$branchId:$actor['branch_id']);
        $q=$this->db->prepare("SELECT patient_id,customer_id,observation,triage,COUNT(*) AS total,MIN(created_at) AS oldest
            FROM clinic_homecare_checkin WHERE partner_id=? AND branch_id=? AND decision IS NULL
            GROUP BY patient_id,customer_id,observation,triage ORDER BY ".self::LEVEL_RANK.",(observation='contact') DESC,oldest");
        $q->execute([$actor['partner_id'],$branch]);
        $groups=$q->fetchAll();
        $callbackRows=[];
        if (array_filter($groups,static fn($row)=>$row['observation']==='contact')) {
            $q=$this->db->prepare("SELECT c.id,c.patient_id,c.customer_id,c.created_at,c.triage,d.submitted_name
                FROM clinic_homecare_checkin c LEFT JOIN clinic_homecare_checkin_detail d
                ON d.partner_id=c.partner_id AND d.checkin_id=c.id
                WHERE c.partner_id=? AND c.branch_id=? AND c.decision IS NULL AND c.observation='contact'
                ORDER BY ".str_replace('triage','c.triage',self::LEVEL_RANK).",c.created_at DESC,c.id DESC LIMIT 200");
            $q->execute([$actor['partner_id'],$branch]);
            $callbackRows=$q->fetchAll();
        }
        $state=$this->workspace($actor,array_column($groups,'patient_id'),array_column($callbackRows,'customer_id'),false);
        $patients=[];
        foreach ($state->patients ?? [] as $patient) if ($patient->branch===$branch) $patients[$patient->id]=$patient;
        $owners=array_column($state->clients ?? [],'name','id');
        $rows=[];
        $total=$callbackCount=$urgentCount=$soonCount=0;
        foreach ($groups as $row) {
            $patient=$patients[$row['patient_id']] ?? null;
            if (!$patient || $patient->owner!==$row['customer_id']) continue;
            $count=(int)$row['total'];
            $total+=$count;
            if ($row['observation']==='contact') $callbackCount+=$count;
            if ($row['triage']==='urgent') $urgentCount+=$count;
            elseif ($row['triage']==='soon') $soonCount+=$count;
            if(count($rows)<12) {
                unset($row['customer_id']);
                $rows[]=$row+['name'=>$patient->name];
            }
        }
        $callbacks=[];
        foreach ($callbackRows as $row) {
            $patient=$patients[$row['patient_id']] ?? null;
            if (!$patient || $patient->owner!==$row['customer_id']) continue;
            $caller=$row['submitted_name'] ?: ($owners[$row['customer_id']] ?? 'Hasta sahibi');
            unset($row['customer_id'],$row['submitted_name']);
            $callbacks[]=$row+['patient_name'=>$patient->name,'caller'=>$caller];
            if (count($callbacks)>=20) break;
        }
        return ['total'=>$total,'items'=>$rows,'callbackCount'=>$callbackCount,'callbacks'=>$callbacks,
            'urgentCount'=>$urgentCount,'soonCount'=>$soonCount];
    }

    public function patient(array $actor,string $id,?object $input): array
    {
        $customer=$actor['role']==='customer';
        if (!$customer && !ClinicAccess::allowed($actor,'patients',$input!==null)) {
            throw new RuntimeException('Evde takip erişimi yok.',403);
        }
        if ($input) {
            $this->db->beginTransaction();
            try {
                // Serialize new follow-up links with the dealer's record deletion.
                $partner=$this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');
                $partner->execute([$actor['partner_id']]);
                $partner->fetchColumn();
                $state=$this->workspace($actor,[$id]);
                $scope=$this->patientScope($actor,$state,$id);
                $this->save($actor,$scope,$input,$state);
                $this->db->commit();
            } catch (\Throwable $e) {
                $this->db->rollBack();
                throw $e;
            }
        } else {
            $state=$this->workspace($actor,[$id]);
            $scope=$this->patientScope($actor,$state,$id);
        }
        $where='partner_id=? AND patient_id=? AND customer_id=? AND branch_id=?';
        $q=$this->db->prepare("SELECT instructions,active,updated_at FROM clinic_homecare_plan WHERE ".$where);
        $q->execute($scope);
        $plan=$q->fetch()?:null;
        $q=$this->db->prepare('SELECT c.id,c.patient_id,c.observation,c.note,c.created_at,c.decision,c.response,c.reviewed_at,
            c.triage,c.triage_reasons,d.submitted_name,d.reviewed_name,d.details FROM clinic_homecare_checkin c LEFT JOIN clinic_homecare_checkin_detail d
            ON d.partner_id=c.partner_id AND d.checkin_id=c.id
            WHERE c.partner_id=? AND c.patient_id=? AND c.customer_id=? AND c.branch_id=?
            ORDER BY (c.decision IS NULL) DESC,IF(c.decision IS NULL,'.str_replace('triage','c.triage',self::LEVEL_RANK).',3) ASC,(c.observation=\'contact\' AND c.decision IS NULL) DESC,
            IF(c.decision IS NULL,c.created_at,NULL) ASC,c.created_at DESC,c.id DESC LIMIT 40');
        $q->execute($scope);
        $items=$q->fetchAll();
        foreach ($items as &$item) {
            $item['details']=json_decode($item['details'] ?? '{}',true,32,JSON_THROW_ON_ERROR);
            $item['triage_reasons']=$item['triage_reasons']===''?[]:explode(',',$item['triage_reasons']);
        }
        unset($item);
        return ['plan'=>$plan,'items'=>$items,'canWrite'=>!$customer&&ClinicAccess::allowed($actor,'patients',true),
            'contact'=>$this->contact($actor,$state,$scope[3])];
    }

    private function validateText(mixed $value,int $bytes,bool $required=false): string
    {
        if (!is_string($value)||strlen($value)>$bytes||($required&&trim($value)==='')) {
            throw new RuntimeException('Metin alanını kontrol edin.',422);
        }
        return trim($value);
    }

    private function checkinDetails(mixed $input): array
    {
        if (!is_object($input)) throw new RuntimeException('Gözlem alanlarını kontrol edin.',422);
        $out=[];
        foreach (self::CHECKIN_FIELDS as $key=>$choices) {
            $value=$input->$key ?? '';
            if ($value==='') continue;
            if (!in_array($value,$choices,true)) throw new RuntimeException('Gözlem alanlarını kontrol edin.',422);
            $out[$key]=$value;
        }
        $weight=$input->weight ?? '';
        if ($weight!=='') {
            if (!is_string($weight)||!preg_match('/\A[0-9]{1,4}(?:[.,][0-9]{1,3})?\z/',$weight)||!((float)str_replace(',','.',$weight)>0)) {
                throw new RuntimeException('Kilo değerini kg olarak girin.',422);
            }
            $out['weight']=str_replace(',','.',$weight);
        }
        $temp=$input->temperature ?? '';
        if ($temp!=='') {
            if (!is_string($temp)||!preg_match('/\A[0-9]{2}(?:[.,][0-9])?\z/',$temp)) throw new RuntimeException('Ateşi derece olarak girin (ör. 38,6).',422);
            $t=(float)str_replace(',','.',$temp);
            if ($t<30||$t>45) throw new RuntimeException('Ateş değeri 30–45 °C arasında olmalı.',422);
            $out['temperature']=str_replace(',','.',$temp);
        }
        return $out;
    }

    private function save(array $actor,array $scope,object $input,object $state): void
    {
        $action=$input->action ?? '';
        $customer=$actor['role']==='customer';
        if ($action==='plan' && !$customer) {
            if (!is_bool($input->active ?? null)) throw new RuntimeException('Plan durumunu seçin.',422);
            $instructions=$this->validateText($input->instructions ?? '',6000,$input->active);
            $this->db->prepare('INSERT INTO clinic_homecare_plan
                (partner_id, patient_id, customer_id, branch_id, instructions, active, updated_by, updated_at)
                VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE customer_id=VALUES(customer_id),
                branch_id=VALUES(branch_id),instructions=VALUES(instructions),active=VALUES(active),
                updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)')
                ->execute([...$scope,$instructions,(int)$input->active,$actor['account_id']]);
            return;
        }
        if ($action!==($customer?'observe':'review')) throw new RuntimeException('Bu işlem için yetkiniz yok.',403);
        $id=$input->id ?? '';
        if (!is_string($id)||!preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/',$id)) {
            throw new RuntimeException('Kayıt kimliği geçersiz.',422);
        }
        if ($action==='observe' && $customer) {
            $observation=$input->observation ?? '';
            if (!in_array($observation,self::OBSERVATIONS,true)) throw new RuntimeException('Geçerli bir gözlem seçin.',422);
            $details=$this->checkinDetails($input->details ?? (object)[]);
            $note=$this->validateText($input->note ?? '',3000,$observation==='change' && !$details);
            $q=$this->db->prepare('SELECT id FROM clinic_homecare_checkin WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND id=?');
            $q->execute([...$scope,$id]);
            if ($q->fetchColumn()) return;
            // Ön değerlendirme her zaman sunucuda yapılır; tarayıcıdaki sonuç yalnız ekrandaki uyarı içindir.
            $triage=HomeCareTriage::evaluate($observation,$details,$note);
            $q=$this->db->prepare('INSERT INTO clinic_homecare_checkin
                (id,submitted_by,observation,note,created_at,triage,triage_reasons,partner_id,patient_id,customer_id,branch_id)
                SELECT ?,?,?,?,UTC_TIMESTAMP(),?,?,partner_id,patient_id,customer_id,branch_id FROM clinic_homecare_plan
                WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND active=1
                ON DUPLICATE KEY UPDATE id=clinic_homecare_checkin.id');
            $q->execute([$id,$actor['account_id'],$observation,$note,$triage['level'],mb_substr(implode(',',$triage['reasons']),0,255),...$scope]);
            if ($q->rowCount()===0) {
                $retry=$this->db->prepare('SELECT id FROM clinic_homecare_checkin WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND id=? FOR UPDATE');
                $retry->execute([...$scope,$id]);
                if (!$retry->fetchColumn()) throw new RuntimeException('Bu hayvan için açık evde bakım planı yok.',409);
                return;
            }
            $this->db->prepare('INSERT INTO clinic_homecare_checkin_detail (partner_id,checkin_id,submitted_name,details) VALUES (?,?,?,?)')
                ->execute([$scope[0],$id,$actor['name'] ?? null,json_encode($details,JSON_THROW_ON_ERROR)]);
            if (class_exists(DeliveryNotice::class) && ($triage['level']!=='routine' || $observation==='contact')) {
                [$kind,$title]=match (true) {
                    $triage['level']==='urgent'=>['urgent','Evden Takip · ACİL gözlem'],
                    $observation==='contact'=>['contact','Evden Takip · Aranma isteği'],
                    default=>['soon','Evden Takip · Öncelikli gözlem'],
                };
                (new DeliveryNotice($this->db))->add($scope[0],$scope[3],'','clinic','homecare:'.$kind.':'.$id,
                    $title,'/clinic#patient/'.rawurlencode($scope[1]).'/homecare');
            }
            return;
        }
        if ($action==='review' && !$customer) {
            $decision=$input->decision ?? '';
            if (!in_array($decision,self::DECISIONS,true)) throw new RuntimeException('İnceleme sonucunu seçin.',422);
            $message=$this->validateText($input->response ?? '',3000,true);
            $q=$this->db->prepare('UPDATE clinic_homecare_checkin SET decision=?,response=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP()
                WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND id=? AND decision IS NULL');
            $q->execute([$decision,$message,$actor['account_id'],...$scope,$id]);
            if ($q->rowCount()===0) throw new RuntimeException('Kayıt bulunamadı veya daha önce incelendi.',409);
            $this->db->prepare('INSERT INTO clinic_homecare_checkin_detail (partner_id,checkin_id,reviewed_name) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE reviewed_name=VALUES(reviewed_name)')
                ->execute([$scope[0],$id,$actor['name'] ?? null]);
            if (class_exists(DeliveryNotice::class)) {
                $client=array_column($this->workspace($actor,[],[$scope[2]])->clients??[],null,'id')[$scope[2]]??null;
                (new DeliveryNotice($this->db))->add($scope[0],$scope[3],$scope[2],'homecare','homecare:reply:'.$id,
                    'Evden Takip · Klinik yanıtı','/hasta-sahibi?bildirim=homecare&hasta='.rawurlencode($scope[1]).'&kayit='.rawurlencode($id),$client->email??'');
            }
            return;
        }
        throw new RuntimeException('Bu işlem için yetkiniz yok.',403);
    }
}
