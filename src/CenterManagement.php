<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

require_once __DIR__ . '/ClinicProtocol.php';

use PDO;
use RuntimeException;

final class CenterManagement
{
    public const FIELDS = [
        'credit_package'=>['name'=>120,'channel'=>16,'units'=>7,'price'=>16],
        'shop_bank'=>['enabled'=>3,'beneficiary'=>160,'iban'=>34],
        'payments'=>['partner'=>32,'reference'=>120,'amount'=>16,'note'=>500,'plan'=>32,'starts_on'=>10,'ends_on'=>10],
        'market'=>['path'=>150,'title'=>160,'description'=>350,'section_title'=>160,'section_text'=>1500,'section_url'=>500],
        'announcements'=>['partner'=>32,'title'=>160,'text'=>1600],
        'ads'=>['partner'=>32,'title'=>160,'text'=>500,'url'=>500],
        'releases'=>['title'=>160,'text'=>1500],
        'okc'=>['partner'=>32,'branch'=>80,'brand'=>20,'model'=>80,'serial'=>80,'note'=>500],
    ];
    public function __construct(private readonly PDO $db, private readonly Center $center) {}

    public function rows(string $kind): array
    {
        if (in_array($kind,['announcements','ads'],true)) $this->purgePublications();

        $q=$this->db->prepare('SELECT id,payload,updated_at FROM center_management WHERE kind=? ORDER BY updated_at DESC,id LIMIT 300');
        $q->execute([$kind]);
        return array_map(static fn($row)=>['id'=>$row['id'],'updated'=>$row['updated_at']]+json_decode($row['payload'],true,32,JSON_THROW_ON_ERROR),$q->fetchAll());
    }

    public function mailSettings(): array
    {
        $query=$this->db->query("SELECT payload FROM center_management WHERE id='00000000000000000000000000000001' AND kind='mail_settings'");
        $value=$query->fetchColumn();
        return ($value ? json_decode($value,true,32,JSON_THROW_ON_ERROR) : []) +
            ['company'=>'','email'=>'','phone'=>'','admin'=>'','sender'=>''];
    }

    public function saveMailSettings(object $input): array
    {
        $settings=[];
        foreach (['company'=>160,'email'=>254,'phone'=>40,'admin'=>254,'sender'=>254] as $field=>$limit) {
            $value=$input->$field ?? '';
            if (!is_string($value) || !preg_match('/\A[^\p{Cc}]{0,'.$limit.'}\z/u',trim($value))) {
                throw new RuntimeException('E-posta ayarlarında geçersiz alan var.',422);
            }
            $settings[$field]=trim($value);
            if (in_array($field,['email','admin','sender'],true) && $settings[$field]!=='' &&
                !filter_var($settings[$field],FILTER_VALIDATE_EMAIL)) throw new RuntimeException('E-posta adreslerini kontrol edin.',422);
        }
        $this->store('00000000000000000000000000000001','mail_settings',$settings);
        return $settings;
    }

    public function testMail(): void
    {
        $settings=$this->mailSettings();
        if (!$settings['sender'] || !$settings['admin']) throw new RuntimeException('Önce gönderen ve yönetici adreslerini kaydedin.',422);
        if (!function_exists('mail') || !@mail($settings['admin'],'VetZimo e-posta testi',
            "VetZimo yönetim paneli e-posta testi.\r\n",
            ['From'=>$settings['sender'],'Content-Type'=>'text/plain; charset=UTF-8'])) {
            throw new RuntimeException('Hosting posta sistemi isteği kabul etmedi. Gönderen adresini ve PHP mail ayarını kontrol edin.',502);
        }
    }

    public function market(string $path): ?array
    {
        $query=$this->db->prepare("SELECT payload FROM center_management WHERE id=? AND kind='market'");
        $query->execute([substr(hash('sha256',$path),0,32)]);
        $value=$query->fetchColumn();
        return $value ? json_decode($value,true,32,JSON_THROW_ON_ERROR) : null;
    }

    public function published(string $partner): array
    {
        $this->purgePublications();

        $query=$this->db->prepare("SELECT kind,payload FROM center_management
            WHERE kind IN ('announcements','ads') AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.partner')) IN ('',?)
            ORDER BY JSON_UNQUOTE(JSON_EXTRACT(payload,'$.partner')) <> '',updated_at DESC,id");
        $query->execute([$partner]);
        $slots=[];
        while ($row=$query->fetch()) {
            $data=json_decode($row['payload'],true,32,JSON_THROW_ON_ERROR);
            if (($data['active'] ?? true)!==true || ($data['startsAt'] ?? 0)>time()) continue;
            $slot=$data['slot'] ?? 1;
            $slots[$slot] ??= ['kind'=>$row['kind'],'title'=>$data['title'],'text'=>$data['text'],
                'url'=>$data['url'] ?? '', 'image'=>$data['image'] ?? '', 'slot'=>$slot];
            if (count($slots)===4) break;
        }
        ksort($slots);
        return array_values($slots);
    }

    private function purgePublications(): void
    {
        $query=$this->db->prepare("DELETE FROM center_management WHERE kind IN ('announcements','ads')
            AND CAST(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.endsAt')) AS UNSIGNED) BETWEEN 1 AND ?");
        $query->execute([time()]);
    }

    private function publicationTime(mixed $value): int
    {
        if ($value==='') return 0;
        $date=is_string($value)?\DateTimeImmutable::createFromFormat('!Y-m-d\TH:i',$value,new \DateTimeZone('Europe/Istanbul')):false;
        if (!$date || $date->format('Y-m-d\TH:i')!==$value) throw new RuntimeException('Yayın tarihini ve saatini kontrol edin.',422);
        return $date->getTimestamp();
    }

    public function write(string $kind, object $input, array $actor): void
    {
        $id=$input->id ?? '';
        $action=$input->action ?? 'save';
        if (!is_string($id) || ($id!=='' && !preg_match('/\A[a-f0-9]{32}\z/',$id))) throw new RuntimeException('Kayıt kimliği geçersiz.',422);
        $this->db->beginTransaction();
        try {
            $existing=null;
            if ($id!=='') {
                $query=$this->db->prepare('SELECT payload FROM center_management WHERE id=? AND kind=? FOR UPDATE');
                $query->execute([$id,$kind]);
                $record=$query->fetchColumn();
                if (!$record) throw new RuntimeException('Kayıt bulunamadı.',404);
                $existing=json_decode($record,true,32,JSON_THROW_ON_ERROR);
            }
            if ($kind==='payments' && $existing) {
                if ($existing['status']!=='pending' || !in_array($action,['approved','rejected'],true)) throw new RuntimeException('Bu ödeme kaydı zaten sonuçlandı veya işlem geçersiz.',409);
                if ($action==='approved') {
                    $verified=$input->verifiedAmount ?? null;
                    if (($input->verified ?? false)!==true || !is_string($verified)
                        || self::paymentCents($verified)!==self::paymentCents($existing['amount'])) {
                        throw new RuntimeException('Dekontu kontrol edin ve kayıtla aynı tutarı girin.',422);
                    }
                    if (!empty($existing['plan'])) {
                        (new Commerce($this->db))->assign((object)[
                            'partnerId'=>$existing['partner'],'plan'=>$existing['plan'],'kind'=>'assigned',
                            'starts_on'=>$existing['starts_on'],'ends_on'=>$existing['ends_on']
                        ]);
                    }
                }
                $existing['status']=$action;
                $existing['reviewedBy']=$actor['identifier'];
                $this->store($id,$kind,$existing);
            } elseif ($action==='delete' && $existing) {
                $this->db->prepare('DELETE FROM center_management WHERE id=? AND kind=?')->execute([$id,$kind]);
            } elseif ($action==='save') {
                $data=[];
                foreach (self::FIELDS[$kind] as $field=>$limit) {
                    $value=$input->$field ?? '';
                    if (!is_string($value) || !preg_match('/\A.{0,'.$limit.'}\z/us',trim($value))) throw new RuntimeException('Geçersiz alan: '.$field,422);
                    $data[$field]=trim($value);
                    if ($data[$field]==='' && !in_array($field,['partner','note','url','plan','starts_on','ends_on','section_title','section_text','section_url'],true) && !in_array($kind,['announcements','ads'],true)) throw new RuntimeException('Zorunlu alanları doldurun.',422);
                }
                if (in_array($kind,['announcements','ads'],true)) {
                    $slot=$input->slot ?? null;
                    if (!in_array($slot,$kind==='announcements' ? [0,1,2,3] : [1,2,3],true)) throw new RuntimeException('Yayın konumu geçersiz.',422);
                    $image=$input->image ?? ($existing['image'] ?? '');
                    if (!is_string($image) || strlen($image)>165000) throw new RuntimeException('Görsel boyutu sınırı aşıldı.',422);
                    if ($image!=='') {
                        if (!preg_match('~\Adata:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)\z~',$image,$match)) throw new RuntimeException('Görsel biçimi geçersiz.',422);
                        $bytes=base64_decode($match[2],true);
                        $info=$bytes===false ? false : @getimagesizefromstring($bytes);
                        if (!$info || $info['mime']!=='image/'.$match[1] || max($info[0],$info[1])>1600) throw new RuntimeException('Geçerli bir JPEG, PNG veya WebP görseli seçin.',422);
                    }
                    if ($slot===0) $image='';
                    if ($data['title']==='' && $data['text']==='' && $image==='') throw new RuntimeException('Başlık, metin veya görsel ekleyin.',422);
                    $data['image']=$image;
                    $data['slot']=$slot;
                    $data['startLocal']=$input->startLocal ?? '';
                    $data['endLocal']=$input->endLocal ?? '';
                    $data['startsAt']=$this->publicationTime($data['startLocal']);
                    $data['endsAt']=$this->publicationTime($data['endLocal']);
                    if ($data['endsAt'] && $data['endsAt']<=max(time(),$data['startsAt'])) {
                        throw new RuntimeException('Yayın bitişi başlangıçtan ve şu andan sonra olmalı.',422);
                    }
                    $data['active']=($input->active ?? false)===true;
                }
                if ($kind==='credit_package' && (!in_array($data['channel'],['sms','whatsapp'],true) ||
                    !preg_match('/\A[1-9][0-9]{0,6}\z/',$data['units']) || (int)$data['units']>1000000 ||
                    Finance::money(str_replace(',','.',$data['price']))<=0)) throw new RuntimeException('Kredi paketi bilgileri geçersiz.',422);
                if ($kind==='shop_bank') {
                    $data['iban']=strtoupper(str_replace(' ','',$data['iban']));
                    if (!in_array($data['enabled'],['yes','no'],true) || !preg_match('/\ATR[0-9]{24}\z/',$data['iban'])) {
                        throw new RuntimeException('Türkiye IBAN ve satış durumunu kontrol edin.',422);
                    }
                    $id=substr(hash('sha256','shop-bank-settings'),0,32);
                }
                if ($kind==='payments') {
                    self::paymentCents($data['amount']);
                    if ($data['plan']!=='' && (!isset((new Commerce($this->db))->catalog()[$data['plan']])
                        || !self::day($data['starts_on']) || !self::day($data['ends_on']) || $data['starts_on']>$data['ends_on'])) {
                        throw new RuntimeException('Abonelik paketi ve tarihlerini kontrol edin.',422);
                    }
                }
                if (in_array($kind,['payments','okc'],true) && $data['partner']==='') throw new RuntimeException('Bayi seçin.',422);
                $partner=!empty($data['partner'])?$this->center->details($data['partner']):null;
                if ($kind==='okc' && (!in_array($data['brand'],['Beko','Ingenico','Hugin','Paygo','inPOS'],true)
                    || !in_array($data['branch'],array_column($partner['branches'],'id'),true))) throw new RuntimeException('Marka ve bayi şubesini kontrol edin.',422);
                if ($kind==='ads' && $data['url']!=='' && (!filter_var($data['url'],FILTER_VALIDATE_URL) || parse_url($data['url'],PHP_URL_SCHEME)!=='https')) throw new RuntimeException('HTTPS bağlantısı girin.',422);
                if ($kind==='market' && $data['section_url']!=='' &&
                    (!filter_var($data['section_url'],FILTER_VALIDATE_URL) || parse_url($data['section_url'],PHP_URL_SCHEME)!=='https')) {
                    throw new RuntimeException('Bölüm bağlantısı HTTPS olmalıdır.',422);
                }
                if ($kind==='market' && !preg_match('~\A/platform(?:/[a-z0-9-]+)*\z~',$data['path'])) throw new RuntimeException('Satış sayfası yolu geçersiz.',422);
                if ($kind==='payments') {
                    $data['status']='pending';
                    $id=substr(hash('sha256','payment:'.strtolower($data['reference'])),0,32);
                    try {
                        $this->db->prepare('INSERT INTO center_management(id,kind,payload) VALUES (?,?,?)')
                            ->execute([$id,$kind,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
                    } catch (\PDOException $error) {
                        if ((int)($error->errorInfo[1] ?? 0)===1062) throw new RuntimeException('Bu dekont referansı zaten kayıtlı.',409);
                        throw $error;
                    }
                }
                if ($kind==='market') {
                    $edits=$input->edits ?? (object)($existing['edits'] ?? []);
                    if (!is_object($edits) || count((array)$edits)>800) throw new RuntimeException('Sayfa metinleri geçersiz.',422);
                    foreach ($edits as $key=>$value) {
                        if (!preg_match('/\A[a-f0-9]{24}-[1-9][0-9]*\z/',$key) || !is_string($value) || strlen($value)>3000) {
                            throw new RuntimeException('Sayfa metinleri geçersiz.',422);
                        }
                    }
                    $data['edits']=(array)$edits;
                }
                if ($kind==='market') $id=substr(hash('sha256',$data['path']),0,32);
                $id=$id ?: bin2hex(random_bytes(16));
                if ($kind!=='payments') $this->store($id,$kind,$data);
            } else throw new RuntimeException('İşlem geçersiz.',422);
            $this->center->audit($actor['account_id'],'management.'.$kind.'.'.$action,$id);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    private static function day(string $value): bool
    {
        return preg_match('/\A(20[0-9]{2})-([0-9]{2})-([0-9]{2})\z/',$value,$parts)===1
            && checkdate((int)$parts[2],(int)$parts[3],(int)$parts[1]);
    }

    private static function paymentCents(string $amount): int
    {
        if (!preg_match('/\A([0-9]{1,10})(?:[.,]([0-9]{1,2}))?\z/',trim($amount),$parts)) throw new RuntimeException('Tutar geçersiz.',422);
        $cents=(int)$parts[1]*100+(int)str_pad($parts[2] ?? '',2,'0');
        if ($cents<=0) throw new RuntimeException('Tutar sıfırdan büyük olmalıdır.',422);
        return $cents;
    }

    private function store(string $id,string $kind,array $data): void
    {
        $this->db->prepare('INSERT INTO center_management(id,kind,payload) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)')
            ->execute([$id,$kind,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
    }

    public function backup(string $partner,string $branch=''): array
    {
        $this->center->details($partner);
        $backup=(new WorkspaceRepository($this->db))->load('partner:'.$partner);
        if ($branch==='') return ['format'=>'vetnet-workspace-v1','partner'=>$partner]+$backup;
        $state=$backup['state'];
        $selected=null;
        foreach ($state->branches ?? [] as $row) if ($row->id===$branch) { $selected=$row; break; }
        if (!$selected) throw new RuntimeException('Şube bulunamadı.',404);
        $dataBranch=($selected->sharedWith ?? '') ?: $branch;
        $result=['branches'=>array_values(array_filter($state->branches,static fn($row)=>in_array($row->id,[$branch,$dataBranch],true)))];
        foreach ($state as $key=>$rows) {
            if ($key==='branches' || !is_array($rows)) continue;
            $result[$key]=array_values(array_filter($rows,static fn($row)=>is_object($row) && ($row->branch ?? '')===$dataBranch));
        }
        return ['format'=>'vetnet-workspace-v1','partner'=>$partner,'branch'=>$branch,'dataBranch'=>$dataBranch,
            'revision'=>$backup['revision'],'state'=>$result];
    }

    public function import(string $partner,object $body,array $actor): array
    {
        $source=$body->backup ?? null;
        if (!is_object($source) || ($source->format ?? '')!=='vetnet-workspace-v1' || ($source->partner ?? '')!==$partner
            || !is_object($source->state ?? null)) throw new RuntimeException('Seçilen bayiye ait VetZimo JSON yedeği gerekli.',422);
        $this->center->details($partner);
        $repository=new WorkspaceRepository($this->db);
        $current=$repository->load('partner:'.$partner);
        $state=$current['state'];
        if (!$state) throw new RuntimeException('Bayi çalışma alanı bulunamadı.',404);
        $added=[];
        foreach (['clients','patients'] as $kind) {
            $rows=$source->state->$kind ?? null;
            if (!is_array($rows)) throw new RuntimeException('Yedek kayıt listesi geçersiz.',422);
            $known=array_column($state->$kind,'branch','id');
            $added[$kind]=0;
            foreach ($rows as $row) {
                if (!is_object($row) || !is_string($row->id ?? null) || !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/',$row->id)
                    || !is_string($row->name ?? null) || trim($row->name)==='' || !is_string($row->branch ?? null)) throw new RuntimeException('Yedekte kayıt kimliği, adı veya şubesi geçersiz.',422);
                if (isset($known[$row->id])) continue;
                $branch=ClinicAccess::branch($state,$row->branch);
                if (!$branch || !empty($branch->sharedWith)) throw new RuntimeException('Yedekteki kayıt için etkin veri şubesi bulunamadı.',422);
                if ($kind==='patients' && (!is_string($row->owner ?? null) || ($owners[$row->owner] ?? null)!==$row->branch)) throw new RuntimeException('Hastanın sahibi aynı veri şubesinde bulunamadı.',422);
                foreach ($row as $value) if (!is_string($value)) throw new RuntimeException('Yedekte geçersiz kayıt alanı var.',422);
                ClinicProtocol::seal($kind,$row,null);
                $state->{$kind}[]=$row;
                $known[$row->id]=$row->branch;
                $added[$kind]++;
            }
            if ($kind==='clients') $owners=$known;
        }
        if (!array_sum($added) || ($body->preview ?? false)===true) return $added;
        $this->db->beginTransaction();
        try {
            if ($repository->save('partner:'.$partner,$current['revision'],$state)===null) throw new RuntimeException('Veri değişti. İçe aktarmayı yeniden deneyin.',409);
            $this->center->audit($actor['account_id'],'management.import',$partner);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        return $added;
    }
}
