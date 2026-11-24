<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

require_once __DIR__.'/NativeWindowsPush.php';

final class NativeApp
{
    public const CATEGORIES = ['appointments','vaccines','stock','homecare','shared','homeVisits'];
    public const RECORD_FIELDS = [
        'patients'=>['id','name','species','breed','birth','sex'],
        'exams'=>['id','title','date','patient'],
        'appointments'=>['id','patient','date','time','endTime','service','status'],
        'sales'=>['id','date','detail','amount','paid','balance','method','invoice'],
        'collections'=>['id','date','sale','amount','method'],
        'payments'=>['id','date','purchase','amount','method'],
        'expenses'=>['id','date','type','detail','amount','method'],
        'products'=>['id','name','sku','barcode','category','brand','stock','min','unit','expiry','price','track'],
        'stockLots'=>['id','product','date','expiry','serial','batch','received','remaining'],
        'stockMoves'=>['id','product','date','source','delta','reason','balance'],
        'labs'=>['id','date','patient','title','kind','status','result'],
    ];

    public function __construct(private readonly PDO $db, private readonly array $config) {}

    private function query(string $sql, array $args = []): \PDOStatement
    {
        $query = $this->db->prepare($sql);
        $query->execute($args);
        return $query;
    }

    private function selected(array $actor): ?string
    {
        if ($actor['role']==='dealer') return null;
        $branches = (new WorkspaceRepository($this->db))->branches('partner:'.$actor['partner_id']);
        $branch = ClinicAccess::branch((object)['branches'=>$branches],$actor['branch_id']);
        if (!$branch) throw new RuntimeException('Bu şube artık etkin değil.',403);
        return ($branch->sharedWith ?? '') ?: $branch->id;
    }

    public function records(array $actor,string $collection,?string $id,mixed $offset): array
    {
        if (!isset(self::RECORD_FIELDS[$collection])) throw new RuntimeException('Kayıt türü bulunamadı.',404);
        if ($id!==null && !preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D',$id)) throw new RuntimeException('Kayıt bulunamadı.',404);
        if (!is_string($offset) || !preg_match('/\A[0-9]{1,5}\z/D',$offset) || (int)$offset>30000) throw new RuntimeException('Sayfa geçersiz.',422);
        $start = (int)$offset;
        $fields = array_flip(self::RECORD_FIELDS[$collection]);
        $rows=[];
        if ($actor['role']==='customer') {
            if (!in_array($collection,['patients','appointments','labs'],true)) throw new RuntimeException('Bu bölüm için yetkiniz yok.',403);
            // The central portal already validates membership, ownership and share permissions.
            $portal = (new IdentityApi($this->db))->portal($actor);
            if ($collection==='appointments' && !$portal['sections']['appointments']) throw new RuntimeException('Bu bölüm için yetkiniz yok.',403);
            if ($collection==='labs') {
                if (!$portal['sections']['lab'] && !$portal['sections']['xray']) throw new RuntimeException('Bu bölüm için yetkiniz yok.',403);
                $source = [];
                foreach ($portal['shared'] as $share) {
                    if (!in_array($share['category'],['lab','xray'],true)) continue;
                    $source[$share['record_id']]=['id'=>$share['record_id'],'title'=>$share['title']??'','date'=>$share['date']??'',
                        'kind'=>$share['category'],'result'=>$share['summary']??''];
                }
                $source=array_values($source);
            } else {
                $source = $portal[$collection==='patients'?'pets':'appointments'];
            }
            if ($id!==null) $source = array_values(array_filter($source,static fn($r)=>$r['id']===$id));
            foreach (array_slice($source,$id===null?$start:0,31) as $row) $rows[]=array_intersect_key($row,$fields);
        } else {
            $actor = (new Commerce($this->db))->packageActor($actor);
            if (!ClinicAccess::allowed($actor,$collection)) throw new RuntimeException('Bu bölüm için yetkiniz yok.',403);
            $branch = $this->selected($actor);
            $workspace='partner:'.$actor['partner_id'];
            $set=$this->query('SELECT id FROM clinic_record_set WHERE workspace_id=?',[$workspace])->fetchColumn();
            if ($set===false) {
                // Clinics still in staged migration use their current authoritative storage.
                $state=(new WorkspaceRepository($this->db))->load($workspace)['state'];
                $eligible=0;
                foreach ($state->$collection??[] as $entry) {
                    if (($branch!==null && ($entry->branch??'')!==$branch) || ($id!==null && ($entry->id??'')!==$id)) continue;
                    if ($id===null && $eligible++<$start) continue;
                    $rows[]=array_intersect_key((array)$entry,$fields);
                    if ($id!==null || count($rows)===31) break;
                }
            } else {
                $params = [$set,$collection];
                $where = '';
                if ($branch!==null) { $where.=' AND r.branch_id=?'; $params[]=$branch; }
                if ($id!==null) { $where.=' AND r.row_key=?'; $params[]='@'.$id; }
                $query = $this->query("SELECT r.record_data FROM clinic_record r
                    WHERE r.set_id=? AND r.collection=?$where ORDER BY r.ordinal,r.row_key LIMIT 31 OFFSET ".($id===null?$start:0),$params);
                foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $raw) {
                    $rows[]=array_intersect_key(json_decode($raw,true,32,JSON_THROW_ON_ERROR),$fields);
                }
            }
        }
        if ($id!==null && !$rows) throw new RuntimeException('Kayıt bulunamadı.',404);
        $reply=['items'=>array_slice($rows,0,30),'next'=>count($rows)>30?$start+30:null];
        if ($collection==='exams') $reply['canAttach']=ClinicAccess::allowed($actor,'exams',true);
        if ($collection==='labs' && $id!==null && $actor['role']!=='customer' && ClinicAccess::allowed($actor,'labs',true)) {
            $reply['editVersion']=self::labVersion((object)$rows[0]);
        }
        if ($collection==='sales' && $id!==null) $reply['canCollect']=ClinicAccess::allowed($actor,'collections',true);
        if (in_array($collection,['products','stockLots'],true) && $id!==null) {
            $reply['canMoveStock']=ClinicAccess::allowed($actor,'products',true) && ($collection==='stockLots' ||
                (($rows[0]['track']??'')!=='Hayır' && ($rows[0]['category']??'')!=='Hizmet'));
        }
        return $reply;
    }

    public function collectSale(array $actor,string $id,array $cookies,int $now,object $body): array
    {
        $workspace=new DealerWorkspace($this->db);
        $scoped=$workspace->actor($cookies,$now);
        if ($actor['membership_id']!==$scoped['membership_id']) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $actor=$scoped;
        if (!ClinicAccess::allowed($actor,'sales') || !ClinicAccess::allowed($actor,'collections',true)) {
            throw new RuntimeException('Satış okuma ve tahsilat yazma yetkisi gerekli.',403);
        }
        $requestId=$body->requestId??null;
        $amount=$body->amount??null;
        $method=$body->method??null;
        if (!is_string($requestId) || !preg_match('/\A[a-f0-9]{32}\z/D',$requestId) ||
            !is_string($amount) || !in_array($method,['Kart','Nakit','Havale','Diğer'],true) || Finance::money($amount)<1) {
            throw new RuntimeException('Tahsilat biçimi geçersiz.',422);
        }
        $snapshot=$workspace->visibleFor($actor);
        $sale=array_column($snapshot['state']->sales??[],null,'id')[$id]??null;
        if (!$sale) throw new RuntimeException('Satış bulunamadı.',404);
        $receiptId='app-'.$requestId;
        $existing=array_column($snapshot['state']->collections??[],null,'id')[$receiptId]??null;
        if ($existing) {
            if ($existing->sale!==$id || Finance::money($existing->amount)!==Finance::money($amount) || $existing->method!==$method) {
                throw new RuntimeException('Bu tahsilat isteği başka bir işlemde kullanıldı.',422);
            }
            return ['id'=>$receiptId];
        }
        $date=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $row=(object)['id'=>$receiptId,'branch'=>$sale->branch,'sale'=>$id,'client'=>$sale->client??'',
            'date'=>$date,'amount'=>$amount,'method'=>$method];
        $changes=(object)['collections'=>(object)['prepend'=>[$row]]];
        try {
            (new ClinicApi($workspace))->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$snapshot['revision'],'patch'=>$changes]);
        } catch (RuntimeException $error) {
            if ($error->getCode()===409) throw new RuntimeException('Kayıt güncellendi. Aynı tahsilat isteğini yeniden deneyin.',412);
            throw $error;
        }
        return ['id'=>$receiptId];
    }

    public function moveStock(array $actor,string $collection,string $id,array $cookies,int $now,object $body): array
    {
        $workspace=new DealerWorkspace($this->db);
        $scoped=$workspace->actor($cookies,$now);
        if ($actor['membership_id']!==$scoped['membership_id']) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $actor=$scoped;
        if (!ClinicAccess::allowed($actor,'products',true)) throw new RuntimeException('Stok yazma yetkisi gerekli.',403);
        $incoming=$collection==='products';
        $requestId=$body->requestId??null;
        $quantity=$body->quantity??null;
        $reason=$body->reason??null;
        if (!is_string($requestId) || !preg_match('/\A[a-f0-9]{32}\z/D',$requestId) || !is_string($quantity) ||
            !is_string($reason) || !preg_match('/\A.{1,160}\z/usD',trim($reason))) {
            throw new RuntimeException('Miktar ve stok hareketi açıklamasını kontrol edin.',422);
        }
        $delta=Finance::qty($quantity)*($incoming?1:-1);
        $snapshot=$workspace->visibleFor($actor);
        $state=$snapshot['state'];
        $lot=$incoming?null:(array_column($state->stockLots??[],null,'id')[$id]??null);
        $product=array_column($state->products??[],null,'id')[$incoming?$id:($lot->product??'')]??null;
        if (!$product || (!$incoming && $product->branch!==$lot->branch)) throw new RuntimeException('Stok kaydı bulunamadı.',404);
        if (($product->track??'')==='Hayır' || ($product->category??'')==='Hizmet') throw new RuntimeException('Stok takibi kapalı.',422);
        $movementId='app-move-'.$requestId;
        $existing=array_column($state->stockMoves??[],null,'id')[$movementId]??null;
        if ($existing) {
            if ($existing->product!==$product->id || $existing->delta!==(string)$delta ||
                ($existing->reason??'')!==trim($reason) || (!$incoming && $existing->lot!==$id)) {
                throw new RuntimeException('Bu istek başka bir stok hareketinde kullanıldı.',422);
            }
            return ['id'=>$movementId];
        }
        $date=(new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
        $new=clone $product;
        $balance=Finance::qty($product->stock,true);
        $lots=(object)['append'=>[],'update'=>[]];
        if ($incoming) {
            $existingLots=array_filter($state->stockLots??[],static fn(object $entry)=>$entry->product===$product->id && $entry->branch===$product->branch);
            if (!$existingLots && $balance>0) $lots->append[]=(object)['id'=>'initial-'.$product->id,'product'=>$product->id,
                'branch'=>$product->branch,'received'=>(string)$balance,'remaining'=>(string)$balance,
                'expiry'=>$product->expiry??'','serial'=>$product->batch??'','date'=>'','reason'=>'Önceki stok bakiyesi'];
            $lot=(object)['id'=>'app-lot-'.$requestId,'product'=>$product->id,'branch'=>$product->branch,
                'date'=>$date,'received'=>(string)$delta,'remaining'=>(string)$delta,'reason'=>trim($reason),'expiry'=>'','serial'=>''];
            $lots->append[]=$lot;
        } else {
            $lot=clone $lot;
            $remaining=Finance::qty($lot->remaining,true)+$delta;
            if ($remaining<0) throw new RuntimeException('Parti miktarı yetersiz.',422);
            $lot->remaining=(string)$remaining;
            $lots->update[]=$lot;
        }
        $new->stock=(string)($balance+$delta);
        Finance::qty($new->stock,true);
        $movement=(object)['id'=>$movementId,'branch'=>$product->branch,'product'=>$product->id,'lot'=>$lot->id,'date'=>$date,
            'delta'=>(string)$delta,'balance'=>$lot->remaining,'source'=>$incoming?'Manuel giriş':'Manuel çıkış','reason'=>trim($reason)];
        $changes=(object)['products'=>(object)['update'=>[$new]],'stockLots'=>$lots,'stockMoves'=>(object)['prepend'=>[$movement]]];
        try {
            (new ClinicApi($workspace))->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$snapshot['revision'],'patch'=>$changes]);
        } catch (RuntimeException $error) {
            if ($error->getCode()===409) throw new RuntimeException('Stok güncellendi. Aynı hareketten yeniden deneyin.',412);
            throw $error;
        }
        return ['id'=>$movementId];
    }

    private static function labVersion(object $row): string
    {
        return hash('sha256',json_encode([$row->result??'',$row->status??''],JSON_THROW_ON_ERROR));
    }

    public function updateLab(array $actor,string $id,array $cookies,int $now,object $body): array
    {
        $workspace=new DealerWorkspace($this->db);
        $scoped=$workspace->actor($cookies,$now);
        if ($actor['membership_id']!==$scoped['membership_id']) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $actor=$scoped;
        if (!ClinicAccess::allowed($actor,'labs',true)) throw new RuntimeException('Tetkik yazma yetkisi gerekli.',403);
        $result=$body->result??null;
        $status=$body->status??null;
        $version=$body->editVersion??null;
        if (!is_string($result) || !preg_match('/\A.{0,3200}\z/usD',$result) ||
            !in_array($status,['Planlandı','Bekliyor','Tamamlandı','İptal'],true) || !is_string($version) ||
            !preg_match('/\A[a-f0-9]{64}\z/D',$version)) {
            throw new RuntimeException('Tetkik sonucu veya durumu geçersiz.',422);
        }
        $snapshot=$workspace->visibleFor($actor);
        $row=array_column($snapshot['state']->labs??[],null,'id')[$id]??null;
        if (!$row) throw new RuntimeException('Tetkik bulunamadı.',404);
        if (!hash_equals(self::labVersion($row),$version)) throw new RuntimeException('Tetkik güncellendi, kaydı yeniden açın.',412);
        $new=clone $row;
        $new->result=trim($result);
        $new->status=$status;
        $changes=(object)['labs'=>(object)['update'=>[$new]]];
        try {
            (new ClinicApi($workspace))->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$snapshot['revision'],'patch'=>$changes]);
        } catch (RuntimeException $error) {
            if ($error->getCode()===409) throw new RuntimeException('Kayıt güncellendi, tetkiki yeniden açın.',412);
            throw $error;
        }
        return $this->records($actor,'labs',$id,'0');
    }

    public function homeVisits(array $actor,?string $id): array
    {
        $visit=new HomeVisit($this->db,$this->config);
        $owner=$actor['role']==='customer';
        if (!$owner) {
            $actor=(new Commerce($this->db))->packageActor($actor);
            if (!$visit->staffAllowed($actor,$visit->settings($actor['partner_id']))) throw new RuntimeException('Evde hizmet yetkiniz yok.',403);
        }
        if ($id!==null) {
            $source=[$visit->find($actor,$id,$owner)];
        } else {
            $source=array_slice($visit->scoped($actor,$owner),0,50);
        }
        $items=[];
        foreach ($source as $row) {
            $snapshot=$visit->decode($row['snapshot']);
            $item=['id'=>$row['id'],'name'=>$snapshot['animal']??'','status'=>HomeVisit::STATUS[$row['status']]??$row['status'],
                'date'=>substr($row['starts']??($snapshot['date']??''),0,10),
                'time'=>isset($row['starts'])?substr($row['starts'],11,5):($snapshot['from']??''),
                'service'=>implode(' · ',array_column($snapshot['services']??[],'label'))];
            if ($id!==null) {
                $place=$snapshot['location']??[];
                $item['address']=array_intersect_key($place,array_flip(['address','street','building','district','province','latitude','longitude']));
            }
            $items[]=$item;
        }
        return ['items'=>$items,'next'=>null];
    }

    public function inbox(array $actor,int $now, ?object $change = null, ?string $single = null): array
    {
        if ($actor['role']!=='customer') $actor=(new Commerce($this->db))->packageActor($actor);
        $branch=$this->selected($actor);
        $args=[$actor['membership_id'],$actor['partner_id']];
        $scope = 'n.partner_id=?';
        if ($branch!==null) { $scope.=' AND n.branch_id=?'; $args[]=$branch; }
        if ($actor['role']==='customer') {
            $scope.=" AND n.customer_id=? AND (n.membership_id='' OR n.membership_id=?)";
            $args[]=$actor['customer_id']; $args[]=$actor['membership_id'];
        } else $scope.=" AND n.kind IN ('clinic','native_visit_clinic')";
        $action=$change->action??'';
        if ($change && !in_array($action,['read','unread','readAll'],true)) throw new RuntimeException('Bildirim işlemi geçersiz.',422);
        $target=$single??($change && $action!=='readAll'?($change->id??''):null);
        if ($target!==null) {
            if (!is_string($target) || !preg_match('/\A[1-9][0-9]{0,18}\z/D',$target)) throw new RuntimeException('Bildirim bulunamadı.',404);
            $scope.=' AND n.id=?';
            $args[]=$target;
        }
        $rows=$this->query("SELECT n.id,n.title,n.target,n.kind,n.branch_id,n.created_at,n.read_at,r.read_at AS native_read
            FROM clinic_delivery_notice n LEFT JOIN native_notice_read r ON r.notice_id=n.id AND r.membership_id=?
            WHERE $scope ORDER BY n.id DESC LIMIT 120",$args)->fetchAll();
        $items=[];
        foreach ($rows as $row) {
            $details=self::noticeDetails($actor,$row);
            if ($details===null) continue;
            if ($details['category']==='homeVisits') {
                try { $this->homeVisits($actor,$details['record']); }
                catch (RuntimeException $error) { if (!in_array($error->getCode(),[403,404],true)) throw $error; continue; }
            }
            $items[]=['id'=>(string)$row['id'],'title'=>$row['title'],'at'=>$row['created_at'],
                'unread'=>($actor['role']==='customer'?$row['read_at']:$row['native_read'])===null]+$details;
            if (count($items)===50) break;
        }
        if ($target!==null && !$items) throw new RuntimeException('Bildirim bulunamadı.',404);
        if ($change) {
            $ids=array_column($items,'id');
            foreach ($ids as $id) {
                if ($actor['role']==='customer') {
                    $this->query('UPDATE clinic_delivery_notice SET read_at=? WHERE id=? AND partner_id=? AND customer_id=?
                        AND (membership_id=\'\' OR membership_id=?)',[$action==='unread'?null:$now,$id,$actor['partner_id'],$actor['customer_id'],$actor['membership_id']]);
                } elseif ($action==='unread') {
                    $this->query('DELETE FROM native_notice_read WHERE membership_id=? AND notice_id=?',[$actor['membership_id'],$id]);
                } else {
                    $this->query('INSERT IGNORE INTO native_notice_read(membership_id,notice_id,read_at) VALUES (?,?,?)',[$actor['membership_id'],$id,$now]);
                }
            }
            return $this->inbox($actor,$now);
        }
        return ['items'=>$items,'unread'=>count(array_filter($items,static fn(array $item)=>$item['unread']))];
    }

    public static function noticeDetails(array $actor,array $row): ?array
    {
        $target=$row['target'];
        $category=null; $record=null;
        if (in_array($row['kind'],['native_visit_clinic','native_visit_owner'],true) &&
            preg_match('~\A/evde-hizmet/uygulama/([a-f0-9]{32})\z~D',$target,$visit) &&
            (($actor['role']==='customer')===($row['kind']==='native_visit_owner'))) {
            return ['category'=>'homeVisits','record'=>$visit[1]];
        }

        if ($actor['role']==='customer') {
            $kind=$row['kind'];
            if ($kind==='homecare') $category='homecare';
            elseif (in_array($kind,['appointments','shares','exam','lab','xray'],true) && (ClinicAccess::modules($actor)->$kind??'')==='read') {
                $category=$kind==='appointments'?'appointments':'shared';
                if ($category==='appointments' && preg_match('/[?&]kayit=([A-Za-z0-9_-]{1,80})(?:&|$)/D',$target,$match)) $record=$match[1];
            }
        } else {
            $rules=['appointments'=>['appointments','appointments'],'followups'=>['followups','vaccines'],'stays'=>['stays','vaccines']];
            if (preg_match('~\A/(?:clinic|klinik)#record/(appointments|followups|stays)/([A-Za-z0-9_-]{1,80})\z~D',$target,$match)) {
                [$collection,$key]=$rules[$match[1]];
                if (ClinicAccess::allowed($actor,$collection)) { $category=$key; if ($key==='appointments') $record=$match[2]; }
            } elseif (preg_match('~\A/(?:clinic|klinik)#product/([A-Za-z0-9_-]{1,80})\z~D',$target,$match) && ClinicAccess::allowed($actor,'products')) {
                $category='stock'; $record=$match[1];
            }
            elseif (str_contains($target,'homecare') && ClinicAccess::allowed($actor,'patients')) $category='homecare';
        }
        return $category===null?null:['category'=>$category,'record'=>$record];
    }

    public static function deviceHash(array $cookies): string
    {
        return base64_encode(hash('sha256',$cookies[SessionRepository::DEVICE_COOKIE],true));
    }

    public function device(array $actor,array $cookies,int $now,?object $body): array
    {
        $deviceHash=self::deviceHash($cookies);
        if (($body->action??'')==='disable') {
            $this->query('DELETE FROM native_device WHERE device_hash=? AND account_id=?',[$deviceHash,$actor['account_id']]);
            return ['enabled'=>false];
        }
        $available=!empty($this->config['nativePushProject']) && !empty($this->config['nativePushCredentialFile']);
        $windows=NativeWindowsPush::configured($this->config['nativeWindowsPush']??[]);
        if ($body) {
            $mute=$body->mute??[]; $tone=$body->tone??'default';
            if (!is_array($mute) || count($mute)>count(self::CATEGORIES) ||
                count(array_filter($mute,static fn($item)=>in_array($item,self::CATEGORIES,true)))!==count($mute) ||
                !in_array($tone,['default','silent'],true)) throw new RuntimeException('Cihaz ayarları geçersiz.',422);
            $muted=json_encode(array_values(array_unique($mute)),JSON_THROW_ON_ERROR);
        }
        if (($body->action??'')==='preferences') {
            $this->query('UPDATE native_device SET mute=?,tone=? WHERE device_hash=? AND account_id=? AND membership_id=?',
                [$muted,$tone,$deviceHash,$actor['account_id'],$actor['membership_id']]);
        } elseif ($body) {
            $token=$body->token??null; $os=$body->platform??null; $build=$body->build??null;
            if (!is_string($token) || !in_array($os,['android','ios','macos','windows'],true) ||
                ($os==='windows'?!NativeWindowsPush::channelAllowed($token):!preg_match('/\A[A-Za-z0-9:._-]{24,4096}\z/D',$token)) ||
                !is_string($build) || !preg_match('/\A[A-Za-z0-9.+-]{1,32}\z/D',$build)) {
                throw new RuntimeException('Cihaz kaydı geçersiz.',422);
            }
            if ($os==='windows'?!$windows:!$available) throw new RuntimeException('Push hizmeti bu sunucuda etkin değil.',503);
            $tokenHash=hash('sha256',$token);
            $cipher=Totp::encrypt($token,$this->config['encryptionKey']??'');
            $this->db->beginTransaction();
            try {
                $current=(new SessionRepository($this->db))->resolve($cookies,$now,true);
                if (!$current || $current['membership_id']!==$actor['membership_id']) throw new RuntimeException('Oturum değişti.',409);
                $version=$this->query('SELECT version FROM identity_account WHERE id=? FOR UPDATE',[$actor['account_id']])->fetchColumn();
                $this->query('DELETE FROM native_device WHERE (token_hash=? OR device_hash=?) AND NOT (token_hash=? AND device_hash=? AND account_id=? AND membership_id=?)',
                    [$tokenHash,$deviceHash,$tokenHash,$deviceHash,$actor['account_id'],$actor['membership_id']]);
                $this->query('INSERT INTO native_device(account_id,membership_id,device_hash,token_hash,token_cipher,platform,build,account_version,registered_at,seen_at,mute,tone)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE token_cipher=VALUES(token_cipher),platform=VALUES(platform),
                    build=VALUES(build), seen_at=VALUES(seen_at),mute=VALUES(mute),tone=VALUES(tone),account_version=VALUES(account_version)',
                    [$actor['account_id'],$actor['membership_id'],$deviceHash,$tokenHash,$cipher,$os,$build,$version,$now,$now,$muted,$tone]);
                $this->db->commit();
            } catch (\Throwable $error) { $this->db->rollBack(); throw $error; }
        }
        if (!$body) $this->query('UPDATE native_device SET seen_at=? WHERE device_hash=? AND account_id=? AND membership_id=? AND seen_at < ?',
            [$now,$deviceHash,$actor['account_id'],$actor['membership_id'],$now-86400]);
        $row=$this->query('SELECT mute,tone FROM native_device WHERE device_hash=? AND account_id=? AND membership_id=?',[$deviceHash,$actor['account_id'],$actor['membership_id']])->fetch();
        return ['enabled'=>(bool)$row,'available'=>$available,'windowsAvailable'=>$windows,
            'mute'=>$row?json_decode($row['mute'],true):[],'tone'=>$row['tone']??'default'];
    }

    public function deletion(array $actor,int $now,?object $body): array
    {
        if ($body) {
            if ($now-(int)$actor['reauth_at']>300 || ($body->confirm??false)!==true) throw new RuntimeException('Talep için hesabınızı yeniden doğrulayın.',403);
            $this->query('INSERT IGNORE INTO native_deletion_request(account_id,requested_at) VALUES (?,?)',[$actor['account_id'],$now]);
        }
        $timestamp=$this->query('SELECT requested_at FROM native_deletion_request WHERE account_id=?',[$actor['account_id']])->fetchColumn();
        return ['requestedAt'=>$timestamp===false?null:(int)$timestamp];
    }

    public function management(?object $body=null): array
    {
        if ($body) {
            $category=$body->category??null;$role=$body->role??null;$enabled=$body->enabled??null;
            if (!in_array($category,self::CATEGORIES,true) || !in_array($role,['dealer','branch','staff','customer'],true) ||
                !is_bool($enabled)) throw new RuntimeException('Bildirim politikası geçersiz.',422);
            $this->query('INSERT INTO native_push_policy(category,role,enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
                [$category,$role,(int)$enabled]);
        }
        return [
            'devices'=>$this->query('SELECT platform,build,COUNT(*) AS total FROM native_device WHERE seen_at>=? GROUP BY platform,build ORDER BY platform,build LIMIT 100',
                [time()-60*86400])->fetchAll(),
            'policies'=>$this->query('SELECT category,role,enabled FROM native_push_policy')->fetchAll(),
            'push'=>$this->query('SELECT outcome,COUNT(*) AS total FROM native_push_delivery GROUP BY outcome')->fetchAll(),
            'deletionRequests'=>$this->query('SELECT r.account_id,r.requested_at FROM native_deletion_request r ORDER BY r.requested_at LIMIT 100')->fetchAll(),
        ];
    }
}
