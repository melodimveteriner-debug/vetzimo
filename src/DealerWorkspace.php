<?php
declare(strict_types=1);

namespace VetNet\Cpanel;
require_once __DIR__ . '/ClinicChanges.php';

use PDO;
use RuntimeException;

require_once __DIR__ . '/ClinicRecordDeletion.php';
require_once __DIR__ . '/ClinicOperationDeletion.php';

final class DealerWorkspace
{
    /** Satışın açık bakiyesini kapatan, kasaya girmeyen kayıt (tahsilat yöntemi). */
    public const WRITE_OFF = 'Borç silme';
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

    public function readForUpdateRequest(array $actor, string $scope, int $revision, mixed $patch = null): array
    {
        if (!hash_equals($actor['membership_id'], $scope)) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $workspace = 'partner:'.$actor['partner_id'];
        $query = $this->database->prepare('SELECT revision FROM clinic_workspace WHERE user_id=?');
        $query->execute([$workspace]);
        if ((int)$query->fetchColumn() !== $revision) throw new RuntimeException('Kayıt alanı güncellendi.',409);
        // Büyük kliniklerde yalnız değişikliğin ilgilendirdiği satırlar okunur; uygun değilse tam yükleme.
        if ($patch !== null && PartialSave::$enabled) {
            $partial = (new PartialSave($this->database))->load($workspace, $revision, $patch);
            if ($partial !== null) return $partial;
        }
        return $this->workspaces->load($workspace);
    }

    public function database(): PDO
    {
        return $this->database;
    }

    /** Son taşımada aradaki revizyonlarda değişen satırlar (istemciye eşitleme için); taşıma yoksa null. */
    public ?array $rebased = null;

    /**
     * Eski revizyona dayanan kısmi kayıt (yama), aradaki yazımların değiştirdiği satırlara dokunmuyorsa güncel revizyona
     * taşınır. Personel–personel ve web randevusu eşzamanlı yazımlarında "Kayıt alanı güncellendi" uyarısı yerine
     * otomatik birleştirme yapılır. Aynı satır değiştiyse veya günlük eksikse 409 korunur (veri kaybı olmaz).
     */
    public function rebase(array $actor, int $revision, mixed $patch): int
    {
        $this->rebased = null;
        if (!$patch instanceof \stdClass) return $revision;
        $workspace = 'partner:'.$actor['partner_id'];
        $current = $this->workspaces->revision($workspace);
        if ($current <= $revision) return $revision;
        $changed = $this->workspaces->appendsBetween($workspace, $revision, $current);
        if ($changed === null || ClinicChanges::conflicts($patch, $changed)) return $revision;
        $this->rebased = $changed;
        return $current;
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

            $partial = $preloaded['partial'] ?? null;
            $current = $this->workspaces->revision('partner:'.$actor['partner_id']);
            if ($partial !== null && $current !== $revision) { $this->database->rollBack(); return null; }
            $original = $preloaded !== null && $preloaded['revision'] === $revision && $current === $revision
                ? $preloaded : $this->workspaces->load('partner:'.$actor['partner_id']);
            if ($original['revision'] !== $revision) { $this->database->rollBack(); return null; }
            if ($actor['role'] !== 'dealer' || isset($actor['packageModules'])) $this->checkChanges($original['state'],$state,$actor);
            $result = $this->workspaces->save('partner:' . $actor['partner_id'], $revision, $state, $original['state'], $partial);
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
                        // Borç silme: satışın bakiyesini kapatır ama kasaya para girmez (defterde 0). Yalnız yönetici veya
                        // "Tahsilat iptali" yetkisi olan personel yapabilir; yetkisizse tüm kayıt geri alınır.
                        // Tahsilat indirimi ("İndirim"): satışın kalanını indirimle kapatır, kasaya girmez; aynı yetki kuralı.
                        if($type==='collections' && in_array($row->method ?? '',[self::WRITE_OFF,'İndirim'],true)) {
                            if(!ClinicAccess::action($actor,'deleteCollections',true)) throw new RuntimeException(($row->method==='İndirim'?'Tahsilat indirimi':'Borç silmek').' için yönetici veya "Tahsilat iptali" yetkisi gerekir.',403);
                            $amount=0;
                        }
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
        if (!is_string($collection) || (!isset(ClinicAccess::DELETE_GRANTS[$collection]) && $collection!=='tasks') || !is_string($id) ||
            !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $id) || !is_int($revision) || $revision < 1 ||
            ($input->confirm ?? null) !== true) {
            throw new RuntimeException('Silinecek kaydı ve silme onayını kontrol edin.',422);
        }

        // Oturum ve yetki işlem dışında doğrulanır; ardından çalışma alanı satırı kilitlenir. Böylece aynı anda
        // silen ekranlar birbirini "kayıtlar güncellendi" hatasıyla düşürmez, sırayla güncel sürüm üzerinde çalışır
        // (kilitli okuma tutarlı okumadan önce yapıldığı için yükleme en son kaydedilen durumu görür).
        $actor = $this->actor($cookies, $now);
        $this->database->beginTransaction();
        try {
            if (!ClinicAccess::deleteAllowed($actor,$collection)) {
                throw new RuntimeException('Bu işlem için ilgili modülde yazma ve silme yetkisi gerekir.',403);
            }
            if (!hash_equals($actor['membership_id'], $scope)) {
                throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            }
            $partner = $actor['partner_id'];
            $workspace = 'partner:'.$partner;
            $lock = $this->database->prepare('SELECT revision FROM clinic_workspace WHERE user_id=? FOR UPDATE');
            $lock->execute([$workspace]);
            $head = (int)$lock->fetchColumn();
            $current = $this->workspaces->load($workspace);
            if ($head < 1 || $current['revision'] !== $head || $revision > $head) {
                throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.',409);
            }
            $revision = $head;

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
                // Hasta sahibi silinince aile fotoğrafları da kalıcı olarak silinir (web sitesinden de kalkar).
                if ($collection==='clients') { try { $this->database->prepare('DELETE FROM clinic_family_photo WHERE partner_id=? AND client_id=?')->execute([$partner,$id]); } catch (\PDOException $e) { if ($e->getCode()!=='42S02') throw $e; } }
            } else {
                (new ClinicOperationDeletion($this->database))->apply($state,$actor,$collection,$row);
            }
            $saved = $this->workspaces->save($workspace, $revision, $state);
            if ($saved === null) throw new RuntimeException('Kayıtlar güncellendi. Sayfayı yenileyip tekrar deneyin.',409);

            $audit = match($collection) {'patients'=>'patient.deleted','clients'=>'client.deleted',default=>$collection.'.deleted'};
            $this->database->prepare('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)')
                ->execute([$partner, $actor['account_id'], $audit, $saved]);
            $this->database->commit();
            // Hafif yanıt: istemci yalnız değişen satırları değişiklik günlüğünden (?since=) çeker; büyük klinikte
            // tüm çalışma alanını (onlarca MB) geri göndermek silmeyi saniyelerce bekletiyordu.
            if (($input->light ?? null) === true) return ['revision'=>$saved,'since'=>$revision];
            return ['revision'=>$saved,'state'=>ClinicAccess::visible($state,$actor)];
        } catch (\Throwable $error) {
            if ($this->database->inTransaction()) $this->database->rollBack();
            throw $error;
        }
    }

    /** Kalanı indirimle kapatma: liste (GET) veya seçilenleri kapat (POST, sunucuda gerçek kalanla). */
    public function saleDiscounts(array $cookies, string $scope, int $now, ?object $body): array
    {
        $actor = $this->actor($cookies, $now);
        if ($body === null) return SaleDiscounts::list($this->workspaces, $actor);
        if (!hash_equals($actor['membership_id'], $scope)) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        return SaleDiscounts::close($this->database, $this->workspaces, $actor, is_array($body->ids ?? null) ? $body->ids : [], $now);
    }

    /** Aşı devamları: önizleme (GET) veya oluşturma (POST, çalışma alanı kilitli). */
    public function vaccineContinuations(array $cookies, string $scope, int $now, bool $apply): array
    {
        $actor = $this->actor($cookies, $now);
        if ($apply && !hash_equals($actor['membership_id'], $scope)) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        return VaccineContinuation::run($this->database, $this->workspaces, $actor, $apply, $now);
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
                $same=property_exists($visible,$key) && $value == $visible->$key;
                if($same) continue;
                // Satış ve reçete kaydı stoğu düşer: ürün/stok yazma izni olmayan kişi yalnız bu stok etkisini yazabilir.
                if(!self::stockEffect($key,(array)($visible->$key ?? []),is_array($value)?$value:[],$actor)) throw new RuntimeException('Bu alanı değiştirme yetkiniz yok.',403);
            }
            if(!is_array($value)) throw new RuntimeException('Kayıt listesi geçersiz.',422);
            $outside=array_values(array_filter($original->$key,fn($r)=>$r->branch!==$dataId));
            $outsideIds=array_fill_keys(array_column($outside,'id'),true);
            foreach($value as $row) if(!is_object($row)||($row->branch ?? '')!==$dataId||!is_string($row->id ?? null)||isset($outsideIds[$row->id])) throw new RuntimeException('Şube erişimi reddedildi.',403);
            $next->$key=[...$value,...$outside];
        }
        return $next;
    }
    /**
     * Satış (Satış izni) veya reçete (Hasta izni) kaydının zorunlu stok etkisi mi? Ürünlerde yalnız stok sayısı, stok
     * partilerinde yalnız giren/kalan miktar değişebilir (yeni parti yalnız "Önceki stok bakiyesi" açılış partisi olabilir),
     * stok hareketlerine yalnız yetkili kaynaktan yeni satır eklenebilir; fiyat, ad, alış ve silme yapılamaz.
     */
    private static function stockEffect(string $key,array $before,array $after,array $actor): bool
    {
        if (!in_array($key,['products','stockLots','stockMoves'],true)) return false;
        $sources=[];
        if (ClinicAccess::allowed($actor,'sales',true)) $sources[]='Satış';
        if (ClinicAccess::allowed($actor,'prescriptions',true)) $sources[]='Reçete';
        if (!$sources) return false;
        $old=[]; foreach ($before as $row) if (is_object($row) && is_string($row->id ?? null)) $old[$row->id]=$row;
        $strip=static function(object $row,array $fields): array { $a=(array)$row; foreach ($fields as $f) unset($a[$f]); ksort($a); return $a; };
        $seen=[];
        foreach ($after as $row) {
            if (!is_object($row) || !is_string($row->id ?? null)) return false;
            $seen[$row->id]=true;
            $prev=$old[$row->id] ?? null;
            if ($key==='products') {
                if (!$prev || $strip($row,['stock','updatedAt'])!=$strip($prev,['stock','updatedAt'])) return false;
                if (!is_numeric((string)($row->stock ?? '0'))) return false;
            } elseif ($key==='stockLots') {
                if ($prev) { if ($strip($row,['received','remaining'])!=$strip($prev,['received','remaining'])) return false; }
                elseif (($row->id ?? '')!=='initial-'.($row->product ?? '') || ($row->reason ?? '')!=='Önceki stok bakiyesi' || ($row->buy ?? '')!=='') return false;
                if (!is_numeric((string)($row->remaining ?? '')) || (float)$row->remaining<0) return false;
            } else {
                if ($prev) { if ($row!=$prev) return false; }
                elseif (!in_array((string)($row->source ?? ''),$sources,true) || !is_numeric((string)($row->delta ?? ''))) return false;
            }
        }
        foreach (array_keys($old) as $id) if (!isset($seen[$id])) return false;
        return true;
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
        if ($actor === null) throw new RuntimeException('Oturumunuzun süresi doldu veya başka bir yerden çıkış yapıldı. Girdiğiniz bilgiler kaybolmasın diye bu sekmeyi kapatmadan yeni sekmede /app adresinden giriş yapın, sonra burada tekrar Kaydet\'e basın.', 401);
        if (!in_array($actor['role'],['dealer','branch','staff'],true)) {
            throw new RuntimeException('Bu çalışma alanına erişim yetkiniz yok.', 403);
        }

        if ($actor['role']!=='dealer' && !ClinicAccess::branch(
            (object)['branches'=>$this->workspaces->branches('partner:'.$actor['partner_id'])],$actor['branch_id']
        )) throw new RuntimeException('Şube erişimi doğrulanamadı.',403);
        return (new Commerce($this->database))->packageActor($actor);
    }
}
