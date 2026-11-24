<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

require_once __DIR__ . '/ClinicProtocol.php';
require_once __DIR__ . '/VaccineInventory.php';
require_once __DIR__ . '/StayCarePlan.php';
require_once __DIR__ . '/StayIcu.php';
require_once __DIR__ . '/VisitorConversion.php';
require_once __DIR__ . '/PartialSave.php';

use RuntimeException;
use stdClass;

final class ClinicApi
{
    private const RECORDS = ['visitors','clients','patients','appointments','exams','followups','weights','vaccineCatalog','labs','treatments','prescriptions','stays','surgeries','clinicNotes','products','suppliers','sales','purchases','collections','payments','expenses','stockLots','stockMoves','messages','templates','tasks'];
    private const LINKS = [
        'patients' => ['owner'=>'clients'],
        'messages'=>['client'=>'clients','patient'=>'patients','template'=>'templates'],
        'appointments' => ['patient'=>'patients','client'=>'clients'],
        'exams' => ['patient'=>'patients'],
        'followups' => ['patient'=>'patients','vaccine'=>'vaccineCatalog'],
        'sales'=>['client'=>'clients','patient'=>'patients'],'purchases'=>['supplier'=>'suppliers','product'=>'products'],'collections'=>['sale'=>'sales'],'payments'=>['purchase'=>'purchases'],'stockLots'=>['product'=>'products'],'stockMoves'=>['product'=>'products'],
        'weights'=>['patient'=>'patients'], 'labs'=>['patient'=>'patients','exam'=>'exams'],
        'treatments'=>['patient'=>'patients'], 'prescriptions'=>['patient'=>'patients'], 'stays'=>['patient'=>'patients'], 'surgeries'=>['patient'=>'patients'],
        'tasks'=>['patient'=>'patients','client'=>'clients'],
    ];
    private const ID = '/\A[A-Za-z0-9_-]{1,80}\z/';
    /** Yalnız testler için: yazmadan hemen önce doğrulanmış sonucu görür (null: kapalı). */
    public static ?\Closure $beforeWrite = null;

    public function __construct(private readonly DealerWorkspace $workspaces)
    {
    }

    public function save(array $cookies, string $scope, int $now, object $request, ?array &$clinicUpdates = null): int
    {
        if (!is_int($request->revision ?? null) || $request->revision < 1 ||
            (property_exists($request,'state') === property_exists($request,'patch'))) {
            throw new RuntimeException('Kayıt biçimi geçersiz.', 422);
        }
        $actor = $this->workspaces->actor($cookies,$now);
        $current = $this->workspaces->readForUpdateRequest($actor,$scope,$request->revision,
            property_exists($request,'patch') ? $request->patch : null);
        if ($request->revision !== $current['revision']) {
            throw new RuntimeException('Kayıt alanı güncellendi.', 409);
        }
        $original = $current['state'];
        $fingerprint = self::fingerprint($original);
        $state = property_exists($request,'patch') ?
            self::applyPatch(ClinicAccess::visible($original,$actor),$request->patch) : $request->state;
        if (!$state instanceof stdClass || ($state->version ?? null) !== 1) {
            throw new RuntimeException('Kayıt biçimi geçersiz.', 422);
        }
        $submitted = $this->workspaces->merge($original,$state,$actor);
        if($actor['role']==='dealer') {
            $rows=$submitted->branches ?? null;
            if(!is_array($rows)||count($rows)<1||count($rows)>2) throw new RuntimeException('En fazla 2 şube tanımlayabilirsiniz.',422);
            $ids=[];
            foreach($rows as $row) {
                if(!is_object($row)||!is_string($row->id ?? null)||!preg_match(self::ID,$row->id)||isset($ids[$row->id])||!is_string($row->name ?? null)||trim($row->name)==='') throw new RuntimeException('Şube bilgisi geçersiz.',422);
                foreach($row as $value) if(!is_string($value)||strlen($value)>4000) throw new RuntimeException('Şube alanı geçersiz.',422);
                $ids[$row->id]=$row;
            }
            foreach($original->branches as $row) {
                if(!isset($ids[$row->id])||($row->sharedWith ?? '')!==($ids[$row->id]->sharedWith ?? '')) throw new RuntimeException('Kayıtlı şubeyi silmek veya veri paylaşım düzenini değiştirmek mümkün değil.',422);
            }
            foreach($rows as $row) if(!empty($row->sharedWith)) {
                $target=$ids[$row->sharedWith] ?? null;
                if(!$target || $target->id===$row->id || !empty($target->sharedWith) || ($target->status ?? '')==='Pasif') throw new RuntimeException('Ortak şube seçimi geçersiz.',422);
            }
            if(!is_object($submitted->preferences ?? null)) throw new RuntimeException('Ayarlar geçersiz.',422);
            foreach($submitted->preferences as $value) if(!is_string($value)||strlen($value)>4000) throw new RuntimeException('Ayar alanı geçersiz.',422);
        }
        $branches = [];
        foreach ($submitted->branches ?? [] as $branch) {
            if (($branch->status ?? '') !== 'Pasif' && !empty($branch->id)) {
                $branches[$branch->sharedWith ?? $branch->id] = true;
                if (($branch->sharedWith ?? '') === '') $branches[$branch->id] = true;
            }
        }

        // Only record collections supported by this PHP port are writable.
        foreach ($submitted as $key => $value) {
            if (!in_array($key, [...self::RECORDS,'activity','branches','preferences'], true) &&
                (!property_exists($original, $key) || $value != $original->$key)) {
                throw new RuntimeException('Bu değişiklik henüz PHP sürümünde desteklenmiyor.', 501);
            }
        }

        $sealedStays = [];
        $next = clone $original;
        $next->branches=$submitted->branches;
        $next->preferences=$submitted->preferences;
        $indexed = [];
        foreach (self::RECORDS as $key) {
            // Ameliyat kayıtlarını bilmeyen eski önbellekli istemciler listeyi göndermezse mevcut kayıtlar korunur.
            $rows = $submitted->$key ?? ($key === 'visitors' ? [] : (in_array($key,['surgeries','tasks'],true) ? array_values($original->$key ?? []) : null));
            if (!is_array($rows) || !array_is_list($rows)) {
                throw new RuntimeException('Kayıt listesi geçersiz.', 422);
            }
            $previous = [];
            foreach ($original->$key ?? [] as $row) $previous[$row->id] = $row;
            $indexed[$key] = [];
            foreach ($rows as $position => $row) {
                $id = $row->id ?? '';
                $branch = $row->branch ?? '';
                if (!$row instanceof stdClass || !is_string($id) || !preg_match(self::ID, $id)
                    || !is_string($branch) || isset($indexed[$key][$id])
                    || (!isset($branches[$branch]) && ($previous[$id] ?? null) != $row)
                    || (isset($previous[$id]) && $previous[$id]->branch !== $branch)) {
                    throw new RuntimeException('Kayıt kimliği veya şubesi geçersiz.', 422);
                }
                foreach (get_object_vars($row) as $value) {
                    if (!is_string($value)) throw new RuntimeException('Kayıt alanı geçersiz.', 422);
                }
                $label = match ($key) {
                    'visitors','clients','patients','vaccineCatalog','products','suppliers','templates' => $row->name ?? '',
                    'weights' => $row->weight ?? '',
                    'sales','expenses' => $row->detail ?? '',
                    'collections','payments','purchases' => $row->amount ?? '',
                    'stockLots','stockMoves' => $row->product ?? '',
                    'labs' => $row->title ?? $row->type ?? '',
                    'treatments' => $row->title ?? '',
                    'prescriptions' => $row->drug ?? $row->title ?? '',
                    'messages' => $row->message ?? '',
                    'stays' => $row->patient ?? '',
                    'surgeries' => $row->procedure ?? '',
                    'tasks' => $row->title ?? '',
                    'clinicNotes' => $row->text ?? $row->notes ?? $row->title ?? '',
                    'appointments' => $row->service ?? '',
                    default => $row->title ?? '',
                };
                if (trim($label) === '') throw new RuntimeException('Kayıt adı boş bırakılamaz.', 422);
                if (in_array($key,['appointments','exams','followups','weights','labs','treatments','prescriptions','surgeries','sales','purchases','collections','payments','expenses','stockMoves'],true)) {
                    $date = $row->date ?? '';
                    $parts = explode('-', $date);
                    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)
                        || !checkdate((int)$parts[1], (int)$parts[2], (int)$parts[0])) {
                        throw new RuntimeException('İşlem tarihi geçersiz.', 422);
                    }
                }
                if ($key === 'stays' && ($previous[$id] ?? null) != $row) {
                    $row = $rows[$position] = clone $row;
                    StayCarePlan::seal($row, $previous[$id] ?? null, $actor, $now);
                    StayIcu::seal($row, $previous[$id] ?? null, $actor, $now);
                    if (isset($row->careOrders) || isset($row->icuVitals) || isset($row->icuInfusions)) $sealedStays[] = $row;
                }
                if($key==='vaccineCatalog') {
                    foreach(['offsetDays','renewEvery'] as $field) if(isset($row->$field) && !preg_match('/\A[0-9]{1,4}\z/',$row->$field)) throw new RuntimeException('Yenileme aralığı sıfır veya pozitif tamsayı olmalıdır.',422);
                }
                if (in_array($key,['messages','templates'],true) && ($previous[$id]??null)!=$row &&
                    (!in_array($row->channel??'',['SMS','WhatsApp'],true) ||
                    !preg_match('/\A.{1,1600}\z/usD',trim($row->message??'')))) {
                    throw new RuntimeException('Geçerli mesaj kanalı ve metni gerekli.',422);
                }
                if ($key==='products' && empty($row->sku)) {
                    $row->sku=(($row->category??'')==='Hizmet'?'HZM-':'STK-').strtoupper($id);
                }
                if (in_array($key,ClinicProtocol::COLLECTIONS,true)) {
                    $prior=$previous[$id] ?? null;
                    if ($prior != $row) {
                        $row=$rows[$position]=clone $row;
                        ClinicProtocol::seal($key,$row,$prior);
                        if ($key==='clients') foreach (['sms','whatsapp','emailPermission','notifications'] as $channel) {
                            if (!$prior && !isset($row->$channel)) $row->$channel='Var';
                            elseif (!isset($row->$channel) && isset($prior->$channel)) $row->$channel=$prior->$channel;
                            if (isset($row->$channel) && !in_array($row->$channel,['Var','Yok',''],true)) {
                                throw new RuntimeException('Gönderim izni seçimi geçersiz.',422);
                            }
                        }
                    }
                }
                $indexed[$key][$id] = $row;
            }
            if (array_diff_key($previous, $indexed[$key])) {
                throw new RuntimeException('Bu sürüm kayıt silmeyi desteklemiyor.', 501);
            }
            $next->$key = $rows;
        }
        foreach (self::LINKS as $key => $links) {
            foreach ($next->$key as $row) {
                foreach ($links as $field => $target) {
                    $id = $row->$field ?? '';
                    if ($id !== '' && ($indexed[$target][$id]->branch ?? null) !== $row->branch) {
                        throw new RuntimeException('Bağlı kayıt aynı çalışma alanında bulunmalıdır.', 422);
                    }
                }
            }
        }
        foreach(['exams','followups','weights','labs','treatments','prescriptions','stays','surgeries'] as $type) {
            foreach($next->$type as $row) if(empty($row->patient)) throw new RuntimeException('Hasta seçilmelidir.',422);
        }
        $this->checkControlAppointments($original,$indexed);
        $previousVisits=array_filter(array_column($original->appointments,null,'id'),static fn($row)=>preg_match('/\Avisit-[a-f0-9]{32}\z/D',$row->id));
        foreach ($previousVisits as $visitId=>$visit) {
            if (($indexed['appointments'][$visitId]??null)!=$visit) {
                throw new RuntimeException('Evde hizmet randevusunu Evde Hizmet ekranından değiştirin.',422);
            }
        }
        $previousAppointments=array_column($original->appointments,null,'id');
        foreach ($indexed['appointments'] as $id=>$appointment) {
            if (preg_match('/\Avisit-[a-f0-9]{32}\z/D',$id)&&!isset($previousVisits[$id])) {
                throw new RuntimeException('Evde hizmet randevusunu Evde Hizmet ekranından oluşturun.',422);
            }
            if (!$previousVisits||!class_exists(WebBooking::class)||($previousAppointments[$id]??null)==$appointment||!WebBooking::booked($appointment)) continue;
            $candidate=clone $appointment;
            if (empty($candidate->endTime) && preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/D',$candidate->time??'')) {
                $candidate->endTime=min('23:59',date('H:i',strtotime($candidate->time)+1800));
                if ($candidate->endTime<$candidate->time) $candidate->endTime='23:59';
            }
            foreach ($previousVisits as $visit) if (WebBooking::overlap($candidate,$visit)) {
                throw new RuntimeException('Mevcut evde hizmet ziyaretiyle saat çakışması var.',409);
            }
        }
        foreach(['sales','appointments'] as $type) foreach($next->$type as $row) {
            if(!empty($row->patient) && !empty($row->client) && ($indexed['patients'][$row->patient]->owner ?? '')!==$row->client) throw new RuntimeException('Hasta seçilen müşteriye bağlı olmalıdır.',422);
        }
        foreach(['patients','clients','exams','followups','weights','labs','treatments','prescriptions','stays','surgeries','appointments','clinicNotes','tasks'] as $type) {
            $oldIndex=[];foreach($original->$type ?? [] as $row)$oldIndex[$row->id]=$row;
            foreach($next->$type as $row) {
                $prior=$oldIndex[$row->id] ?? null;
                if($prior==$row) continue;
                $row->createdBy=$prior->createdBy ?? $actor['name'];
                $row->createdAt=$prior->createdAt ?? gmdate('c',$now);
                $row->updatedBy=$actor['name'];
                $row->updatedAt=gmdate('c',$now);
            }
        }
        VisitorConversion::validate($original, $indexed['visitors'], $indexed['clients']);
        $today = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('Y-m-d');
        $clinicUpdates = VaccineInventory::reconcile($original, $next, $actor, $today);
        if ($sealedStays) $clinicUpdates['stays'] = $sealedStays;
        Finance::validate($original,$next,ClinicAccess::allowed($actor,'expenses',true) && ClinicAccess::action($actor,'cashCorrect',true));
        // Yüklenen durum doğrulama sırasında hiç değişmediyse yeniden yüklemeden yaz; aksi halde güvenli yol.
        $preloaded = self::fingerprint($original) === $fingerprint ? $current : null;
        if (isset($current['partial']) && $preloaded === null) {
            // Seçici yüklemede yeniden okuma da seçici olmalı; okunamazsa istemci yeniden dener.
            $preloaded = $this->workspaces->readForUpdateRequest($actor,$scope,$request->revision,$request->patch);
            if (!isset($preloaded['partial'])) throw new RuntimeException('Kayıt alanı güncellendi.', 409);
        }
        if (self::$beforeWrite) (self::$beforeWrite)($next, $clinicUpdates, isset($current['partial']));
        $saved = $this->workspaces->writeValidated($cookies, $scope, $now, $current['revision'], $next, $preloaded);
        if ($saved === null) throw new RuntimeException('Kayıt alanı güncellendi.', 409);
        return $saved;
    }

    /** Durumun içerik özeti; satırlar tek tek kodlandığı için ek bellek kullanımı düşüktür. */
    private static function fingerprint(object $state): string
    {
        $hash = hash_init('sha256');
        foreach (get_object_vars($state) as $key => $value) {
            hash_update($hash, "\0".$key."\0");
            if (is_array($value) && array_is_list($value)) {
                foreach ($value as $row) hash_update($hash, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n");
            } else {
                hash_update($hash, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
            }
        }
        return hash_final($hash);
    }

    private static function applyPatch(object $visible, mixed $patch): object
    {
        if (!$patch instanceof stdClass) throw new RuntimeException('Kayıt değişiklikleri geçersiz.',422);
        foreach ($patch as $collection => $change) {
            if (!$change instanceof stdClass) throw new RuntimeException('Kayıt değişiklikleri geçersiz.',422);
            if (property_exists($change,'replace') && count(get_object_vars($change)) === 1) {
                $visible->$collection = $change->replace;
                continue;
            }
            $rows = $visible->$collection ?? [];
            if (!in_array($collection,self::RECORDS,true) || !is_array($rows) || !array_is_list($rows) ||
                array_diff(array_keys(get_object_vars($change)), ['update','prepend','append'])) {
                throw new RuntimeException('Kayıt değişiklikleri geçersiz.',422);
            }
            $known = array_column($rows,null,'id');
            foreach (['update','prepend','append'] as $operation) {
                $updates = $change->$operation ?? [];
                if (!is_array($updates) || !array_is_list($updates)) throw new RuntimeException('Kayıt değişiklikleri geçersiz.',422);
                $inserts = [];
                foreach ($updates as $row) {
                    $id = $row->id ?? null;
                    if (!$row instanceof stdClass || !is_string($id) || !preg_match(self::ID,$id) ||
                        isset($known[$id]) !== ($operation === 'update')) {
                        throw new RuntimeException('Kayıt değişiklikleri geçersiz.',422);
                    }
                    if ($operation !== 'update') $inserts[$id] = $row;
                    $known[$id] = $row;
                }
                $known = match ($operation) {
                    'prepend' => $inserts + $known,
                    'append', 'update' => $known,
                };
            }
            $visible->$collection = array_values($known);
        }
        return $visible;
    }

    private function checkControlAppointments(object $original,array $indexed): void
    {
        $controls=[];
        foreach ($indexed['appointments'] as $appointment) {
            $examId=$appointment->controlExamId ?? '';
            if ($examId==='') continue;
            $exam=$indexed['exams'][$examId] ?? null;
            if (!$exam || $exam->branch!==$appointment->branch || $exam->patient!==($appointment->patient ?? '')) {
                throw new RuntimeException('Kontrol randevusu bağlı muayeneyle eşleşmelidir.',422);
            }
            if (in_array($appointment->status ?? '', ['İptal','Tamamlandı','Gelmedi'],true)) continue;
            if (isset($controls[$examId]) || ($exam->status ?? '')==='İptal' ||
                ($exam->next ?? '')!==$appointment->date || ($exam->nextTime ?? '')!==($appointment->time ?? '') ||
                ($exam->clinician ?? '')!==($appointment->clinician ?? '')) {
                throw new RuntimeException('Kontrol randevusunun tarihini, saatini ve hekimini bağlı muayeneden değiştirin.',422);
            }
            $controls[$examId]=$appointment;
        }
        $previous=array_column($original->exams,null,'id');
        foreach ($indexed['exams'] as $exam) {
            $date=$exam->next ?? '';
            $time=$exam->nextTime ?? '';
            $prior=$previous[$exam->id] ?? null;
            if (($exam->status ?? '')==='İptal') continue;
            $changed=$date!==($prior->next ?? '') || $time!==($prior->nextTime ?? '') ||
                ($time!=='' && ($prior->status ?? '')==='İptal') || ($time!=='' && ($exam->clinician ?? '')!==($prior->clinician ?? ''));
            if (!$changed) continue;
            if ($time==='' && $date==='') continue;
            if (!isset($controls[$exam->id]) || $date<$exam->date ||
                !preg_match('/\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z/',$time)) {
                throw new RuntimeException('Geçerli kontrol tarihi ve saatini birlikte girin.',422);
            }
        }
    }

}
