<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

require_once __DIR__ . '/ClinicRecordDeletion.php';
require_once __DIR__ . '/ClinicOperationDeletion.php';

final class DealerWorkspace
{
    private readonly WorkspaceRepository $workspaces;
    private readonly SessionRepository $sessions;

    public function __construct(private readonly PDO $database)
    {
        $this->workspaces = new WorkspaceRepository($database);
        $this->sessions = new SessionRepository($database);
    }

    public function read(array $cookies, int $now): array
    {
        $actor = $this->actor($cookies, $now);
        return $this->workspaces->load('partner:' . $actor['partner_id']);
    }

    public function readForUpdateRequest(array $actor, string $scope, int $revision): array
    {
        if (!hash_equals($actor['membership_id'], $scope)) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $workspace = 'partner:'.$actor['partner_id'];
        $query = $this->database->prepare('SELECT revision FROM clinic_workspace WHERE user_id=?');
        $query->execute([$workspace]);
        if ((int)$query->fetchColumn() !== $revision) throw new RuntimeException('Kayıt alanı güncellendi.',409);
        return $this->workspaces->load($workspace);
    }

    /**
     * Internal persistence boundary. Domain validation, audit, and subscription
     * checks must run in the caller before exposing a workspace write API.
     */
    /**
     * @param array{revision:int,state:object}|null $preloaded Çağıranın aynı revizyonda daha önce yüklediği
     *        ve değiştirmediği durum. Verilirse ikinci kez tam yükleme yapılmaz (büyük kliniklerde bellek ve süre).
     */
    public function writeValidated(array $cookies, string $scope, int $now, int $revision, object $state, ?array $preloaded = null): ?int
    {
        $this->database->beginTransaction();
        try {
            $actor = $this->actor($cookies, $now, true);
            if (!hash_equals($actor['membership_id'], $scope)) {
                throw new RuntimeException('Çalışma alanı oturumu değişti.', 409);
            }

            $original = $preloaded !== null && $preloaded['revision'] === $revision
                && $this->workspaces->revision('partner:'.$actor['partner_id']) === $revision
                ? $preloaded : $this->workspaces->load('partner:'.$actor['partner_id']);
            if ($original['revision'] !== $revision) { $this->database->rollBack(); return null; }
            if ($actor['role'] !== 'dealer' || isset($actor['packageModules'])) $this->checkChanges($original['state'],$state,$actor);
            $result = $this->workspaces->save('partner:' . $actor['partner_id'], $revision, $state, $original['state']);
            if ($result !== null) {
                if (class_exists(DeliveryNotice::class)) (new DeliveryNotice($this->database))->appointments($actor['partner_id'],$original['state'] ?? (object)[],$state,$result);
                $hasWebAppointments = array_filter($original['state']->appointments ?? [],
                    static fn($row) => preg_match('/\Aweb-[a-f0-9]{32}\z/D', $row->id));
                if ($hasWebAppointments) {
                    (new WebBooking($this->database,new WebBuilder($this->database,[])))->auditWorkspace($original['state'],$state,$actor);
                }
                foreach(['sales','collections','payments','expenses','purchases'] as $type) {
                    $prior=[];
                    foreach($original['state']->$type ?? [] as $row) $prior[$row->id]=true;
                    foreach($state->$type ?? [] as $row) if(!isset($prior[$row->id])) {
                        $amount=Finance::money($type==='sales'?($row->paid ?? '0'):$row->amount);
                        if($type==='payments'||($type==='expenses'&&$row->type==='Gider')) $amount=-$amount;
                        $this->database->prepare('INSERT INTO finance_entry(partner_id,branch_id,source_type,source_id,entry_date,amount_cents,account_id) VALUES (?,?,?,?,?,?,?)')
                            ->execute([$actor['partner_id'],$row->branch,$type,$row->id,$row->date,$amount,$actor['account_id']]);
                    }
                }
                $previousCash=array_column($original['state']->expenses??[],null,'id');
                foreach ($state->expenses??[] as $row) {
                    $old=$previousCash[$row->id]??null;
                    if (!$old || $old==$row) continue;
                    if (!ClinicAccess::allowed($actor,'expenses',true) || !ClinicAccess::action($actor,'cashCorrect',true)) {
                        throw new RuntimeException('Kasa kaydını düzeltme yetkiniz yok.',403);
                    }
                    ClinicOperationDeletion::recordCashAdjustment($this->database,$actor,$old,'undo-'.$result,-1);
                    ClinicOperationDeletion::recordCashAdjustment($this->database,$actor,$row,'redo-'.$result,1);
                }
                $this->database->prepare('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)')
                    ->execute([$actor['partner_id'],$actor['account_id'],'workspace.saved',$result]);
            }
            $this->database->commit();
            return $result;
        } catch (\Throwable $error) {
            $this->database->rollBack();
            throw $error;
        }
    }

    public function deleteRecord(array $cookies, string $scope, int $now, object $input): array
    {
        $collection = $input->collection ?? null;
        $id = $input->id ?? null;
        $revision = $input->revision ?? null;
        if (!is_string($collection) || !isset(ClinicAccess::DELETE_GRANTS[$collection]) || !is_string($id) ||
            !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $id) || !is_int($revision) || $revision < 1 ||
            ($input->confirm ?? null) !== true) {
            throw new RuntimeException('Silinecek kaydı ve silme onayını kontrol edin.',422);
        }

        $this->database->beginTransaction();
        try {
            $actor = $this->actor($cookies, $now, true);
            if (!ClinicAccess::deleteAllowed($actor,$collection)) {
                throw new RuntimeException('Bu işlem için ilgili modülde yazma ve silme yetkisi gerekir.',403);
            }
            if (!hash_equals($actor['membership_id'], $scope)) {
                throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            }
            $partner = $actor['partner_id'];
            $workspace = 'partner:'.$partner;
            $current = $this->workspaces->load($workspace);
            if ($current['revision'] !== $revision) {
                throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.',409);
            }

            $state = $current['state'];
            $source=$collection==='initialPayments'?'sales':$collection;
            $row=array_column($state->$source ?? [],null,'id')[$id]??null;
            $branch=$actor['role']!=='dealer'?ClinicAccess::branch($state,$actor['branch_id']):null;
            if (!$row || ($actor['role']!=='dealer' && (!$branch || $row->branch!== (($branch->sharedWith ?? '') ?: $branch->id)))) {
                throw new RuntimeException('Kayıt bulunamadı.',404);
            }
            if ($collection==='clients') foreach ($state->patients ?? [] as $patient) {
                if (($patient->owner??'')!==$id) continue;
                if (!ClinicAccess::deleteAllowed($actor,'patients') || ($branch && $patient->branch!==$row->branch)) {
                    throw new RuntimeException('Bağlı hastalar için hasta silme yetkisi gerekir.',403);
                }
            }

            if (in_array($collection,['patients','clients'],true)) {
                (new ClinicRecordDeletion($this->database))->apply($state,$partner,$collection,$id);
            } else {
                (new ClinicOperationDeletion($this->database))->apply($state,$actor,$collection,$row);
            }
            $saved = $this->workspaces->save($workspace, $revision, $state);
            if ($saved === null) throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.',409);

            $audit = match($collection) {'patients'=>'patient.deleted','clients'=>'client.deleted',default=>$collection.'.deleted'};
            $this->database->prepare('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)')
                ->execute([$partner, $actor['account_id'], $audit, $saved]);
            $this->database->commit();
            return ['revision'=>$saved,'state'=>ClinicAccess::visible($state,$actor)];
        } catch (\Throwable $error) {
            if ($this->database->inTransaction()) $this->database->rollBack();
            throw $error;
        }
    }

    public function visible(array $cookies,int $now): array
    {
        $actor=$this->actor($cookies,$now);
        return $this->visibleFor($actor);
    }
    public function visibleBranches(array $actor): array
    {
        $branches = $this->workspaces->branches('partner:'.$actor['partner_id']);
        if ($actor['role'] === 'dealer') return $branches;
        if (!in_array($actor['role'], ['branch','staff'], true)) throw new RuntimeException('Klinik erişimi doğrulanamadı.',403);
        $branch = ClinicAccess::branch((object)['branches'=>$branches], $actor['branch_id']);
        if (!$branch) throw new RuntimeException('Şube erişimi doğrulanamadı.',403);
        return [$branch];
    }

    public function visibleFor(array $actor): array
    {
        $workspace = 'partner:'.$actor['partner_id'];
        if (in_array($actor['role'], ['staff','branch'], true)) {
            $branch = $this->visibleBranches($actor)[0];
            $data = $this->workspaces->load($workspace, ($branch->sharedWith ?? '') ?: $branch->id, $actor);
        } else {
            $data = $this->workspaces->load($workspace);
        }
        if($data['state']) $data['state']=ClinicAccess::visible($data['state'],$actor);
        return $data;
    }
    public function merge(object $original,object $requested,array $actor): object
    {
        if($actor['role']==='dealer') {
            if (!isset($actor['packageModules'])) return $requested;
            $next=clone $requested;
            foreach (ClinicAccess::MODULES as $collections) foreach ($collections as $key) {
                if (!property_exists($original,$key) || ClinicAccess::allowed($actor,$key,true)) continue;
                $visible=ClinicAccess::allowed($actor,$key)?$original->$key:[];
                if (($requested->$key ?? [])!=$visible) throw new RuntimeException('Abonelik paketi bu değişikliğe izin vermiyor.',403);
                $next->$key=$original->$key;
            }
            return $next;
        }
        $visible=ClinicAccess::visible($original,$actor);
        $branch=ClinicAccess::branch($original,$actor['branch_id']);
        $dataId=($branch->sharedWith ?? '') ?: $branch->id;
        $next=clone $original;
        foreach($requested as $key=>$value) {
            if($key==='activity') continue;
            if(!ClinicAccess::allowed($actor,$key,true)) {
                if(!property_exists($visible,$key) || $value != $visible->$key) throw new RuntimeException('Bu alanı değiştirme yetkiniz yok.',403);
                continue;
            }
            if(!is_array($value)) throw new RuntimeException('Kayıt listesi geçersiz.',422);
            $outside=array_values(array_filter($original->$key,fn($r)=>$r->branch!==$dataId));
            $outsideIds=array_fill_keys(array_column($outside,'id'),true);
            foreach($value as $row) if(!is_object($row)||($row->branch ?? '')!==$dataId||!is_string($row->id ?? null)||isset($outsideIds[$row->id])) throw new RuntimeException('Şube erişimi reddedildi.',403);
            $next->$key=[...$value,...$outside];
        }
        return $next;
    }
    private function checkChanges(object $original,object $next,array $actor): void
    {
        if ($actor['role']==='dealer') {
            foreach (ClinicAccess::MODULES as $collections) foreach ($collections as $key) {
                if (!ClinicAccess::allowed($actor,$key,true) && ($original->$key ?? [])!=($next->$key ?? [])) {
                    throw new RuntimeException('Abonelik paketi bu değişikliğe izin vermiyor.',403);
                }
            }
            return;
        }
        $visible=ClinicAccess::visible($next,$actor);
        $merged=$this->merge($original,$visible,$actor);
        if($merged != $next) throw new RuntimeException('İzin dışı kayıt değişikliği.',403);
    }

    public function actor(array $cookies, int $now, bool $forUpdate = false): array
    {
        $actor = $this->sessions->resolve($cookies, $now, $forUpdate);
        if ($actor === null || !in_array($actor['role'],['dealer','branch','staff'],true)) {
            throw new RuntimeException('Bu çalışma alanına erişim yetkiniz yok.', 403);
        }

        if ($actor['role']!=='dealer' && !ClinicAccess::branch(
            (object)['branches'=>$this->workspaces->branches('partner:'.$actor['partner_id'])],$actor['branch_id']
        )) throw new RuntimeException('Şube erişimi doğrulanamadı.',403);
        return (new Commerce($this->database))->packageActor($actor);
    }
}
