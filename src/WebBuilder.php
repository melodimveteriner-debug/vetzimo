<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;
use RuntimeException;

final class WebBuilder
{
    public const THEMES = [
        'modern'=>['Modern Klinik','Fesleğen ve krem','Lacivert ve açık gri'],
        'premium'=>['Premium Veteriner','Koyu yeşil ve altın','Antrasit ve açık mavi'],
        'pati'=>['Pati Dostu','Mercan ve krem','Turkuaz ve pastel sarı'],
        'medikal'=>['Medikal Pro','Medikal mavi ve beyaz','Petrol yeşili ve açık gri'],
    ];
    public const PAGES = [
        ''=>'Ana Sayfa','hakkimizda'=>'Hakkımızda','ekibimiz'=>'Ekibimiz',
        'blog'=>'Blog','ailemiz'=>'Ailemiz','randevu'=>'Randevu Al','iletisim'=>'İletişim',
    ];
    public const SECTIONS = [
        'numbers'=>'Rakamlarla kliniğimiz','services'=>'Hizmetler','team'=>'Ekibimiz',
        'gallery'=>'Ailemiz','blog'=>'Son blog yazıları','contact'=>'Saatler ve iletişim',
    ];
    public const GALLERY_SPECIES=['Kedi','Köpek','Kuş','Diğer'];
    public static function gallerySpecies(array $row): string
    {
        $type=strtolower(strtr(trim($row['species']??''),['Ö'=>'ö','Ü'=>'ü','Ş'=>'ş','İ'=>'i']));
        return match($type) {'kedi'=>'Kedi','köpek','kopek'=>'Köpek','kuş','kus'=>'Kuş',default=>'Diğer'};
    }
    public const DAYS = [1=>'Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];

    public function __construct(private readonly PDO $db, private readonly array $config) {}

    private array $branchLists = [];

    public function query(string $sql, array $parameters=[]): \PDOStatement
    {
        $stmt=$this->db->prepare($sql);
        $stmt->execute($parameters);
        return $stmt;
    }
    public function transaction(callable $work): mixed
    {
        if ($this->db->inTransaction()) return $work();
        $this->db->beginTransaction();
        try {
            $result=$work();
            $this->db->commit();
            return $result;
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }
    public function quotaMb(string $partner): int
    {
        $plan=$this->plan($partner);
        $quota=$plan===null?false:$this->query('SELECT max_mb FROM clinic_web_storage WHERE plan_id=?',[$plan])->fetchColumn();
        if ($quota===false) $quota=$this->query('SELECT max_mb FROM clinic_web_storage WHERE plan_id=?',['_default'])->fetchColumn();
        return $quota===false?max(0,(int)floor(($this->config['webBuilderMediaBytes']??120000000)/1000000)):(int)$quota;
    }
    public function mediaBytes(string $partner): int
    {
        return (int)$this->query('SELECT COALESCE(SUM(byte_size),0) FROM clinic_web_media WHERE partner_id=?',[$partner])->fetchColumn();
    }
    private function checkQuota(string $partner,int $bytes,int $previous): void
    {
        $limit=$this->quotaMb($partner);
        if ($bytes>$limit*1000000 && $bytes>$previous) {
            throw new RuntimeException('Web sitesi depolama kotası '.$limit.' MB. Yer açmak için kullanılmayan görselleri silin veya paket kotasını artırın.',422);
        }
    }
    public static function json(array $data): string
    {
        return json_encode($data,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    }
    public static function decode(string $data): array
    {
        return json_decode($data,true,64,JSON_THROW_ON_ERROR);
    }
    public static function text(mixed $text,int $limit): string
    {
        if (!is_string($text) || strlen($text)>$limit || !preg_match('//u',$text)) {
            throw new RuntimeException('Bir alanın biçimi veya uzunluğu geçersiz.',422);
        }
        return trim($text);
    }
    public static function key(mixed $key): string
    {
        if (!is_string($key) || !preg_match('/\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/D',$key)) {
            throw new RuntimeException('Adres yalnızca küçük Latin harfleri, sayılar ve tire içerebilir.',422);
        }
        return $key;
    }
    public static function https(mixed $raw): string
    {
        $url=self::text($raw,2500);
        if ($url==='') return '';
        $parts=parse_url($url);
        if (!filter_var($url,FILTER_VALIDATE_URL) || ($parts['scheme']??'')!=='https' ||
            isset($parts['user']) || isset($parts['pass']) || !isset($parts['host'])) {
            throw new RuntimeException('Geçerli bir HTTPS bağlantısı girin.',422);
        }
        return $url;
    }
    public const MAP_HOSTS=['www.google.com','maps.google.com','www.google.com.tr','maps.google.com.tr'];

    public static function maps(mixed $raw): string
    {
        $url=self::text($raw,12000);
        if (str_starts_with($url,'<')) {
            if (!preg_match('~\A<iframe\b([^>]*)>\s*</iframe\s*>\z~isD',$url,$frame) ||
                !preg_match('~(?:^|\s)src\s*=\s*(["\x27])(https://[^"\x27<>]+)\1~i',$frame[1],$source)) {
                throw new RuntimeException('Google Haritalar’da Paylaş → Harita yerleştir → HTML’yi kopyala adımlarını izleyin.',422);
            }
            $url=html_entity_decode($source[2],ENT_QUOTES|ENT_HTML5,'UTF-8');
        }
        if ($url==='') return '';
        $parts=parse_url($url);
        if (!filter_var($url,FILTER_VALIDATE_URL) || ($parts['scheme']??'')!=='https' ||
            !in_array(strtolower($parts['host']??''),self::MAP_HOSTS,true) ||
            isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) ||
            !preg_match('~\A/maps/embed(?:/v1/(?:place|view|directions|search|streetview))?/?\z~D',$parts['path']??'')) {
            throw new RuntimeException('Google Haritalar’ın yerleştirme kodunu veya https://www.google.com/maps/embed bağlantısını kullanın.',422);
        }
        return $url;
    }

    public static function articleSlug(string $title,array $used): string
    {
        $text=strtolower(strtr($title,['ç'=>'c','Ç'=>'c','ğ'=>'g','Ğ'=>'g','ı'=>'i','İ'=>'i',
            'ö'=>'o','Ö'=>'o','ş'=>'s','Ş'=>'s','ü'=>'u','Ü'=>'u','â'=>'a','î'=>'i','û'=>'u']));
        $stem=trim(substr(trim(preg_replace('/[^a-z0-9]+/','-',$text),'-'),0,55),'-')?:'yazi';
        $slug=$stem;
        for ($suffix=2;isset($used[$slug]);$suffix++) $slug=$stem.'-'.$suffix;
        return $slug;
    }

    public static function blogCategories(array $draft): array
    {
        $names=array_values(array_unique(array_merge($draft['blogCategories']??[],
            array_filter(array_column($draft['blog']??[],'category'),static fn($name)=>$name!==''))));
        sort($names,SORT_NATURAL|SORT_FLAG_CASE);
        return $names;
    }

    public static function phone(string $value): string
    {
        if (!preg_match('/\A[+0-9 ().-]{10,30}\z/D',$value)) return '';
        $number=preg_replace('/\D/','',$value);
        if (strlen($number)===12 && str_starts_with($number,'90')) $number=substr($number,2);
        if (strlen($number)===11 && str_starts_with($number,'0')) $number=substr($number,1);
        return strlen($number)===10 ? '+90'.$number : '';
    }
    public function plan(string $partner): ?string
    {
        $day=self::today();
        $value=$this->query('SELECT plan_id FROM clinic_subscription WHERE partner_id=? AND starts_on<=? AND ends_on>=? ORDER BY starts_on DESC,id DESC LIMIT 1',[$partner,$day,$day])->fetchColumn();
        return $value===false?null:(string)$value;
    }
    public function allowed(array $actor): bool
    {
        if (($actor['role']??null)!=='dealer') return false;
        $plan=$this->plan($actor['partner_id']);
        $enabled=$this->query('SELECT enabled FROM clinic_web_package WHERE plan_id=?',[$plan??'_default'])->fetchColumn();
        if ($enabled===false && $plan!==null) $enabled=$this->query('SELECT enabled FROM clinic_web_package WHERE plan_id=?',['_default'])->fetchColumn();
        return $enabled===false || (int)$enabled===1;
    }
    public static function today(): string
    {
        return (new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
    }
    public function site(string $partner, bool $lock=false): ?array
    {
        $row=$this->query("SELECT s.*, c.status AS control_status FROM clinic_web_site s LEFT JOIN clinic_web_site_control c ON c.partner_id=s.partner_id
            WHERE s.partner_id=? AND (c.status IS NULL OR c.status='paused')".($lock?' FOR UPDATE':''),[$partner])->fetch();
        return $row?:null;
    }
    public function publicSite(string $value, bool $host=false): ?array
    {
        $where=$host?'s.custom_host=? AND s.domain_verified=1':'s.slug=?';
        $row=$this->query("SELECT s.partner_id,s.slug,s.custom_host,s.domain_verified,s.published,r.snapshot FROM clinic_web_site s JOIN partner_account a ON a.id=s.partner_id AND a.active=1
            JOIN clinic_web_release r ON r.id=s.published AND r.partner_id=s.partner_id WHERE NOT EXISTS (SELECT 1 FROM clinic_web_site_control c WHERE c.partner_id=s.partner_id) AND ".$where,[$value])->fetch();
        if (!$row || !$this->allowed(['role'=>'dealer','partner_id'=>$row['partner_id']])) return null;
        return $row;
    }
    public function base(array $row): string
    {
        $host=$row['custom_host']??'';
        if ($host && $row['domain_verified'] && $this->hostReady($host)) return 'https://'.$host;
        $zone=$this->config['webBuilderZone']??'';
        if ($zone && $this->hostReady($row['slug'].'.'.$zone)) return 'https://'.$row['slug'].'.'.$zone;
        return $this->standardUrl($row);
    }
    public function standardUrl(array $row): string
    {
        return $this->config['origin'].'/web/'.$row['slug'];
    }
    public function hostReady(string $host): bool
    {
        return self::acceptsHost($this->config,$host);
    }
    public static function acceptsHost(array $config,string $host): bool
    {
        $zone=$config['webBuilderZone']??'';
        return in_array($host,$config['webBuilderHttpsHosts']??[],true) ||
            ($zone && ($config['webBuilderWildcardHttps']??false) && str_ends_with($host,'.'.$zone) &&
                preg_match('/\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/D',substr($host,0,-strlen($zone)-1)));
    }
    public function create(array $actor,string $slug,array $identity): void
    {
        if (in_array($slug,['www','mail','api','admin','smtp','ftp','cpanel','webmail'],true)) throw new RuntimeException('Bu adres kullanılamaz.',422);
        $draft=['identity'=>$identity,'contact'=>[],'theme'=>'modern','palette'=>'a','content'=>[],
            'sections'=>array_values(array_diff(array_keys(self::SECTIONS),['numbers'])),'team'=>[],'gallery'=>[],'blog'=>[],'booking'=>[],'settings'=>[]];
        try {
            $this->transaction(function() use ($actor,$slug,$draft) {
                $partner=$actor['partner_id'];
                $status=$this->query('SELECT status FROM clinic_web_site_control WHERE partner_id=? FOR UPDATE',[$partner])->fetchColumn();
                $payload=self::json($draft);
                $this->checkQuota($partner,strlen($payload),0);
                $token=bin2hex(random_bytes(24));
                if ($status==='deleted') {
                    $this->query('UPDATE clinic_web_site SET slug=?,domain_token=?,draft=?,revision=revision+1 WHERE partner_id=?',[$slug,$token,$payload,$partner]);
                    $this->query('DELETE FROM clinic_web_site_control WHERE partner_id=?',[$partner]);
                } else {
                    $this->query('INSERT INTO clinic_web_site(partner_id,slug,domain_token,draft) VALUES (?,?,?,?)',[$partner,$slug,$token,$payload]);
                }
            });
        } catch(PDOException $e) {
            if ((int)($e->errorInfo[1]??0)===1062) throw new RuntimeException('Bu adres kullanılıyor veya bayinin sitesi zaten var.',409);
            throw $e;
        }
    }
    public function edit(array $row,array $draft,int $revision): void
    {
        $payload=self::json($draft);
        if (strlen($payload)>(int)($this->config['webBuilderDraftBytes']??6000000)) throw new RuntimeException('Site içerik depolama sınırına ulaşıldı.',422);
        $media=$this->mediaBytes($row['partner_id']);
        $this->checkQuota($row['partner_id'],$media+strlen($payload),$media+strlen($row['draft']));
        $changed=$this->query('UPDATE clinic_web_site SET draft=?,revision=revision+1 WHERE partner_id=? AND revision=?',
            [$payload,$row['partner_id'],$revision])->rowCount();
        if (!$changed) throw new RuntimeException('Taslak başka bir oturumda güncellendi. Sayfayı yenileyin.',409);
    }
    public function publish(array $row,int $revision): void
    {
        $this->transaction(function() use ($row,$revision) {
            $current=$this->site($row['partner_id'],true);
            if (!$current || (int)$current['revision']!==$revision) throw new RuntimeException('Önce en güncel taslağı açın.',409);
            $issues=self::publishIssues(self::decode($current['draft']));
            if ($issues) throw new RuntimeException(implode(' ',$issues),422);
            $this->query('INSERT INTO clinic_web_release(partner_id,snapshot) VALUES (?,?)',[$row['partner_id'],$current['draft']]);
            $this->query('UPDATE clinic_web_site SET published=?,revision=revision+1 WHERE partner_id=?',[$this->db->lastInsertId(),$row['partner_id']]);
            $keep=$this->query('SELECT id FROM clinic_web_release WHERE partner_id=? ORDER BY id DESC LIMIT 1 OFFSET 29',[$row['partner_id']])->fetchColumn();
            if ($keep!==false) $this->query('DELETE FROM clinic_web_release WHERE partner_id=? AND id<?',[$row['partner_id'],$keep]);
        });
    }
    public function moderate(array $row,string $action): void
    {
        $this->transaction(function() use ($row,$action) {
            $partner=$row['partner_id'];
            $current=$this->site($partner,true);
            if (!$current || $row['revision']!==$current['revision']) throw new RuntimeException('Site güncellendi. Yönetim sayfasını yenileyin.',409);
            if ($action==='resume') {
                $this->query("DELETE FROM clinic_web_site_control WHERE partner_id=? AND status='paused'",[$partner]);
            } else {
                $status=$action==='delete'?'deleted':'paused';
                $this->query('INSERT INTO clinic_web_site_control(partner_id,status) VALUES (?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)',[$partner,$status]);
                if ($action==='delete') {
                    $this->query("UPDATE clinic_web_site SET slug=?,custom_host=NULL,domain_verified=0,draft='{}',published=NULL WHERE partner_id=?",
                        ['deleted-'.bin2hex(random_bytes(24)),$partner]);
                    foreach (['clinic_web_release','clinic_web_media','clinic_web_daily'] as $table) {
                        $this->query('DELETE FROM '.$table.' WHERE partner_id=?',[$partner]);
                    }
                }
            }
            $this->query('UPDATE clinic_web_site SET revision=revision+1 WHERE partner_id=?',[$partner]);
        });
    }
    public function deleteMedia(string $partner,array $ids,array $draft): void
    {
        $removed=array_diff(array_unique($ids),self::mediaIds($draft));
        if (!$removed) return;
        $releases=$this->query('SELECT id,snapshot FROM clinic_web_release WHERE partner_id=?',[$partner])->fetchAll();
        foreach ($releases as $release) {
            $snapshot=self::decode($release['snapshot']);
            if (!array_intersect($removed,self::mediaIds($snapshot))) continue;
            $snapshot=self::stripMedia($snapshot,$removed);
            $this->query('UPDATE clinic_web_release SET snapshot=? WHERE partner_id=? AND id=?',[self::json($snapshot),$partner,$release['id']]);
        }
        foreach ($removed as $id) $this->query('DELETE FROM clinic_web_media WHERE partner_id=? AND id=?',[$partner,$id]);
    }
    public static function stripMedia(array $draft,array $ids): array
    {
        $scrub=static function(&$value,$key) use($ids) {
            if (in_array($key,['image','logo','favicon'],true) && in_array($value,$ids,true)) $value='';
        };
        foreach (['contact','content','team','gallery','blog'] as $group) {
            if (isset($draft[$group])) array_walk_recursive($draft[$group],$scrub);
        }
        return $draft;
    }
    public static function publishIssues(array $draft): array
    {
        $issues=[];
        if (($draft['identity']['name']??'')==='') $issues[]='Kimlik adımında klinik adınızı girin.';
        if (!empty($draft['booking']['enabled']) && (empty($draft['booking']['branches']) || empty($draft['booking']['privacy']))) $issues[]='Randevu için şube ve aydınlatma metni gerekli.';
        return $issues;
    }
    public function release(array $row,?int $id,int $revision): void
    {
        if ($id!==null && !$this->query('SELECT id FROM clinic_web_release WHERE partner_id=? AND id=?',[$row['partner_id'],$id])->fetchColumn()) throw new RuntimeException('Sürüm bulunamadı.',404);
        if (!$this->query('UPDATE clinic_web_site SET published=?,revision=revision+1 WHERE partner_id=? AND revision=?',[$id,$row['partner_id'],$revision])->rowCount()) throw new RuntimeException('Sayfayı yenileyin.',409);
    }
    public function workspace(string $partner): ?object
    {
        return (new WorkspaceRepository($this->db))->load('partner:'.$partner)['state'];
    }
    public function partnerName(string $partner): string
    {
        return (string)$this->query('SELECT name FROM partner_account WHERE id=?',[$partner])->fetchColumn();
    }
    public function branches(string $partner): array
    {
        return $this->branchLists[$partner] ??= array_values(array_filter(
            (new WorkspaceRepository($this->db))->branches('partner:'.$partner),
            static fn($row)=>($row->status??'')!=='Pasif'
        ));
    }
    public const NUMBERS=['patients'=>'Kayıtlı hasta','team'=>'Ekip üyesi','services'=>'Hizmet','custom'=>'Klinik bilgisi'];

    public function clinicNumbers(string $partner,array $draft): array
    {
        return [
            'patients'=>(new WorkspaceRepository($this->db))->patientCount('partner:'.$partner),
            'team'=>count(array_filter($draft['team']??[],static fn($row)=>!empty($row['visible']))),
            'services'=>count(preg_split('/\R/',trim($draft['content']['hakkimizda']['services']??''),-1,PREG_SPLIT_NO_EMPTY)),
            'custom'=>null,
        ];
    }

    public function roster(string $partner,string $branch): array
    {
        return array_column($this->query("SELECT m.id,m.name FROM identity_membership m JOIN identity_account a ON a.id=m.account_id
            WHERE m.partner_id=? AND m.status='active' AND a.blocked=0 AND
              (m.role='dealer' OR (m.branch_id=? AND m.role IN ('branch','staff'))) ORDER BY m.name,m.id",[$partner,$branch])->fetchAll(),'name','id');
    }
    public function domain(array $row,string $host): void
    {
        if ($host!=='' && (!preg_match('/\A(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\z/D',$host) || strlen($host)>253 ||
            $host===parse_url($this->config['origin'],PHP_URL_HOST))) throw new RuntimeException('Geçerli bir özel alan adı girin.',422);
        $token=$row['custom_host']===$host?$row['domain_token']:bin2hex(random_bytes(24));
        try {
            $this->query('UPDATE clinic_web_site SET custom_host=?,domain_token=?,domain_verified=0 WHERE partner_id=?',[$host?:null,$token,$row['partner_id']]);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1]??0)===1062) throw new RuntimeException('Alan adı kullanılıyor.',409);
            throw $e;
        }
    }
    public function verifyDomain(array $row): void
    {
        $host=$row['custom_host']??'';
        if (!$host || !$this->hostReady($host)) throw new RuntimeException('Önce hosting üzerinde alan adı ve HTTPS sertifikası tanımlanmalıdır.',422);
        $records=dns_get_record('_vetnet.'.$host,DNS_TXT);
        if (!in_array('vetnet='.$row['domain_token'],array_column($records?:[],'txt'),true)) throw new RuntimeException('DNS doğrulama kaydı bulunamadı.',422);
        $ip=gethostbyname($host);
        if (!function_exists('curl_init') || !filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4|FILTER_FLAG_GLOBAL_RANGE)) {
            throw new RuntimeException('Sertifika kontrolü için herkese açık IPv4 ve PHP cURL gerekir.',422);
        }
        $curl=curl_init('https://'.$host.'/');
        try {
            curl_setopt_array($curl,[CURLOPT_CONNECT_ONLY=>true,CURLOPT_RESOLVE=>[$host.':443:'.$ip],
                CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>6,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_PROXY=>'']);
            if (curl_exec($curl)===false) throw new RuntimeException('Alan adının HTTPS sertifikası doğrulanamadı.',422);
        } finally {
            unset($curl); // curl_close PHP 8.5 itibarıyla kullanımdan kalktı
        }
        $this->query('UPDATE clinic_web_site SET domain_verified=1 WHERE partner_id=? AND custom_host=? AND domain_token=?',[$row['partner_id'],$host,$row['domain_token']]);
    }
    public function stat(string $partner,string $metric): void
    {
        $this->query('INSERT INTO clinic_web_daily(partner_id,day,metric,n) VALUES (?,?,?,1)
            ON DUPLICATE KEY UPDATE n=n+1',[$partner,self::today(),$metric]);
    }
    public function articleViews(string $partner,array $ids): array
    {
        if (!$ids) return [];
        $metrics=array_map(static fn($id)=>'article:'.$id,$ids);
        $placeholders=implode(',',array_fill(0,count($metrics),'?'));
        $counts=[];
        foreach ($this->query("SELECT metric,SUM(n) AS views FROM clinic_web_daily
            WHERE partner_id=? AND metric IN ($placeholders) GROUP BY metric",[$partner,...$metrics])->fetchAll() as $row) {
            $counts[substr($row['metric'],8)]=(int)$row['views'];
        }
        return $counts;
    }

    public function upload(array $row,array $file): string
    {
        if (($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK || ($file['size']??0)>6500000 || !is_uploaded_file($file['tmp_name'])) {
            throw new RuntimeException('En fazla 6,5 MB boyutunda bir görsel seçin.',422);
        }
        if (!function_exists('imagewebp')) throw new RuntimeException('PHP GD ve WebP desteği etkinleştirilmelidir.',503);
        $size=@getimagesize($file['tmp_name']);
        if (!$size || !in_array($size['mime'],['image/jpeg','image/png','image/webp','image/avif'],true) || $size[0]*$size[1]>16000000) {
            throw new RuntimeException('JPEG, PNG, WebP veya AVIF görseli seçin (en fazla 16 MP).',422);
        }
        $image=@imagecreatefromstring(file_get_contents($file['tmp_name']));
        if (!$image) throw new RuntimeException('Görsel açılamadı.',422);
        if (max($size[0],$size[1])>1600) {
            $scaled=imagescale($image,max(1,(int)round($size[0]*1600/max($size[0],$size[1]))));
            if (!$scaled) throw new RuntimeException('Görsel boyutlandırılamadı.',422);
            $image=$scaled;
        }
        imagepalettetotruecolor($image);
        imagesavealpha($image,true);
        ob_start();
        $encoded=imagewebp($image,null,83);
        $bytes=ob_get_clean();
        if (!$encoded || !$bytes) throw new RuntimeException('Görsel kaydedilemedi.',422);
        $id=bin2hex(random_bytes(16));
        return $this->transaction(function() use ($row,$id,$bytes) {
            $current=$this->site($row['partner_id'],true);
            if (!$current || $current['revision']!==$row['revision']) throw new RuntimeException('Taslağı yenileyip görseli yeniden seçin.',409);
            $used=$this->mediaBytes($row['partner_id'])+strlen($current['draft']);
            $this->checkQuota($row['partner_id'],$used+strlen($bytes),$used);
            $this->query('INSERT INTO clinic_web_media(partner_id,id,bytes) VALUES (?,?,?)',[$row['partner_id'],$id,$bytes]);
            return $id;
        });
    }
    public static function mediaIds(array $draft): array
    {
        $ids=[];
        foreach (['contact','content','team','gallery','blog'] as $group) {
            $entries=$draft[$group]??[];
            array_walk_recursive($entries,static function($value,$key) use (&$ids) {
                if (in_array($key,['image','logo','favicon'],true) && is_string($value) && preg_match('/\A[a-f0-9]{32}\z/D',$value)) $ids[]=$value;
            });
        }
        return $ids;
    }
}
