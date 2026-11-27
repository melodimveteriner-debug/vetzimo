<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

final class HomeVisit
{
    public const SERVICES=[
        'exam'=>'Evde genel veteriner muayenesi','vax'=>'Evde aşı uygulaması','internal'=>'İç parazit uygulaması',
        'external'=>'Dış parazit uygulaması','parasite'=>'İç ve dış parazit uygulaması','nails'=>'Tırnak kesimi',
        'checkup'=>'Check-up','sample'=>'Kan örneği alma','hemogram'=>'Hemogram','biochemistry'=>'Biyokimya',
        'gas'=>'Kan gazı','lab'=>'Diğer laboratuvar testleri','pickup'=>'Hasta nakli / hasta alımı',
        'transfer'=>'Klinik transferi','sterilise'=>'Kısırlaştırma için ön değerlendirme ve kliniğe transfer',
        'followup'=>'Ameliyat sonrası kontrol','dressing'=>'Pansuman','other'=>'Diğer veteriner hizmetleri',
    ];
    public const MODES=['assessment'=>'Ön değerlendirme gerekli','home'=>'Evde uygulanabilir','clinic'=>'Klinik gerekli'];
    public const METHODS=['iban'=>'Havale / EFT','cash'=>'Kapıda nakit','terminal'=>'Kapıda kart / mobil POS','clinic'=>'Klinik kasasında ödeme'];
    public const STATUS=[
        'new'=>'Talep alındı','review'=>'Klinik inceliyor','quoted'=>'Teklif onayı bekleniyor','revision'=>'Revizyon istendi',
        'payment'=>'Ödeme bekleniyor','verification'=>'Ödeme doğrulaması bekleniyor','planning'=>'Planlama bekleniyor',
        'assigned'=>'Personel atandı','departed'=>'Yola çıkıldı','arrived'=>'Adrese varıldı','started'=>'Hizmet başladı',
        'completed'=>'Hizmet tamamlandı','closed'=>'Kapatıldı','cancelled'=>'İptal edildi','postponed'=>'Ertelendi',
        'address'=>'Adres doğrulaması bekleniyor','unavailable'=>'Hizmet verilemedi',
    ];

    public readonly WebBuilder $web;
    private readonly WorkspaceRepository $workspaces;
    private readonly string $secret;
    public function __construct(private readonly PDO $db,public readonly array $config)
    {
        $this->web=new WebBuilder($db,$config);
        $this->workspaces=new WorkspaceRepository($db);
        $this->secret=$config['encryptionKey']??'';
    }

    public static function text(mixed $value,int $length=150,bool $required=false): string
    {
        $text=WebBuilder::text($value??'',$length);
        if ($required && $text==='') throw new RuntimeException('Zorunlu alanları doldurun.',422);
        return $text;
    }

    public function settings(string $partner): array
    {
        $json=$this->web->query('SELECT settings FROM clinic_visit_settings WHERE partner_id=?',[$partner])->fetchColumn();
        $settings=$json?WebBuilder::decode($json):[];
        if (!isset($settings['services'])) {
            $settings['services']=[];
            foreach (self::SERVICES as $id=>$label) $settings['services'][$id]=[
                'label'=>$label,'description'=>'','category'=>'Veteriner hizmeti','minutes'=>30,'from'=>0,'to'=>0,
                'region'=>'','species'=>'','staff'=>'','equipment'=>'','active'=>true,'mode'=>'assessment',
            ];
            foreach (['hemogram','biochemistry','gas','lab','pickup','transfer','sterilise'] as $id) $settings['services'][$id]['mode']='clinic';
        }
        return $settings+['enabled'=>false,'public'=>false,'home_section'=>false,'prices'=>false,'privacy'=>'','methods'=>[],'iban'=>'','bank'=>'',
            'holder'=>'','regions'=>[],'vehicles'=>[],'staff'=>[],'outside'=>'','travel'=>0];
    }

    public function entitled(string $partner): bool
    {
        $plan=$this->web->plan($partner);
        $query=$this->web->query('SELECT plan_id,enabled FROM clinic_visit_package WHERE plan_id IN (?,?)',[$plan??'_default','_default']);
        $rows=array_column($query->fetchAll(),'enabled','plan_id');
        return (bool)($rows[$plan??'_default']??$rows['_default']??false);
    }

    public function publicationIssue(string $partner,array $settings): ?string
    {
        if (!$settings['enabled']) return 'Evde Hizmet etkin seçeneğini açın.';
        if (!$settings['public']) return 'Web sitesinde başvuru aç seçeneğini açın.';
        if (!$this->entitled($partner)) return 'Kliniğinizin paketinde Evde Hizmet yetkisi kapalı. Merkez yönetimindeki Evde Hizmet Paketleri bölümünden ilgili paketi etkinleştirin.';
        if ($settings['privacy']==='') return 'Başvuru aydınlatma metnini kaydedin.';
        if (!array_filter(array_column($settings['services'],'active'))) return 'Hizmet ve fiyat yönetiminden en az bir hizmeti etkinleştirin.';
        return null;
    }

    public function publicCatalog(string $partner): array
    {
        try {
            $settings=$this->settings($partner);
            return $this->publicationIssue($partner,$settings)===null?$settings:[];
        } catch (\PDOException $error) {
            if ($error->getCode()!=='42S02') throw $error;
            return [];
        }
    }

    public function workspace(string $partner): array
    {
        return $this->workspaces->load('partner:'.$partner);
    }

    /** Şube listesi (personel erişim denetimi için; sık yoklanan uçlarda tüm klinik belleğe alınmaz). */
    public function branchesOnly(string $partner): ?object
    {
        return $this->workspaces->only('partner:'.$partner, []);
    }

    /**
     * Yetki ve talep doğrulaması için hafif durum: şubeler, ayarlar, hasta sahibinin kendi müşteri kaydı ve
     * istenen hastalar. Büyük klinikte tüm alanı yüklemez; bir satır bulunamazsa güvenli tam yüklemeye geçer.
     */
    public function accessState(string $partner,?array $actor,array $patients=[]): ?object
    {
        $customer=($actor['role']??'')==='customer'?(string)($actor['customer_id']??''):'';
        $wanted=['clients'=>$customer===''?[]:[$customer],'patients'=>array_values(array_filter($patients,static fn($id)=>is_string($id)&&$id!==''))];
        $state=(new ClinicRecords($this->db))->slice('partner:'.$partner,$wanted);
        if ($state) foreach ($wanted as $collection=>$ids) {
            $found=array_column($state->$collection,null,'id');
            foreach ($ids as $id) if (!isset($found[$id])) return $this->workspace($partner)['state'];
        }
        return $state ?? $this->workspace($partner)['state'];
    }

    public function lock(string $partner): void
    {
        if (!$this->web->query('SELECT id FROM partner_account WHERE id=? AND active=1 FOR UPDATE',[$partner])->fetchColumn()) {
            throw new RuntimeException('Klinik bulunamadı.',404);
        }
    }

    public function decode(string $value): array
    {
        return WebBuilder::decode(Totp::decrypt($value,$this->secret));
    }

    private function encode(array $value): string
    {
        return Totp::encrypt(WebBuilder::json($value),$this->secret);
    }

    public function staffAllowed(array $actor,array $settings,bool $write=false): bool
    {
        return $actor['role']==='dealer' || (ClinicAccess::allowed($actor,'appointments',$write) &&
            ($actor['role']==='branch' || in_array($actor['membership_id'],$settings['staff'],true)));
    }

    public function roster(string $partner): array
    {
        return $this->web->query("SELECT m.id,m.account_id,m.name,m.branch_id,m.role,m.modules FROM identity_membership m
            JOIN identity_account a ON a.id=m.account_id AND a.blocked=0
            WHERE m.partner_id=? AND m.status='active' AND m.role IN ('dealer','branch','staff') ORDER BY m.name,m.id",[$partner])->fetchAll();
    }

    public function schedulableStaff(string $partner,string $branch,array $settings): array
    {
        return array_filter($this->roster($partner),static fn($member)=>$member['role']==='dealer'||
            ($member['branch_id']===$branch&&($member['role']==='branch'||
                (in_array($member['id'],$settings['staff'],true)&&ClinicAccess::allowed($member,'appointments')))));
    }

    public static function iban(string $value): string
    {
        $value=strtoupper(preg_replace('/\s+/','',$value));
        if (!preg_match('/\ATR\d{24}\z/D',$value)) throw new RuntimeException('Geçerli bir Türkiye IBAN’ı girin.',422);
        $rem=0;
        foreach (str_split(substr($value,4).'2927'.substr($value,2,2)) as $digit) $rem=($rem*10+(int)$digit)%97;
        if ($rem!==1) throw new RuntimeException('IBAN kontrol basamakları geçersiz.',422);
        return $value;
    }

    public static function location(string $group,int $parent=0): array
    {
        static $data;
        if ($data===null) $data=WebBuilder::decode(file_get_contents(dirname(__DIR__).'/database/visit-addresses.json'));
        return $group==='provinces'?$data['provinces']:($data[$group][$parent]??[]);
    }

    private function address(array $post,array $settings): array
    {
        $province=(int)self::text($post['province']??'',8,true);
        $district=(int)self::text($post['district']??'',8,true);
        $neighborhood=(int)self::text($post['neighborhood']??'',8,true);
        $p=array_column(self::location('provinces'),1,0)[$province]??null;
        $d=array_column(self::location('districts',$province),1,0)[$district]??null;
        $n=array_column(self::location('neighborhoods',$district),1,0)[$neighborhood]??null;
        if (!$p || !$d || !$n) throw new RuntimeException('İl, ilçe ve mahalleyi listelerden seçin.',422);
        if ($settings['regions'] && !in_array("$province:$district",$settings['regions'],true)) throw new RuntimeException('Seçilen adres hizmet bölgesi dışında.',422);
        $address=['province'=>$p,'district'=>$d,'neighborhood'=>$n,'region'=>"$province:$district"];
        foreach (['street','building','floor','unit','landmark','address','title'] as $field) $address[$field]=self::text($post[$field]??null,$field==='address'?1000:160,true);
        if (!in_array($address['title'],['Ev','İş','Diğer'],true)) throw new RuntimeException('Adres başlığını seçin.',422);
        $address['altPhone']=self::text($post['alt_phone']??'',35);
        if ($address['altPhone']!=='') {
            $address['altPhone']=WebBuilder::phone($address['altPhone']);
            if (!$address['altPhone']) throw new RuntimeException('Alternatif telefon geçersiz.',422);
        }
        $lat=self::text($post['latitude']??'',30);
        $lon=self::text($post['longitude']??'',30);
        if ($lat!=='' || $lon!=='') {
            if (!is_numeric($lat)||!is_numeric($lon)||(float)$lat<35.8||(float)$lat>42.2||(float)$lon<25.5||(float)$lon>45) {
                throw new RuntimeException('Türkiye sınırları içinde bir harita noktası girin.',422);
            }
            if (($post['pin_confirm']??'')!=='yes') throw new RuntimeException('Harita noktasının yazılı adresle eşleştiğini onaylayın.',422);
            $address['latitude']=round((float)$lat,5);
            $address['longitude']=round((float)$lon,5);
        }
        return $address;
    }

    public static function time(string $date,string $time): DateTimeImmutable
    {
        $raw=$date.' '.$time;
        $parsed=DateTimeImmutable::createFromFormat('!Y-m-d H:i',$raw,new DateTimeZone('Europe/Istanbul'));
        if (!$parsed || $parsed->format('Y-m-d H:i')!==$raw) throw new RuntimeException('Geçerli bir tarih ve saat seçin.',422);
        return $parsed;
    }

    public function event(array $row,int $revision,string $status,string $by,string $action,?string $audience=null,?string $token=null,array $detail=[]): void
    {
        $this->web->query('INSERT INTO clinic_visit_event(visit_id,partner_id,revision,status,author,action,detail) VALUES(?,?,?,?,?,?,?)',
            [$row['id'],$row['partner_id'],$revision,$status,$by,$action,$detail?$this->encode($detail):null]);
        if ($audience) $this->web->query('INSERT INTO clinic_visit_mail(event_id,audience,secret,retry_at) VALUES(?,?,?,?)',
            [$this->db->lastInsertId(),$audience,$token?$this->encode(['token'=>$token]):null,time()]);
        if ($audience==='clinic') {
            $scope=$this->web->query('SELECT branch_id,customer_id FROM clinic_visit_request WHERE id=? AND partner_id=?',
                [$row['id'],$row['partner_id']])->fetch();
            $notices=new DeliveryNotice($this->db);
            $title='Evde Hizmet · '.(self::STATUS[$status]??$status);
            $target='/evde-hizmet/uygulama/'.$row['id'];
            $key='app:visit:'.$row['id'].':'.$revision;
            $notices->add($row['partner_id'],$scope['branch_id'],'','visit_clinic',$key.':clinic',$title,$target);
            if ($scope['customer_id']!=='' && $action!=='request') {
                $notices->add($row['partner_id'],$scope['branch_id'],$scope['customer_id'],'visit_owner',$key.':owner',$title,$target);
            }
        }
    }

    public function request(string $partner,?array $actor,array $post): string
    {
        return $this->web->transaction(function() use($partner,$actor,$post) {
            $this->lock($partner);
            $settings=$this->settings($partner);
            if (!$this->entitled($partner)||!$settings['enabled']||!$settings['privacy']||(!$actor&&!$settings['public'])) {
                throw new RuntimeException('Evde hizmet başvurusu kapalı.',403);
            }
            if (($post['consent']??'')!=='yes'||($post['address_confirm']??'')!=='yes') throw new RuntimeException('Adres doğruluğu ve aydınlatma metnini onaylayın.',422);
            $state=$this->accessState($partner,$actor,$actor?[self::text($post['patient']??'',80)]:[]);
            $branch=self::text($post['branch']??'',80);
            $branches=array_values(array_filter($state->branches??[],static fn($row)=>($row->status??'')!=='Pasif'));
            if ($branch==='' && count($branches)===1) $branch=$branches[0]->id;
            if (!$state||!($location=ClinicAccess::branch($state,$branch))) throw new RuntimeException('Etkin şubeyi seçin.',422);
            $customerId='';$patientId='';
            if ($actor) {
                $client=(new WebBooking($this->db,$this->web))->verifiedClient($partner,$actor,$state);
                $patientId=self::text($post['patient']??'',80,true);
                $patient=array_column($state->patients??[],null,'id')[$patientId]??null;
                if (!$client||!$patient||$patient->owner!==$client->id||$patient->branch!==$client->branch||
                    $client->branch!== (($location->sharedWith??'')?:$branch)) throw new RuntimeException('Hasta bu hesaba veya şubeye bağlı değil.',422);
                $customerId=$client->id;
                $contact=['name'=>$client->name,'phone'=>$actor['identifier'],'animal'=>$patient->name,'species'=>$patient->species??''];
            } else {
                foreach (['name','phone','animal','species'] as $field) $contact[$field]=self::text($post[$field]??null,160,true);
                $contact['phone']=WebBuilder::phone($contact['phone']);
                if (!$contact['phone']) throw new RuntimeException('Telefon geçersiz.',422);
            }
            $contact['email']=self::text($post['email']??'',250,!$actor);
            if ($actor&&!$contact['email']&&filter_var($client->email??'',FILTER_VALIDATE_EMAIL)) $contact['email']=$client->email;
            if ($contact['email']&&!filter_var($contact['email'],FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Geçerli bir e-posta girin.',422);
            $address=$this->address($post,$settings);
            $date=self::text($post['date']??'',10,true);
            $from=self::time($date,self::text($post['from']??'',5,true));
            $to=self::time($date,self::text($post['to']??'',5,true));
            if ($from<new DateTimeImmutable('now')||$to<=$from||$from>new DateTimeImmutable('+90 days')) throw new RuntimeException('Önümüzdeki 90 gün içinde geçerli bir saat aralığı seçin.',422);
            $ids=$post['services']??[];
            if (!is_array($ids)||!$ids||count($ids)>12) throw new RuntimeException('En az bir, en fazla 12 hizmet seçin.',422);
            $services=[];
            foreach ($ids as $id) {
                $id=self::text($id,32,true);
                $service=$settings['services'][$id]??[];
                $regions=self::regionEntries($service['region']??'');
                if (empty($service['active'])||($regions&&!in_array($address['region'],$regions,true))) throw new RuntimeException('Seçilen hizmet bu adres için etkin değil.',422);
                if ($service['species'] && !in_array($contact['species'],array_map('trim',explode(',',$service['species'])),true)) {
                    throw new RuntimeException('Seçilen hizmet bu hayvan türü için tanımlı değil.',422);
                }
                $services[$id]=$service;
            }
            $notes=self::text($post['notes']??null,1800,true);
            $selected=array_keys($services);sort($selected);
            $digest=hash_hmac('sha256',WebBuilder::json([$contact['phone'],$patientId?:$contact['animal'],$date,$from->format('H:i'),$to->format('H:i'),
                $selected,$address['region'],$address['address']]),$this->config['rateSecret']);
            if ($this->web->query('SELECT id FROM clinic_visit_request WHERE partner_id=? AND request_hash=?',[$partner,$digest])->fetchColumn()) {
                throw new RuntimeException('Aynı başvuru daha önce gönderilmiş.',409);
            }
            $id=bin2hex(random_bytes(16));
            $token=$actor?null:bin2hex(random_bytes(32));
            $snapshot=$contact+['location'=>$address,'services'=>$services,'date'=>$date,'from'=>$from->format('H:i'),'to'=>$to->format('H:i'),
                'notes'=>$notes,'consent_at'=>gmdate('c'),'privacy_hash'=>hash('sha256',$settings['privacy'])];
            $this->web->query('INSERT INTO clinic_visit_request(id,partner_id,branch_id,customer_id,patient_id,status,snapshot,request_hash,token_hash,token_expires)
                VALUES(?,?,?,?,?,?,?,?,?,?)',[$id,$partner,$branch,$customerId,$patientId,'new',$this->encode($snapshot),$digest,
                $token?hash('sha256',$token):null,$token?time()+86400:null]);
            $row=['id'=>$id,'partner_id'=>$partner];
            $this->event($row,1,'new',$actor['account_id']??'guest','request','clinic');
            if ($token) {
                $this->web->query("INSERT INTO clinic_visit_mail(event_id,audience,secret,retry_at)
                    SELECT id,'owner',?,? FROM clinic_visit_event WHERE visit_id=? AND revision=1",[$this->encode(['token'=>$token]),time(),$id]);
            }
            return $id;
        });
    }

    public function saveSettings(array $actor,array $post): void
    {
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $partner=$actor['partner_id'];
        $this->web->transaction(function() use($partner,$post) {
            $this->lock($partner);
            $s=$this->settings($partner);
            if (($post['action']??'')==='service') {
                $id=self::settingsText($post,'service_id','Hizmet kaydı',32);
                if ($id!=='' && !isset($s['services'][$id])) {
                    throw new RuntimeException('Düzenlenen hizmet bulunamadı. Ayarları yeniden açıp hizmeti tekrar seçin.',404);
                }
                if ($id==='') $id=bin2hex(random_bytes(8));
                $labels=['label'=>'Hizmet adı','description'=>'Açıklama','category'=>'Kategori',
                    'species'=>'Hayvan türleri','staff'=>'Gerekli personel','equipment'=>'Gerekli ekipman'];
                $row=['active'=>($post['active']??'')==='yes'];
                foreach ($labels as $name=>$label) {
                    $row[$name]=self::settingsText($post,$name,$label,$name==='description'?2000:200,in_array($name,['label','category'],true));
                }
                $minutes=self::settingsText($post,'minutes','Süre',10,true);
                if (!preg_match('/\A[0-9]+\z/D',$minutes)||(int)$minutes<5||(int)$minutes>480) {
                    throw new RuntimeException('Süre alanına 5 ile 480 arasında tam dakika girin.',422);
                }
                $row['minutes']=(int)$minutes;
                $row['mode']=self::settingsText($post,'mode','Uygulama koşulu',20,true);
                if (!isset(self::MODES[$row['mode']])) throw new RuntimeException('Geçerli bir uygulama koşulu seçin.',422);
                if ($id==='sterilise'&&$row['mode']==='home') {
                    throw new RuntimeException('Kısırlaştırma için ön değerlendirme veya klinik gerekli seçeneğini kullanın.',422);
                }
                $row['from']=self::settingsAmount($post,'price_from','Başlangıç fiyatı');
                $row['to']=self::settingsAmount($post,'price_to','Üst fiyat');
                if ($row['to']&&$row['to']<$row['from']) throw new RuntimeException('Üst fiyat, başlangıç fiyatından düşük olamaz.',422);
                $row['region']=implode("\n",self::selectedRegions($post,'region'));
                $s['services'][$id]=$row;
            } else {
                foreach (['enabled','public','home_section','prices'] as $flag) $s[$flag]=($post[$flag]??'')==='yes';
                $s['privacy']=self::settingsText($post,'privacy','Başvuru aydınlatma metni',9000,$s['enabled']);
                $s['outside']=self::settingsText($post,'outside','Hizmet bölgesi açıklaması',300);
                $s['travel']=self::settingsAmount($post,'travel','Varsayılan ulaşım bedeli');
                $s['methods']=array_values(array_intersect(array_keys(self::METHODS),is_array($post['methods']??null)?array_filter($post['methods'],'is_string'):[]));
                $useIban=in_array('iban',$s['methods'],true);
                $s['bank']=self::settingsText($post,'bank','Banka',160,$useIban);
                $s['holder']=self::settingsText($post,'holder','Hesap sahibi',160,$useIban);
                $iban=self::settingsText($post,'iban','IBAN',40,$useIban);
                $s['iban']=$iban!==''?self::iban($iban):'';
                $s['regions']=self::selectedRegions($post,'regions');
                $vehicles=preg_split('/\R/',self::settingsText($post,'vehicles','Araçlar',3500),-1,PREG_SPLIT_NO_EMPTY);
                $s['vehicles']=array_values(array_unique(array_map(static fn($line)=>self::settingsText(['vehicle'=>$line],'vehicle','Araç adı',80,true),$vehicles)));
                $s['staff']=array_values(array_intersect(array_column($this->roster($partner),'id'),
                    is_array($post['staff']??null)?array_filter($post['staff'],'is_string'):[]));
            }
            $this->web->query('INSERT INTO clinic_visit_settings(partner_id,settings) VALUES(?,?) ON DUPLICATE KEY UPDATE settings=VALUES(settings)',
                [$partner,WebBuilder::json($s)]);
        });
    }

    private static function settingsText(array $post,string $key,string $label,int $limit,bool $required=false): string
    {
        try {
            $value=self::text($post[$key]??'',$limit);
        } catch (RuntimeException) {
            throw new RuntimeException($label.' alanındaki metin geçersiz veya çok uzun. Alanı kontrol edip kısaltın.',422);
        }
        if ($required&&$value==='') throw new RuntimeException($label.' alanını doldurun.',422);
        return $value;
    }

    private static function settingsAmount(array $post,string $key,string $label): int
    {
        $value=self::settingsText($post,$key,$label,20);
        if ($value==='') return 0;
        try {
            return self::money(str_replace(',','.',$value));
        } catch (RuntimeException $failure) {
            throw new RuntimeException($label.': '.$failure->getMessage().' Örnek giriş 250,50.',422);
        }
    }

    public static function regionEntries(string $value): array
    {
        return preg_split('/[\s,;]+/u',$value,-1,PREG_SPLIT_NO_EMPTY)?:[];
    }

    public static function regionLabel(string $code): ?string
    {
        if (!preg_match('/\A([0-9]{1,2}):([0-9]{1,6})\z/D',$code,$parts)) return null;
        $province=(int)$parts[1];
        $district=array_column(self::location('districts',$province),1,0)[(int)$parts[2]]??null;
        return $district===null?null:array_column(self::location('provinces'),1,0)[$province].' / '.$district;
    }

    private static function selectedRegions(array $post,string $key): array
    {
        $codes=self::regionEntries(self::settingsText($post,$key,'Hizmet bölgeleri',16000));
        $selected=[];
        foreach ($codes as $code) {
            if (self::regionLabel($code)===null) {
                throw new RuntimeException('Hizmet bölgelerinde geçersiz bir ilçe var. Sorunlu seçimi kaldırıp ilçeyi listeden yeniden ekleyin.',422);
            }
            [$province,$district]=array_map('intval',explode(':',$code));
            $selected[$province.':'.$district]=true;
        }
        return array_keys($selected);
    }

    public static function money(mixed $value): int
    {
        $amount=Finance::money(self::text($value,20,true));
        if ($amount>100000000) throw new RuntimeException('Tutar sınırı aşıldı.',422);
        return $amount;
    }

    public static function decimal(int $cents): string
    {
        return intdiv($cents,100).'.'.sprintf('%02d',$cents%100);
    }

    public function guestExchange(string $token): ?string
    {
        if (!preg_match('/\A[a-f0-9]{64}\z/D',$token)) return null;
        $cookie=bin2hex(random_bytes(32));
        $count=$this->web->query("UPDATE clinic_visit_request SET token_hash=NULL,token_expires=NULL,guest_hash=?,guest_expires=?
            WHERE token_hash=? AND token_expires>=?",[hash('sha256',$cookie),time()+14*86400,hash('sha256',$token),time()])->rowCount();
        return $count===1?$cookie:null;
    }

    public function guestVisit(mixed $cookie): ?array
    {
        if (!is_string($cookie)||!preg_match('/\A[a-f0-9]{64}\z/D',$cookie)) return null;
        return $this->web->query('SELECT * FROM clinic_visit_request WHERE guest_hash=? AND guest_expires>=?',
            [hash('sha256',$cookie),time()])->fetch()?:null;
    }

    public function canDeleteApplication(array $actor): bool
    {
        return ClinicAccess::action($actor,'deleteHomeVisit',true) && ClinicAccess::allowed($actor,'appointments',true);
    }

    public function scoped(array $actor,bool $owner): array
    {
        $partner=$actor['partner_id'];
        $settings=$this->settings($partner);
        if ($owner) return $this->web->query('SELECT r.*,s.starts,s.ends FROM clinic_visit_request r LEFT JOIN clinic_visit_slot s ON s.visit_id=r.id
            WHERE r.partner_id=? AND r.customer_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 150',[$partner,$actor['customer_id']])->fetchAll();
        if (!$this->staffAllowed($actor,$settings) && !$this->canDeleteApplication($actor)) throw new RuntimeException('Evde hizmet yetkiniz yok.',403);
        $sql='SELECT r.*,s.starts,s.ends,s.clinician,s.assistant,s.vehicle FROM clinic_visit_request r LEFT JOIN clinic_visit_slot s ON s.visit_id=r.id WHERE r.partner_id=?';
        $params=[$partner];
        if ($actor['role']!=='dealer') {$sql.=' AND r.branch_id=?';$params[]=$actor['branch_id'];}
        if ($actor['role']==='staff' && !$this->canDeleteApplication($actor)) {$sql.=' AND (s.clinician=? OR s.assistant=?)';array_push($params,$actor['membership_id'],$actor['membership_id']);}
        return $this->web->query($sql.' ORDER BY r.created_at DESC,r.id DESC LIMIT 150',$params)->fetchAll();
    }

    public function stats(array $actor): array
    {
        $day=WebBuilder::today();
        $params=[$day,$day,$actor['partner_id']];
        $filter='';
        if ($actor['role']!=='dealer') {$filter=' AND r.branch_id=?';$params[]=$actor['branch_id'];}
        if ($actor['role']==='staff' && !$this->canDeleteApplication($actor)) {$filter.=' AND (s.clinician=? OR s.assistant=?)';array_push($params,$actor['membership_id'],$actor['membership_id']);}
        return $this->web->query("SELECT COUNT(*) total,
            COALESCE(SUM(DATE(r.created_at+INTERVAL 3 HOUR)=?),0) new_today,
            COALESCE(SUM(DATE(s.starts)=? AND s.released=0),0) today_slots,
            COALESCE(SUM(IF(p.status='paid',p.total,0)),0) received,
            COALESCE(AVG(IF(r.status IN ('completed','closed'),TIMESTAMPDIFF(MINUTE,s.starts,s.ends),NULL)),0) planned_duration
            FROM clinic_visit_request r LEFT JOIN clinic_visit_slot s ON s.visit_id=r.id
            LEFT JOIN clinic_visit_payment p ON p.visit_id=r.id WHERE r.partner_id=?".$filter,$params)->fetch();
    }

    public function find(array $actor,string $id,bool $owner): array
    {
        if (!preg_match('/\A[a-f0-9]{32}\z/D',$id)) throw new RuntimeException('Başvuru bulunamadı.',404);
        $params=[$id,$actor['partner_id']];
        $where='WHERE r.id=? AND r.partner_id=?';
        if ($owner) {$where.=' AND r.customer_id=?';$params[]=$actor['customer_id'];}
        elseif ($actor['role']!=='dealer') {
            $where.=' AND r.branch_id=?';$params[]=$actor['branch_id'];
            if ($actor['role']==='staff' && !$this->canDeleteApplication($actor)) {$where.=' AND (s.clinician=? OR s.assistant=?)';array_push($params,$actor['membership_id'],$actor['membership_id']);}
        }
        $row=$this->web->query('SELECT r.* FROM clinic_visit_request r LEFT JOIN clinic_visit_slot s ON s.visit_id=r.id '.$where,$params)->fetch();
        if (!$row) throw new RuntimeException('Başvuru bulunamadı.',404);
        return $row;
    }

    public function details(string $id): array
    {
        return [
            $this->web->query('SELECT * FROM clinic_visit_quote WHERE visit_id=? ORDER BY version DESC',[$id])->fetchAll(),
            $this->web->query('SELECT * FROM clinic_visit_payment WHERE visit_id=?',[$id])->fetch()?:null,
            $this->web->query('SELECT * FROM clinic_visit_slot WHERE visit_id=?',[$id])->fetch()?:null,
        ];
    }

    public function change(array $access,?array $actor,array $post,bool $owner): void
    {
        $this->web->transaction(function() use($access,$actor,$post,$owner) {
            $this->lock($access['partner_id']);
            $row=$this->web->query('SELECT * FROM clinic_visit_request WHERE id=? AND partner_id=? FOR UPDATE',[$access['id'],$access['partner_id']])->fetch();
            if (!$row||(int)$row['revision']!==(int)($post['revision']??0)) throw new RuntimeException('Başvuru değişti. Sayfayı yenileyin.',409);
            $settings=$this->settings($row['partner_id']);
            if (!$owner && !$this->staffAllowed($actor,$settings,true)) throw new RuntimeException('Evde hizmet düzenleme yetkiniz yok.',403);
            if ($owner && !$actor && ((int)$row['guest_expires']<time()||!$access['guest_hash']||$row['guest_hash']!==$access['guest_hash'])) throw new RuntimeException('Takip oturumu sona erdi.',403);
            [$quotes,$payment,$slot]=$this->details($row['id']);
            if (!$owner && $actor['role']!=='dealer' && ($row['branch_id']!==$actor['branch_id'] ||
                ($actor['role']==='staff'&&!in_array($actor['membership_id'],[$slot['clinician']??'',$slot['assistant']??''],true)))) {
                throw new RuntimeException('Başvuru bulunamadı.',404);
            }
            $quote=$quotes[0]??null;
            $status=$row['status'];
            $action=self::text($post['action']??'',32,true);
            $by=$actor['account_id']??'guest';
            $detail=[];
            $manager=!$owner && in_array($actor['role'],['dealer','branch'],true);
            if ($owner) {
                $next=$this->ownerAction($row,$quote,$payment,$settings,$post,$action);
            } else {
                $next=match($action) {
                    'review'=>$manager&&$status==='new'?'review':null,
                    'quote'=>$manager&&in_array($status,['new','review','quoted','revision'],true)?$this->quote($row,$quotes,$post,$by):null,
                    'verify'=>$manager&&(in_array($payment['status']??'',['reported','onsite'],true)||
                        ($actor['role']==='dealer'&&($payment['status']??'')==='pending'&&($payment['method']??'')==='iban'))&&
                        ClinicAccess::allowed($actor,'expenses',true)&&ClinicAccess::allowed($actor,'sales',true)&&ClinicAccess::allowed($actor,'collections',true)?$this->collect($row,$payment,$actor,$post):null,
                    'assign'=>$manager&&in_array($status,['planning','assigned','postponed'],true)?$this->assign($row,$settings,$post,$actor):null,
                    'postpone'=>$manager&&in_array($status,['assigned','planning'],true)?'postponed':null,
                    'address'=>$manager&&in_array($status,['new','review','address'],true)?'address':null,
                    'cancel'=>$manager&&in_array($status,['new','review','quoted','revision','address','payment','planning','assigned','postponed'],true)&&($payment['status']??'')!=='paid'?'cancelled':null,
                    'depart'=>$status==='assigned'?'departed':null,
                    'arrive'=>$status==='departed'?'arrived':null,
                    'start'=>$status==='arrived'?'started':null,
                    'complete'=>$status==='started'?'completed':null,
                    'unavailable'=>in_array($status,['assigned','departed','arrived','started'],true)?'unavailable':null,
                    'close'=>$manager&&$status==='completed'&&($payment['status']??'')==='paid'?'closed':null,
                    default=>null,
                };
            }
            if (!$owner && $action==='record' && in_array($status,['started','completed'],true) && $row['patient_id']!=='') {
                $detail=$this->clinicalRecord($row,$actor,$post);
                $next=$status;
            }
            if ($owner && $action==='revise' && $next==='revision') $detail=['message'=>self::text($post['revision_note']??'',700)];
            if (!$owner && $actor['role']==='dealer') {
                if ($action==='phone_accept') {
                    if (($post['phone_consent']??'')!=='yes') throw new RuntimeException('Telefonda alınan açık onayı işaretleyin.',422);
                    $next=$this->ownerAction($row,$quote,$payment,$settings,$post,'accept');
                    $detail=['message'=>'Bayi yöneticisi telefonda alınan müşteri onayını kaydetti.'];
                }
                if ($action==='pin' && !in_array($status,['closed','cancelled'],true)) {
                    $snapshot=$this->decode($row['snapshot']);
                    $lat=str_replace(',','.',self::text($post['latitude']??'',30,true));
                    $lon=str_replace(',','.',self::text($post['longitude']??'',30,true));
                    if (!is_numeric($lat)||!is_numeric($lon)||(float)$lat<35.8||(float)$lat>42.2||(float)$lon<25.5||(float)$lon>45
                        ||($post['pin_confirm']??'')!=='yes') throw new RuntimeException('Türkiye içinde geçerli bir konum girin ve adresle eşleşmesini onaylayın.',422);
                    $location=&$snapshot['location'];
                    $detail=['previous'=>[$location['latitude']??null,$location['longitude']??null],'message'=>'Ziyaretin harita konumu güncellendi.'];
                    $location['latitude']=round((float)$lat,5); $location['longitude']=round((float)$lon,5);
                    $this->web->query('UPDATE clinic_visit_request SET snapshot=? WHERE id=?',[$this->encode($snapshot),$row['id']]);
                    $next=$status==='address'?'review':$status;
                }
                if ($action==='resend' && $row['customer_id']==='' && !in_array($status,['closed','cancelled'],true)
                    && !empty($this->decode($row['snapshot'])['email'])) {
                    $last=$this->web->query("SELECT 1 FROM clinic_visit_event WHERE visit_id=? AND action='resend' AND created_at>NOW()-INTERVAL 2 MINUTE",[$row['id']])->fetchColumn();
                    if ($last) throw new RuntimeException('Yeni takip bağlantısı istemek için iki dakika bekleyin.',429);
                    $next=$status;
                }
            }
            if (!$next) throw new RuntimeException('Bu işlem mevcut durumda kullanılamaz.',409);
            if ($slot && $next!==$status && in_array($next,['postponed','cancelled','unavailable','completed'],true)) {
                $this->web->query('UPDATE clinic_visit_slot SET released=1 WHERE visit_id=?',[$row['id']]);
                $this->calendar($row,$slot,$next==='completed'?'Tamamlandı':'İptal Edildi');
            }
            $revision=(int)$row['revision']+1;
            $this->web->query('UPDATE clinic_visit_request SET status=?,revision=? WHERE id=?',[$next,$revision,$row['id']]);
            $this->event($row,$revision,$next,$by,$action,!in_array($action,['record','resend','pin'],true)?'clinic':null,null,$detail);
            if (!$owner&&!in_array($action,['record','pin'],true)&&!empty($this->decode($row['snapshot'])['email'])) {
                $secret=null;
                if ($row['customer_id']==='' && in_array($action,['quote','resend'],true)) {
                    $token=bin2hex(random_bytes(32));
                    $secret=$this->encode(['token'=>$token]);
                    $this->web->query('UPDATE clinic_visit_request SET token_hash=?,token_expires=? WHERE id=?',
                        [hash('sha256',$token),time()+86400,$row['id']]);
                }
                $this->web->query("INSERT INTO clinic_visit_mail(event_id,audience,secret,retry_at)
                    SELECT id,'owner',?,? FROM clinic_visit_event WHERE visit_id=? AND revision=?", [$secret,time(),$row['id'],$revision]);
            }
        });
    }

    public function deleteApplication(array $actor,string $id,int $revision): void
    {
        if (!$this->canDeleteApplication($actor)) {
            throw new RuntimeException('Bu başvuru için randevu yazma ve Evde Hizmet silme yetkileri gerekir.',403);
        }
        $this->web->transaction(function() use($actor,$id,$revision) {
            $partner=$actor['partner_id'];
            $this->lock($partner);
            $row=$this->web->query('SELECT revision,branch_id FROM clinic_visit_request WHERE id=? AND partner_id=? FOR UPDATE',[$id,$partner])->fetch();
            if (!$row || ($actor['role']!=='dealer' && $row['branch_id']!==$actor['branch_id'])) {
                throw new RuntimeException('Başvuru bulunamadı.',404);
            }
            if ((int)$row['revision']!==$revision) throw new RuntimeException('Başvuru değişti. Sayfayı yenileyin.',409);
            $data=$this->workspace($partner);
            $state=$data['state'];
            $calendar='visit-'.$id;
            $state->appointments=array_values(array_filter($state->appointments,static fn($entry)=>$entry->id!==$calendar));
            foreach ($state->sales as $sale) {
                if (($sale->visitId??'')!==$id) continue;
                unset($sale->visitId);
                if (($sale->publicNotes??'')==='Evde Hizmet · '.$id) unset($sale->publicNotes);
            }
            require_once __DIR__.'/ClinicRecordDeletion.php';
            $deletion=new ClinicRecordDeletion($this->db);
            $deletion->deleteVisit($partner,$id);
            $deletion->deleteAppointmentData($partner,$calendar);
            $saved=$this->workspaces->save('partner:'.$partner,$data['revision'],$state);
            if (!$saved) throw new RuntimeException('Kayıt değişti. Tekrar deneyin.',409);
            $this->web->query('INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,?,?)',
                [$partner,$actor['account_id'],'home_visit.deleted',$saved]);
        });
    }

    private function ownerAction(array $row,?array $quote,?array $payment,array $s,array $post,string $action): ?string
    {
        $status=$row['status'];
        if ($action==='cancel' && in_array($status,['new','review','quoted','revision','payment','planning','assigned','postponed','address'],true)
            && ($payment['status']??'')!=='paid') return 'cancelled';
        if ($action==='paid' && $status==='payment' && ($payment['method']??'')==='iban') {
            $this->web->query("UPDATE clinic_visit_payment SET status='reported' WHERE visit_id=?",[$row['id']]);
            return 'verification';
        }
        if ($status!=='quoted'||!$quote) return null;
        if ($action==='reject') return 'cancelled';
        if ($action==='revise') return 'revision';
        if ($action!=='accept'||(int)($post['quote_version']??0)!==(int)$quote['version']||strtotime($quote['valid_until'].' UTC')<time()) return null;
        $method=self::text($post['method']??'',24);
        if (!in_array($method,$s['methods'],true)) throw new RuntimeException('Etkin bir ödeme yöntemi seçin.',422);
        $dest=$method==='iban'?$this->encode(['iban'=>$s['iban'],'bank'=>$s['bank'],'holder'=>$s['holder']]):null;
        $this->web->query('INSERT INTO clinic_visit_payment(visit_id,quote_version,method,status,total,destination) VALUES(?,?,?,?,?,?)',
            [$row['id'],$quote['version'],$method,$method==='iban'?'pending':'onsite',$quote['total'],$dest]);
        return $method==='iban'?'payment':'planning';
    }

    public function catalogProducts(array $row): array
    {
        $state=$this->workspace($row['partner_id'])['state'];
        $branch=ClinicAccess::branch($state,$row['branch_id']);
        $branchId=($branch->sharedWith??'')?:$row['branch_id'];
        return array_filter(Finance::index($state->products??[]),static fn($product)=>$product->branch===$branchId && ($product->archived??'')!=='Evet');
    }

    private function quote(array $row,array $quotes,array $post,string $author): string
    {
        $visit=$this->decode($row['snapshot']);
        $details=['lines'=>[]];
        $products=$this->catalogProducts($row);
        $selected=is_array($post['product']??null)?$post['product']:[];
        $extras=is_array($post['extra_product']??null)?array_slice($post['extra_product'],0,3):[];
        $extraRates=is_array($post['extra_rate']??null)?$post['extra_rate']:[];
        $extraQty=is_array($post['extra_qty']??null)?$post['extra_qty']:[];
        $catalogLine=static function(string $id,array $products): array {
            if (!$id) return [];
            if (!isset($products[$id])) throw new RuntimeException('Seçilen ürün bu şubenin kataloğunda bulunamadı.',422);
            return ['product'=>$id,'vat'=>($products[$id]->vat??'')?:'0'];
        };
        $sum=0;
        foreach ($visit['services'] as $id=>$service) {
            $amount=self::settingsAmount(is_array($post['rates']??null)?$post['rates']:[],$id,$service['label']);
            $details['lines'][]=['label'=>$service['label'],'amount'=>$amount,'quantity'=>1]+$catalogLine(self::text($selected[$id]??'',80),$products);
            $sum+=$amount;
        }
        foreach ($extras as $i=>$product) {
            $id=self::text($product,80);
            if (!$id) continue;
            $line=$catalogLine($id,$products);
            $quantity=Finance::qty(self::text($extraQty[$i]??'1',9));
            $unit=self::settingsAmount($extraRates,(string)$i,'Katalog kalemi birim fiyatı');
            $amount=$unit*$quantity;
            if ($amount>1_000_000_000) throw new RuntimeException('Katalog kalemi tutarı çok yüksek.',422);
            $details['lines'][]=['label'=>$products[$id]->name,'amount'=>$amount,'quantity'=>$quantity,'unit'=>$unit]+$line;
            $sum+=$amount;
        }
        foreach (['travel'=>'Ulaşım','transfer'=>'Nakil','extras'=>'Ek hizmet','discount'=>'İndirim','tax'=>'Vergi'] as $key=>$label) $details[$key]=self::settingsAmount($post,$key,$label);
        $details['subtotal']=$sum+$details['travel']+$details['transfer']+$details['extras'];
        $total=$details['subtotal']-$details['discount']+$details['tax'];
        if ($details['discount']>$details['subtotal'] || $total<=0 || $total>1_000_000_000) throw new RuntimeException('Teklif toplamı ve indirimi kontrol edin.',422);
        $details['note']=self::text($post['quote_note']??'',1000);
        $days=(int)($post['valid_days']??0);
        if ($days<1||$days>30) throw new RuntimeException('Teklif geçerliliği 1–30 gün olmalıdır.',422);
        $this->web->query('INSERT INTO clinic_visit_quote(visit_id,version,details,total,valid_until,created_by) VALUES(?,?,?,?,?,?)',
            [$row['id'],($quotes[0]['version']??0)+1,WebBuilder::json($details),$total,gmdate('Y-m-d H:i:s',time()+86400*$days),$author]);
        return 'quoted';
    }

    private function assign(array $row,array $settings,array $post,array $actor): string
    {
        $visit=$this->decode($row['snapshot']);
        $roster=array_column($this->schedulableStaff($row['partner_id'],$row['branch_id'],$settings),null,'id');
        $clinician=self::text($post['clinician']??'',80,true);
        $assistant=self::text($post['assistant']??'',80);
        $vehicle=self::text($post['vehicle']??'',80);
        if (!isset($roster[$clinician])) throw new RuntimeException('Sorumluyu bu şubenin yetkili saha ekibinden seçin.',422);
        if ($assistant!==''&&!isset($roster[$assistant])) throw new RuntimeException('Yardımcı personeli bu şubenin yetkili saha ekibinden seçin.',422);
        if ($assistant!==''&&$roster[$assistant]['account_id']===$roster[$clinician]['account_id']) throw new RuntimeException('Sorumlu ve yardımcı aynı kişi olamaz. Yardımcıyı boş bırakabilir veya farklı bir kişi seçebilirsiniz.',422);
        if ($vehicle!==''&&!in_array($vehicle,$settings['vehicles'],true)) throw new RuntimeException('Araç listesi değişmiş. Kayıtlı bir araç seçin veya araçsız planlayın.',422);
        $starts=self::time(self::text($post['slot_date']??'',10,true),self::text($post['slot_time']??'',5,true));
        $minutes=(int)($post['minutes']??0);
        if ($starts<new DateTimeImmutable('now')||$minutes<5||$minutes>480) throw new RuntimeException('Planlanan saat veya süre geçersiz.',422);
        $ends=$starts->modify("+$minutes minutes");
        if ($starts->format('Y-m-d')!==$ends->format('Y-m-d')) throw new RuntimeException('Ziyaret aynı gün içinde bitmelidir.',422);
        $slot=['starts'=>$starts->format('Y-m-d H:i:s'),'ends'=>$ends->format('Y-m-d H:i:s'),'clinician'=>$clinician,
            'assistant'=>$assistant,'vehicle'=>$vehicle];
        $taken=$this->web->query("SELECT clinician,assistant,vehicle FROM clinic_visit_slot WHERE partner_id=? AND visit_id<>?
            AND released=0 AND starts<? AND ends>?",[$row['partner_id'],$row['id'],$slot['ends'],$slot['starts']])->fetchAll();
        foreach ($taken as $other) {
            if ($vehicle!==''&&$vehicle===$other['vehicle']) throw new RuntimeException('Bu araç aynı saatte başka bir ziyarete atanmış.',409);
            if (array_intersect(array_filter([$clinician,$assistant]),[$other['clinician'],$other['assistant']])) throw new RuntimeException('Ekipten bir kişi aynı saatte başka bir ziyarete atanmış.',409);
        }
        $accounts=[$roster[$clinician]['account_id']];
        if ($assistant!=='') $accounts[]=$roster[$assistant]['account_id'];
        (new StaffPlan($this->db))->checkVisit($row['partner_id'],$accounts,$slot['starts'],$slot['ends']);
        $this->calendar($row,$slot,'Onaylandı',$roster);
        $this->web->query('INSERT INTO clinic_visit_slot(visit_id,partner_id,clinician,assistant,vehicle,starts,ends) VALUES(?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE clinician=VALUES(clinician),assistant=VALUES(assistant),vehicle=VALUES(vehicle),starts=VALUES(starts),ends=VALUES(ends),released=0',
            [$row['id'],$row['partner_id'],$clinician,$assistant,$vehicle,$slot['starts'],$slot['ends']]);
        return 'assigned';
    }

    private function calendar(array $row,array $slot,string $status,array $roster=[]): void
    {
        $data=$this->workspace($row['partner_id']); $state=$data['state'];
        $branch=ClinicAccess::branch($state,$row['branch_id']);
        $id='visit-'.$row['id'];
        $record=(object)['id'=>$id,'branch'=>($branch->sharedWith??'')?:$row['branch_id'],
            'date'=>substr($slot['starts'],0,10),'time'=>substr($slot['starts'],11,5),'endTime'=>substr($slot['ends'],11,5),'status'=>$status,
            'service'=>'Evde Hizmet','client'=>$row['customer_id'],'patient'=>$row['patient_id'],
            'clinician'=>$roster[$slot['clinician']]['name']??'','notes'=>'Evde hizmet başvurusu: '.$row['id']];
        $original=clone $state;
        $items=array_column($state->appointments??[],null,'id');
        if ($status==='Onaylandı') {
            foreach ($items as $other) {
                if (WebBooking::overlap($record,$other)) throw new RuntimeException('Mevcut klinik takviminde saat çakışması var.',409);
            }
        }
        if (isset($items[$id])) {
            $record->clinician=$record->clinician?:($items[$id]->clinician??'');
            $record->createdAt=$items[$id]->createdAt??gmdate('c');
        } else $record->createdAt=gmdate('c');
        $record->createdBy='Evde Hizmet';
        $items[$id]=$record;
        $state->appointments=array_values($items);
        if (!$this->workspaces->save('partner:'.$row['partner_id'],$data['revision'],$state,$original)) throw new RuntimeException('Takvim güncellendi. Tekrar deneyin.',409);
    }

    private function clinicalRecord(array $row,array $actor,array $post): array
    {
        $data=$this->workspace($row['partner_id']); $state=$data['state'];
        $branch=ClinicAccess::branch($state,$row['branch_id']);
        $branchId=($branch->sharedWith??'')?:$row['branch_id'];
        $clinicalId=self::text($post['clinical_record']??'',80);
        $catalogId=self::text($post['clinical_service']??'',80);
        $old=clone $state;
        $created=false;
        if ($catalogId) {
            if ($clinicalId) throw new RuntimeException('Var olan işlemi bağlayın ya da katalogdan yeni işlem oluşturun.',422);
            if (!ClinicAccess::allowed($actor,'treatments',true)) throw new RuntimeException('Hasta işlemi ekleme yetkisi gerekli.',403);
            if (($post['procedure_done']??'')!=='yes') throw new RuntimeException('Hizmetin uygulandığını onaylayın.',422);
            $product=$this->catalogProducts($row)[$catalogId]??null;
            if (!$product||$product->category!=='Hizmet') throw new RuntimeException('Şubenin hizmet kataloğundan işlem seçin.',422);
            $usedService=$this->web->query("SELECT detail FROM clinic_visit_event WHERE visit_id=? AND action='record'",[$row['id']])->fetchAll(PDO::FETCH_COLUMN);
            foreach ($usedService as $previous) if (($this->decode($previous)['service']??'')===$catalogId) {
                throw new RuntimeException('Bu katalog hizmeti zaten ziyarete bağlandı.',409);
            }
            $clinicalId=bin2hex(random_bytes(16));
            $state->treatments[]=(object)['id'=>$clinicalId,'branch'=>$branchId,'patient'=>$row['patient_id'],'date'=>WebBuilder::today(),
                'title'=>$product->name,'clinician'=>$actor['name']??'','status'=>'Tamamlandı',
                'plan'=>self::text($post['procedure_note']??'',1000),'createdAt'=>gmdate('c'),'createdBy'=>$actor['account_id']];
            $created=true;
        }
        $treatment=array_column($state->treatments??[],null,'id')[$clinicalId]??null;
        if (!ClinicAccess::allowed($actor,'treatments')||!$treatment||($treatment->status??'')!=='Tamamlandı'||$treatment->patient!==$row['patient_id']||$treatment->branch!==$branchId) {
            throw new RuntimeException('Bu hastaya ait tamamlanmış gerçek işlemi seçin.',422);
        }
        $used=$this->web->query("SELECT detail FROM clinic_visit_event WHERE visit_id=? AND action='record'",[$row['id']])->fetchAll(PDO::FETCH_COLUMN);
        foreach ($used as $event) if ($this->decode($event)['treatment']===$clinicalId) {
            throw new RuntimeException('Bu işlem daha önce ziyarete bağlanmış.',409);
        }
        $lotId=self::text($post['lot']??'',80);
        $detail=['treatment'=>$clinicalId]+($created?['service'=>$catalogId]:[]);
        if ($lotId==='') {
            if ($created && !$this->workspaces->save('partner:'.$row['partner_id'],$data['revision'],$state)) throw new RuntimeException('Kayıt değişti. Tekrar deneyin.',409);
            return $detail;
        }
        if (!ClinicAccess::allowed($actor,'products',true)) throw new RuntimeException('Stok çıkışı yetkisi gerekli.',403);
        $qty=Finance::qty(self::text($post['quantity']??'',12,true));
        $lots=array_column($state->stockLots??[],null,'id');
        $lot=$lots[$lotId]??null;
        $product=$lot?array_column($state->products??[],null,'id')[$lot->product]??null:null;
        $today=WebBuilder::today();
        [$quotes,$payment]=$this->details($row['id']);
        if ($product && $payment) {
            foreach ($quotes as $quote) if ($quote['version']===$payment['quote_version'] && in_array($product->id,
                array_column(WebBuilder::decode($quote['details'])['lines'],'product'),true)) {
                throw new RuntimeException('Bu ürün teklif satırında yer alıyor ve stok çıkışı tahsilatla işlenecek veya işlendi.',422);
            }
        }
        if (!$lot||!$product||$lot->branch!==$branchId||$product->branch!==$branchId||$qty>(int)$lot->remaining||
            $qty>(int)$product->stock||(!empty($lot->expiry)&&$lot->expiry<$today)) {
            throw new RuntimeException('Parti ve kullanılabilir stok miktarını kontrol edin.',422);
        }
        $old=clone $state;
        $old->stockLots=array_map(static fn($record)=>clone $record,$state->stockLots);
        $old->products=array_map(static fn($record)=>clone $record,$state->products);
        $lot->remaining=(string)((int)$lot->remaining-$qty);
        $product->stock=(string)((int)$product->stock-$qty);
        $move=bin2hex(random_bytes(16));
        $state->stockMoves[]=(object)['id'=>$move,'branch'=>$branchId,'product'=>$product->id,'lot'=>$lotId,
            'date'=>$today,'delta'=>(string)-$qty,'reason'=>'Evde Hizmet '.$row['id'],'source'=>'Evde Hizmet','balance'=>$lot->remaining];
        Finance::validate($old,$state);
        if (!$this->workspaces->save('partner:'.$row['partner_id'],$data['revision'],$state)) throw new RuntimeException('Stok güncellendi. Tekrar deneyin.',409);
        return $detail+['movement'=>$move];
    }

    private function collect(array $row,array $payment,array $actor,array $post): string
    {
        if ($payment['status']==='pending' && ($post['bank_confirm']??'')!=='yes') {
            throw new RuntimeException('Havalenin banka hesabına geçtiğini doğrulayın.',422);
        }
        if ($payment['status']==='onsite' && !in_array($row['status'],['completed','started'],true)) {
            throw new RuntimeException('Ödeme doğrulaması hizmet sırasında veya sonrasında yapılabilir.',422);
        }
        $data=$this->workspace($row['partner_id']); $state=$data['state'];
        $branch=ClinicAccess::branch($state,$row['branch_id']);
        $method=match($payment['method']){'iban'=>'Havale','terminal'=>'Kart','cash'=>'Nakit',default=>self::text($post['cash_method']??'',20,true)};
        if (!in_array($method,['Nakit','Kart','Havale'],true)) throw new RuntimeException('Gerçek tahsilat yöntemini seçin.',422);
        $old=unserialize(serialize($state),['allowed_classes'=>[\stdClass::class]]);
        $id='visit-'.$row['id'];
        $branchId=($branch->sharedWith??'')?:$row['branch_id'];
        $snapshot=$this->decode($row['snapshot']);
        if ($row['customer_id']!=='' || $row['patient_id']!=='') {
            $client=Finance::index($state->clients)[$row['customer_id']]??null;
            $patient=Finance::index($state->patients)[$row['patient_id']]??null;
            if (!$client||!$patient||$client->branch!==$branchId||$patient->branch!==$branchId||$patient->owner!==$client->id) {
                throw new RuntimeException('Hasta ve müşteri bağlantısı doğrulanamadı.',422);
            }
        }
        $quote=$this->web->query('SELECT details FROM clinic_visit_quote WHERE visit_id=? AND version=?',[$row['id'],$payment['quote_version']])->fetchColumn();
        $bill=WebBuilder::decode($quote);
        $products=Finance::index($state->products);
        $lines=[];$allocations=[];$date=WebBuilder::today();
        foreach (['travel'=>'Ulaşım','transfer'=>'Nakil','extras'=>'Ek hizmet','tax'=>'Teklifte belirtilen ek vergi'] as $key=>$label) {
            if (!empty($bill[$key])) $bill['lines'][]=['label'=>$label,'amount'=>$bill[$key]];
        }
        foreach ($bill['lines'] as $line) {
            $productId=$line['product']??'';
            $product=$products[$productId]??null;
            if ($productId && (!$product||$product->branch!==$branchId)) throw new RuntimeException('Teklifteki katalog ürünü artık bu şubede bulunmuyor.',422);
            $tracked=$product && $product->category!=='Hizmet' && ($product->track??'')!=='Hayır';
            $qty=$line['quantity']??1;
            $lines[]=['product'=>$productId,'name'=>$line['label'],'quantity'=>(string)$qty,'price'=>self::decimal($line['unit']??$line['amount']),
                'vat'=>$line['vat']??'0','taxMode'=>'KDV Dahil','discountAmount'=>'0','stock'=>$tracked?'Evet':'Hayır'];
            if (!$tracked) continue;
            if (!ClinicAccess::allowed($actor,'products',true)) throw new RuntimeException('Stok takibi olan ürünün tahsilatı için stok düzenleme izni gerekli.',403);
            foreach ($state->stockMoves as $movement) {
                if ($movement->reason==='Evde Hizmet '.$row['id'] && $movement->product===$productId) {
                    throw new RuntimeException('Bu ürün daha önce bu ziyaretin hasta işlemi üzerinden stoktan çıkarılmış. Muhasebe kaydını inceleyin.',422);
                }
            }
            $lots=array_values(array_filter($state->stockLots,static fn($lot)=>$lot->branch===$branchId && $lot->product===$productId &&
                (int)$lot->remaining>0 && (empty($lot->expiry)||$lot->expiry>=$date)));
            usort($lots,static fn($a,$b)=>(($a->expiry??'')?:'9999-12-31')<=>(($b->expiry??'')?:'9999-12-31'));
            $remaining=$qty;
            foreach ($lots as $lot) {
                $parts=min($remaining,(int)$lot->remaining);
                $lot->remaining=(string)((int)$lot->remaining-$parts);
                $allocations[]=[$lot->id,$productId,$parts];
                $state->stockMoves[]=(object)['id'=>bin2hex(random_bytes(16)),'branch'=>$branchId,'product'=>$productId,'lot'=>$lot->id,
                    'date'=>$date,'delta'=>(string)-$parts,'reason'=>'Evde Hizmet','source'=>'Satış','balance'=>$lot->remaining];
                if (!($remaining-=$parts)) break;
            }
            if ($remaining) throw new RuntimeException($product->name.' için yeterli uygun stok partisi yok. Ödeme kasaya işlenmedi.',422);
            $product->stock=(string)((int)$product->stock-$qty);
        }
        $amount=self::decimal((int)$payment['total']);
        $state->sales[]=(object)['id'=>$id,'branch'=>$branchId,'date'=>$date,'detail'=>'Evde Hizmet · '.$snapshot['animal'],
            'client'=>$row['customer_id'],'patient'=>$row['patient_id'],'items'=>WebBuilder::json($lines),'stockAllocations'=>WebBuilder::json($allocations),
            'amount'=>$amount,'discount'=>self::decimal((int)$bill['discount']),'discountType'=>'GenelToplamTL','paid'=>'0','method'=>$method,
            'publicNotes'=>'Evde Hizmet · '.$row['id'],'visitId'=>$row['id']];
        $state->collections[]=(object)['id'=>$id,'branch'=>$branchId,'sale'=>$id,'date'=>$date,'amount'=>$amount,'method'=>$method,'notes'=>'Evde Hizmet tahsilatı'];
        Finance::validate($old,$state);
        if (!$this->workspaces->save('partner:'.$row['partner_id'],$data['revision'],$state)) throw new RuntimeException('Kasa güncellendi. Tekrar deneyin.',409);
        $this->web->query("UPDATE clinic_visit_payment SET status='paid',verified_at=UTC_TIMESTAMP(),verified_by=? WHERE visit_id=?",[$actor['account_id'],$row['id']]);
        return in_array($row['status'],['verification','payment'],true)?'planning':$row['status'];
    }
}
