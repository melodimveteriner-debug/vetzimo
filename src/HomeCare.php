<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class HomeCare
{
    private const OBSERVATIONS=['routine','change','contact'];
    private const DECISIONS=['reviewed','contact','called'];
    private const CHECKIN_FIELDS=[
        'appetite'=>['usual','less','none'],
        'water'=>['usual','less','more'],
        'activity'=>['usual','less','more'],
        'medication'=>['given','missed','none'],
    ];

    public function __construct(private readonly PDO $db) {}

    private function workspace(array $actor): object
    {
        $state=(new WorkspaceRepository($this->db))->load('partner:'.$actor['partner_id'])['state'];
        if (!$state || !ClinicAccess::valid($actor,$state)) throw new RuntimeException('Klinik erişimi doğrulanamadı.',403);
        return $state;
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
        $state=$this->workspace($actor);
        $branch=$this->dataBranch($state,$actor['role']==='dealer'?$branchId:$actor['branch_id']);
        $patients=[];
        foreach ($state->patients ?? [] as $patient) if ($patient->branch===$branch) $patients[$patient->id]=$patient;
        $owners=array_column($state->clients ?? [],'name','id');
        $q=$this->db->prepare("SELECT patient_id,customer_id,observation,COUNT(*) AS total,MIN(created_at) AS oldest
            FROM clinic_homecare_checkin WHERE partner_id=? AND branch_id=? AND decision IS NULL
            GROUP BY patient_id,customer_id,observation ORDER BY (observation='contact') DESC, oldest");
        $q->execute([$actor['partner_id'],$branch]);
        $rows=[];
        $total=0;
        $callbackCount=0;
        while ($row=$q->fetch()) {
            $patient=$patients[$row['patient_id']] ?? null;
            if (!$patient || $patient->owner!==$row['customer_id']) continue;
            $total+=(int)$row['total'];
            if ($row['observation']==='contact') $callbackCount+=(int)$row['total'];
            if(count($rows)<12) {
                unset($row['customer_id']);
                $rows[]=$row+['name'=>$patient->name];
            }
        }
        $callbacks=[];
        if ($callbackCount) {
            $q=$this->db->prepare("SELECT c.id,c.patient_id,c.customer_id,c.created_at,d.submitted_name
                FROM clinic_homecare_checkin c LEFT JOIN clinic_homecare_checkin_detail d
                ON d.partner_id=c.partner_id AND d.checkin_id=c.id
                WHERE c.partner_id=? AND c.branch_id=? AND c.decision IS NULL AND c.observation='contact'
                ORDER BY c.created_at DESC,c.id DESC");
            $q->execute([$actor['partner_id'],$branch]);
            while ($row=$q->fetch()) {
                $patient=$patients[$row['patient_id']] ?? null;
                if (!$patient || $patient->owner!==$row['customer_id']) continue;
                $caller=$row['submitted_name'] ?: ($owners[$row['customer_id']] ?? 'Hasta sahibi');
                unset($row['customer_id'],$row['submitted_name']);
                $callbacks[]=$row+['patient_name'=>$patient->name,'caller'=>$caller];
                if (count($callbacks)>=20) break;
            }
        }
        return ['total'=>$total,'items'=>$rows,'callbackCount'=>$callbackCount,'callbacks'=>$callbacks];
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
                $scope=$this->patientScope($actor,$this->workspace($actor),$id);
                $this->save($actor,$scope,$input);
                $this->db->commit();
            } catch (\Throwable $e) {
                $this->db->rollBack();
                throw $e;
            }
        } else {
            $scope=$this->patientScope($actor,$this->workspace($actor),$id);
        }
        $where='partner_id=? AND patient_id=? AND customer_id=? AND branch_id=?';
        $q=$this->db->prepare("SELECT instructions,active,updated_at FROM clinic_homecare_plan WHERE ".$where);
        $q->execute($scope);
        $plan=$q->fetch()?:null;
        $q=$this->db->prepare('SELECT c.id,c.patient_id,c.observation,c.note,c.created_at,c.decision,c.response,c.reviewed_at,
            d.submitted_name,d.reviewed_name,d.details FROM clinic_homecare_checkin c LEFT JOIN clinic_homecare_checkin_detail d
            ON d.partner_id=c.partner_id AND d.checkin_id=c.id
            WHERE c.partner_id=? AND c.patient_id=? AND c.customer_id=? AND c.branch_id=?
            ORDER BY (c.decision IS NULL) DESC,(c.observation=\'contact\' AND c.decision IS NULL) DESC,
            IF(c.decision IS NULL,c.created_at,NULL) ASC,c.created_at DESC,c.id DESC LIMIT 40');
        $q->execute($scope);
        $items=$q->fetchAll();
        foreach ($items as &$item) $item['details']=json_decode($item['details'] ?? '{}',true,32,JSON_THROW_ON_ERROR);
        unset($item);
        return ['plan'=>$plan,'items'=>$items,'canWrite'=>!$customer&&ClinicAccess::allowed($actor,'patients',true)];
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
        return $out;
    }

    private function save(array $actor,array $scope,object $input): void
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
            $q=$this->db->prepare('INSERT INTO clinic_homecare_checkin
                (id,submitted_by,observation,note,created_at,partner_id,patient_id,customer_id,branch_id)
                SELECT ?,?,?,?,UTC_TIMESTAMP(),partner_id,patient_id,customer_id,branch_id FROM clinic_homecare_plan
                WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND active=1
                ON DUPLICATE KEY UPDATE id=clinic_homecare_checkin.id');
            $q->execute([$id,$actor['account_id'],$observation,$note,...$scope]);
            if ($q->rowCount()===0) {
                $retry=$this->db->prepare('SELECT id FROM clinic_homecare_checkin WHERE partner_id=? AND patient_id=? AND customer_id=? AND branch_id=? AND id=? FOR UPDATE');
                $retry->execute([...$scope,$id]);
                if (!$retry->fetchColumn()) throw new RuntimeException('Bu hayvan için açık evde bakım planı yok.',409);
                return;
            }
            $this->db->prepare('INSERT INTO clinic_homecare_checkin_detail (partner_id,checkin_id,submitted_name,details) VALUES (?,?,?,?)')
                ->execute([$scope[0],$id,$actor['name'] ?? null,json_encode($details,JSON_THROW_ON_ERROR)]);
            if ($observation==='contact'&&class_exists(DeliveryNotice::class)) {
                (new DeliveryNotice($this->db))->add($scope[0],$scope[3],'','clinic','homecare:contact:'.$id,
                    'Evden Takip · Aranma isteği','/klinik#patient/'.rawurlencode($scope[1]).'/homecare');
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
                $client=array_column($this->workspace($actor)->clients??[],null,'id')[$scope[2]]??null;
                (new DeliveryNotice($this->db))->add($scope[0],$scope[3],$scope[2],'homecare','homecare:reply:'.$id,
                    'Evden Takip · Klinik yanıtı','/hasta-sahibi?bildirim=homecare&hasta='.rawurlencode($scope[1]).'&kayit='.rawurlencode($id),$client->email??'');
            }
            return;
        }
        throw new RuntimeException('Bu işlem için yetkiniz yok.',403);
    }
}
