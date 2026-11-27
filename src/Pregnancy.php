<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

/**
 * Gebelik / doğum takip cetveli. Çiftleşme tarihinden kedi ve köpek için bilimsel ortalama gebelik süresiyle
 * 30. gün ultrason, 45. gün röntgen (yavru sayısı, normal doğum / sezaryen kararı) ve tahmini doğum tarihi hesaplanır.
 * Kayıtlar klinikten veya hasta sahibi panelinden girilir; doğumdan (ya da takibin bitirilmesinden) 30 gün sonra otomatik silinir.
 */
final class Pregnancy
{
    /** Ortalama gebelik süresi (gün) ve normal kabul edilen aralık. Köpek 58–68 (ort. 63), kedi 61–69 (ort. 65). */
    public const GESTATION = ['Köpek'=>[63,58,68],'Kedi'=>[65,61,69]];
    public const KEEP_DAYS = 30;
    public const CHECKS = ['us','xray'];
    public const PHOTOS = ['family','us','xray'];
    private const PHOTO_MAX = 2_100_000; // base64 (≈1,5 MB görüntü)

    private static function checks(?string $json): array
    {
        $v=$json?json_decode($json,true):null;
        return is_array($v)?array_intersect_key($v,array_flip(self::CHECKS)):[];
    }

    /** Tek bir anı fotoğrafının görüntüsü (data URL); yoksa null. */
    public function photo(string $partner,string $patient,string $kind): ?string
    {
        if (!in_array($kind,self::PHOTOS,true)) throw new RuntimeException('Fotoğraf türü geçersiz.',422);
        if (!($this->forPatients($partner,[$patient])[$patient] ?? null)) return null;
        $q=$this->db->prepare('SELECT image FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id=? AND kind=?');
        $q->execute([$partner,$patient,$kind]);
        $v=$q->fetchColumn();
        return is_string($v)&&$v!==''?$v:null;
    }

    public function __construct(private readonly PDO $db) {}

    public function ensure(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_pregnancy (
            partner_id VARCHAR(80) NOT NULL, patient_id VARCHAR(80) NOT NULL, species VARCHAR(20) NOT NULL,
            mating DATE NOT NULL, ended DATE NULL, source VARCHAR(12) NOT NULL DEFAULT \'clinic\', author VARCHAR(120) NOT NULL DEFAULT \'\',
            updated_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,patient_id), KEY mating_idx (mating)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $have=array_column($this->db->query('SHOW COLUMNS FROM clinic_pregnancy')->fetchAll(PDO::FETCH_ASSOC),'Field');
        foreach (['litter'=>'TINYINT UNSIGNED NULL','healthy'=>'TINYINT UNSIGNED NULL','ended_by'=>'VARCHAR(12) NULL','ended_author'=>'VARCHAR(120) NULL','pet_name'=>"VARCHAR(120) NOT NULL DEFAULT ''",'expected'=>'TINYINT UNSIGNED NULL','checks'=>'TEXT NULL'] as $col=>$type)
            if (!in_array($col,$have,true)) $this->db->exec('ALTER TABLE clinic_pregnancy ADD COLUMN '.$col.' '.$type);
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_pregnancy_photo (
            partner_id VARCHAR(80) NOT NULL, patient_id VARCHAR(80) NOT NULL, kind VARCHAR(8) NOT NULL, image MEDIUMTEXT NULL, note VARCHAR(500) NOT NULL DEFAULT \'\',
            updated_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,patient_id,kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_pregnancy_call (
            partner_id VARCHAR(80) NOT NULL, patient_id VARCHAR(80) NOT NULL, mating DATE NOT NULL, milestone VARCHAR(12) NOT NULL,
            called_by VARCHAR(120) NOT NULL, called_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,patient_id,mating,milestone)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    public static function today(): string
    {
        return (new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
    }

    private static function add(string $date,int $days): string
    {
        return (new DateTimeImmutable($date))->modify(($days>=0?'+':'').$days.' days')->format('Y-m-d');
    }

    /** Cetvelin tüm tarihleri. */
    public static function plan(string $mating,string $species): array
    {
        [$avg,$min,$max]=self::GESTATION[$species] ?? self::GESTATION['Köpek'];
        $birth=self::add($mating,$avg);
        $parasite=[];
        for ($d=30;$d<$avg;$d+=30) $parasite[]=self::add($mating,$d);
        return ['mating'=>$mating,'species'=>$species,'days'=>$avg,'us'=>self::add($mating,30),'xray'=>self::add($mating,45),
            'birth'=>$birth,'control'=>self::add($birth,7),'vaccineFrom'=>self::add($birth,40),'birthMin'=>self::add($mating,$min),'birthMax'=>self::add($mating,$max),'parasite'=>$parasite,
            'hideAfter'=>self::add(self::add($mating,$max),self::KEEP_DAYS)];
    }

    private static function date(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/',$value)) throw new RuntimeException('Tarihi GG.AA.YYYY olarak seçin.',422);
        $d=DateTimeImmutable::createFromFormat('!Y-m-d',$value);
        if (!$d || $d->format('Y-m-d')!==$value) throw new RuntimeException('Tarih geçersiz.',422);
        return $value;
    }

    private static function row(array $r): array
    {
        $plan=self::plan($r['mating'],$r['species']);
        return ['patient'=>$r['patient_id'],'ended'=>$r['ended'],'litter'=>isset($r['litter'])?(int)$r['litter']:null,'healthy'=>isset($r['healthy'])?(int)$r['healthy']:null,'expected'=>isset($r['expected'])?(int)$r['expected']:null,'checks'=>self::checks($r['checks'] ?? null),'photos'=>[],
            'endedBy'=>$r['ended_by']??null,'endedAuthor'=>$r['ended_author']??null,'name'=>$r['pet_name']??'','source'=>$r['source'],'author'=>$r['author']]+$plan;
    }

    /** Etkin (ve doğumdan sonra 30 günü geçmemiş) kayıtlar. $ids null ise bayinin tümü. Süresi geçenler silinir. */
    public function forPatients(string $partner,?array $ids=null): array
    {
        try {
            if ($ids!==null) {
                $ids=array_values(array_filter($ids,static fn($id)=>is_string($id)&&$id!==''));
                if (!$ids) return [];
                $q=$this->db->prepare('SELECT * FROM clinic_pregnancy WHERE partner_id=? AND patient_id IN ('.implode(',',array_fill(0,count($ids),'?')).')');
                $q->execute([$partner,...$ids]);
            } else {
                $q=$this->db->prepare('SELECT * FROM clinic_pregnancy WHERE partner_id=?');
                $q->execute([$partner]);
            }
            $rows=$q->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException $e) {
            if ($e->getCode()==='42S02') return [];
            throw $e;
        }
        $today=self::today();$out=[];$expired=[];
        foreach ($rows as $r) {
            $item=self::row($r);
            $until=$r['ended']?self::add($r['ended'],self::KEEP_DAYS):$item['hideAfter'];
            if ($until<$today) {$expired[]=$r['patient_id'];continue;}
            $out[$r['patient_id']]=$item;
        }
        if ($expired) {
            $in=implode(',',array_fill(0,count($expired),'?'));
            $this->db->prepare('DELETE FROM clinic_pregnancy WHERE partner_id=? AND patient_id IN ('.$in.')')->execute([$partner,...$expired]);
            try { $this->db->prepare('DELETE FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id IN ('.$in.')')->execute([$partner,...$expired]); } catch (\PDOException) {}
        }
        if ($out) {
            try {
                $q=$this->db->prepare('SELECT patient_id,kind,note,updated_at,image IS NOT NULL AS has_image FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id IN ('.implode(',',array_fill(0,count($out),'?')).')');
                $q->execute([$partner,...array_keys($out)]);
                foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $ph) $out[$ph['patient_id']]['photos'][$ph['kind']]=['note'=>$ph['note'],'image'=>(bool)$ph['has_image'],'v'=>(int)$ph['updated_at']];
            } catch (\PDOException $e) { if ($e->getCode()!=='42S02') throw $e; }
        }
        return $out;
    }

    /** Klinik veya hasta sahibi kaydı. $body: {patient, mating} | {patient, action:'end'|'clear'} */
    public function save(string $partner,string $patient,string $species,object $body,string $source,string $author,int $now): array
    {
        if (!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/',$patient)) throw new RuntimeException('Hasta geçersiz.',422);
        if (!isset(self::GESTATION[$species])) throw new RuntimeException('Doğum takibi kedi ve köpekler için kullanılabilir.',422);
        $this->ensure();
        $action=(string)($body->action ?? '');
        if ($action==='clear') {
            $this->db->prepare('DELETE FROM clinic_pregnancy WHERE partner_id=? AND patient_id=?')->execute([$partner,$patient]);
            $this->db->prepare('DELETE FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id=?')->execute([$partner,$patient]);
            return ['pregnancy'=>null];
        }
        if ($action==='check') {
            // Ultrason / röntgen kontrolü: tarih, görülen yavru sayısı, kalp atışı (canlılık), amnion sıvısı ve not. Yalnız klinik girer.
            if ($source!=='clinic') throw new RuntimeException('Kontrol sonucunu klinik girer.',403);
            $cur=$this->forPatients($partner,[$patient])[$patient] ?? null;
            if (!$cur) throw new RuntimeException('Önce gebelik takibini başlatın.',422);
            if ($cur['ended']) throw new RuntimeException('Doğum kaydedildi; kontrol sonucu eklenemez.',422);
            $kind=(string)($body->kind ?? '');
            if (!in_array($kind,self::CHECKS,true)) throw new RuntimeException('Kontrol türü geçersiz.',422);
            $date=isset($body->date)&&$body->date!==''?self::date($body->date):self::today();
            if ($date>self::today() || $date<$cur['mating']) throw new RuntimeException('Kontrol tarihi çiftleşme ile bugün arasında olmalı.',422);
            $count=isset($body->count)&&$body->count!==''&&$body->count!==null?(int)$body->count:null;
            if ($count!==null && ($count<0||$count>20)) throw new RuntimeException('Yavru sayısı 0 ile 20 arasında olmalı.',422);
            $heart=(string)($body->heart ?? '');
            if (!in_array($heart,['','heard','not'],true)) throw new RuntimeException('Kalp atışı seçimi geçersiz.',422);
            $fluid=(string)($body->fluid ?? '');
            if (!in_array($fluid,['','Az','Normal','Fazla'],true)) throw new RuntimeException('Amnion sıvısı seçimi geçersiz.',422);
            $checks=$cur['checks'];
            if (!empty($body->remove)) unset($checks[$kind]);
            else $checks[$kind]=['date'=>$date,'count'=>$count,'heart'=>$heart,'fluid'=>$fluid,'note'=>mb_substr(trim((string)($body->note ?? '')),0,300,'UTF-8'),'by'=>mb_substr($author,0,120)];
            // Beklenen yavru sayısı: röntgen (iskelet sayımı) varsa o, yoksa ultrason sayısı.
            $expected=$checks['xray']['count'] ?? $checks['us']['count'] ?? $cur['expected'];
            if ($expected===0) $expected=null;
            $this->db->prepare('UPDATE clinic_pregnancy SET checks=?,expected=?,updated_at=? WHERE partner_id=? AND patient_id=?')
                ->execute([$checks?json_encode($checks,JSON_UNESCAPED_UNICODE):null,$expected,$now,$partner,$patient]);
            return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
        }
        if ($action==='photo') {
            // Anı fotoğrafları: Aile, Ultrason, Röntgen (+ not). Hasta sahibi yalnız Aile fotoğrafını değiştirebilir.
            $cur=$this->forPatients($partner,[$patient])[$patient] ?? null;
            if (!$cur) throw new RuntimeException('Önce gebelik takibini başlatın.',422);
            $kind=(string)($body->kind ?? '');
            if (!in_array($kind,self::PHOTOS,true)) throw new RuntimeException('Fotoğraf türü geçersiz.',422);
            if ($source!=='clinic' && $kind!=='family') throw new RuntimeException('Ultrason ve röntgen fotoğrafını klinik ekler.',403);
            if (!empty($body->remove)) {
                $this->db->prepare('DELETE FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id=? AND kind=?')->execute([$partner,$patient,$kind]);
                return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
            }
            $image=null;
            if (isset($body->image) && $body->image!==null && $body->image!=='') {
                $image=(string)$body->image;
                if (strlen($image)>self::PHOTO_MAX || !preg_match('#\Adata:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*\z#',$image)) throw new RuntimeException('Fotoğraf JPEG, PNG veya WEBP olmalı ve 1,5 MB\'ı geçmemeli.',422);
                $raw=base64_decode(substr($image,strpos($image,',')+1),true);
                if ($raw===false || @getimagesizefromstring($raw)===false) throw new RuntimeException('Fotoğraf okunamadı.',422);
            }
            $note=mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u','',(string)($body->note ?? '')) ?? ''),0,500,'UTF-8');
            $keep=!isset($body->image);
            $this->db->prepare('INSERT INTO clinic_pregnancy_photo(partner_id,patient_id,kind,image,note,updated_at) VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE image=IF(?,image,VALUES(image)),note=VALUES(note),updated_at=VALUES(updated_at)')
                ->execute([$partner,$patient,$kind,$image,$note,$now,$keep?1:0]);
            return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
        }
        if ($action==='expected') {
            // Ultrason / röntgende (45. gün) görülen yavru sayısı: cetvelin sonunda o kadar yavru gösterilir. Boş = bilinmiyor.
            $expected=isset($body->expected)&&$body->expected!==''&&$body->expected!==null?(int)$body->expected:null;
            if ($expected!==null && ($expected<1||$expected>20)) throw new RuntimeException('Beklenen yavru sayısı 1 ile 20 arasında olmalı.',422);
            $q=$this->db->prepare('UPDATE clinic_pregnancy SET expected=?,updated_at=? WHERE partner_id=? AND patient_id=? AND ended IS NULL');
            $q->execute([$expected,$now,$partner,$patient]);
            if ($q->rowCount()===0) {
                $cur=$this->forPatients($partner,[$patient])[$patient] ?? null;
                if (!$cur) throw new RuntimeException('Önce gebelik takibini başlatın.',422);
                if ($cur['ended']) throw new RuntimeException('Doğum kaydedildi; yavru sayısını doğum bilgisinden düzenleyin.',422);
            }
            return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
        }
        if ($action==='end') {
            $ended=isset($body->ended)?self::date($body->ended):self::today();
            if ($ended>self::today()) throw new RuntimeException('Doğum tarihi ileri bir tarih olamaz.',422);
            $litter=isset($body->litter)&&$body->litter!==''&&$body->litter!==null?(int)$body->litter:null;
            if ($litter!==null && ($litter<1||$litter>20)) throw new RuntimeException('Yavru sayısı 1 ile 20 arasında olmalı.',422);
            $healthy=isset($body->healthy)&&$body->healthy!==''&&$body->healthy!==null?(int)$body->healthy:null;
            if ($healthy!==null && ($healthy<0||$healthy>20||($litter!==null&&$healthy>$litter))) throw new RuntimeException('Sağlıklı yavru sayısı toplam yavru sayısını geçemez.',422);
            $this->db->prepare('UPDATE clinic_pregnancy SET ended=?,litter=?,healthy=?,ended_by=?,ended_author=?,updated_at=? WHERE partner_id=? AND patient_id=?')
                ->execute([$ended,$litter,$healthy,$source,mb_substr($author,0,120),$now,$partner,$patient]);
            return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
        }
        $mating=self::date($body->mating ?? null);
        $today=self::today();
        if ($mating>$today) throw new RuntimeException('Çiftleşme tarihi ileri bir tarih olamaz.',422);
        if ($mating<self::add($today,-75)) throw new RuntimeException('Bu çiftleşme tarihine göre doğum süresi geçmiş görünüyor. Tarihi kontrol edin.',422);
        $name=mb_substr(trim((string)($body->name ?? '')),0,120);
        $prev=$this->db->prepare('SELECT ended FROM clinic_pregnancy WHERE partner_id=? AND patient_id=?');
        $prev->execute([$partner,$patient]);
        if ($prev->fetchColumn()) $this->db->prepare('DELETE FROM clinic_pregnancy_photo WHERE partner_id=? AND patient_id=?')->execute([$partner,$patient]);
        $this->db->prepare('INSERT INTO clinic_pregnancy(partner_id,patient_id,species,mating,ended,source,author,pet_name,updated_at) VALUES (?,?,?,?,NULL,?,?,?,?)
            ON DUPLICATE KEY UPDATE expected=IF(ended IS NULL,expected,NULL),checks=IF(ended IS NULL,checks,NULL),species=VALUES(species),mating=VALUES(mating),ended=NULL,litter=NULL,healthy=NULL,ended_by=NULL,ended_author=NULL,source=VALUES(source),author=VALUES(author),
            pet_name=IF(VALUES(pet_name)<>\'\',VALUES(pet_name),pet_name),updated_at=VALUES(updated_at)')
            ->execute([$partner,$patient,$species,$mating,$source,mb_substr($author,0,120),$name,$now]);
        return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
    }

    /** Sağ üst klinik uyarıları: hasta sahibinin bildirdiği doğum ve vakti gelen ultrason / röntgen / doğum sonrası kontrol. */
    public function alerts(string $partner,string $today): array
    {
        $calls=[];
        try {
            $q=$this->db->prepare('SELECT patient_id,mating,milestone,called_by,called_at FROM clinic_pregnancy_call WHERE partner_id=?');
            $q->execute([$partner]);
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $c) $calls[$c['patient_id'].':'.$c['mating'].':'.$c['milestone']]=$c;
        } catch (\PDOException) {}
        $out=[];
        foreach ($this->forPatients($partner) as $p) {
            $pet=$p['name']!==''?$p['name']:'Hasta';
            $base=$p['patient'].':'.$p['mating'].':';
            $list=[];
            if ($p['ended'] && $p['endedBy']==='owner') {
                $litter=$p['litter']!==null?$p['litter'].' yavru':'Yavru sayısı belirtilmedi';
                $healthy=$p['healthy']!==null?', '.$p['healthy'].' sağlıklı':'';
                $list[]=['birth','ok','Doğum gerçekleşti · '.$pet,'Hasta sahibi bildirdi ('.($p['endedAuthor'] ?: 'hasta sahibi').'): '.$litter.$healthy.' · '.(new \DateTimeImmutable($p['ended']))->format('d.m.Y'),$p['ended']];
            }
            $control=self::add($p['ended'] ?: $p['birth'],7);
            if (!$p['ended'] && $p['us']<=$today && $p['xray']>$today) $list[]=['us','warn','Ultrason zamanı geldi · '.$pet,'30. gün ultrasonu '.(new \DateTimeImmutable($p['us']))->format('d.m.Y').'. Hasta sahibini arayıp randevu verin.',$p['us']];
            if (!$p['ended'] && $p['xray']<=$today) $list[]=['xray','warn','Röntgen zamanı geldi · '.$pet,'45. gün röntgeni (yavru sayısı, normal doğum / sezaryen) '.(new \DateTimeImmutable($p['xray']))->format('d.m.Y').'. Hasta sahibini arayın.',$p['xray']];
            if ($control<=$today && ($p['ended'] || $p['birth']<=$today)) $list[]=['control','warn','Doğum sonrası kontrol zamanı · '.$pet,'Anne ve yavruların kontrolü '.(new \DateTimeImmutable($control))->format('d.m.Y').'. Hasta sahibini arayıp randevu verin.',$control];
            foreach ($list as [$m,$tone,$title,$body,$date]) {
                $call=$calls[$base.$m] ?? null;
                if ($call) $body.=' · ✓ Arandı: '.$call['called_by'].' ('.(new \DateTimeImmutable('@'.$call['called_at']))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('d.m.Y H:i').')';
                $out[]=['key'=>'pregnancy:'.$base.$m,'kind'=>'pregnancy','tone'=>$call?'ok':$tone,'title'=>$title,'body'=>$body,
                    'href'=>'#patient/'.rawurlencode($p['patient']),'time'=>$call?(int)$call['called_at']:(int)strtotime($date.' 09:00 +03:00'),'auto'=>false,
                    'callable'=>true,'called'=>$call?['by'=>$call['called_by'],'at'=>(int)$call['called_at']]:null];
            }
        }
        return $out;
    }

    /** "Arandı" işareti: kimin aradığı kaydedilir. */
    public function called(string $partner,string $key,string $by,int $now): void
    {
        if (!preg_match('/\Apregnancy:([A-Za-z0-9_-]{1,80}):(\d{4}-\d{2}-\d{2}):(birth|us|xray|control)\z/',$key,$m)) throw new RuntimeException('Bildirim geçersiz.',422);
        $this->ensure();
        $exists=$this->db->prepare('SELECT 1 FROM clinic_pregnancy WHERE partner_id=? AND patient_id=? AND mating=?');
        $exists->execute([$partner,$m[1],$m[2]]);
        if (!$exists->fetchColumn()) throw new RuntimeException('Gebelik kaydı bulunamadı.',404);
        $this->db->prepare('INSERT INTO clinic_pregnancy_call(partner_id,patient_id,mating,milestone,called_by,called_at) VALUES (?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE called_by=VALUES(called_by),called_at=VALUES(called_at)')->execute([$partner,$m[1],$m[2],$m[3],mb_substr($by,0,120),$now]);
    }

    /** Hatırlatma zamanları: ultrason (30. gün), röntgen (45. gün), doğumdan 1 gün önce, aylık parazit. */
    public static function milestones(array $p): array
    {
        $list=[['us',$p['us']],['xray',$p['xray']],['birth',self::add($p['birth'],-1)]];
        foreach ($p['parasite'] as $i=>$d) if ($d!==$p['us']) $list[]=['parasite'.$i,$d];
        return $list;
    }

    public const TEMPLATES = [
        'us'=>'{hasta} için ultrason zamanı geldi! 🐾 Küçük patileri ilk kez birlikte görelim. Bugün kliniğimizde sizi bekliyoruz; aylık iç-dış parazit uygulamasını da yapalım. {klinik}',
        'xray'=>'{hasta} için röntgen zamanı! Yavru sayısını görüp normal doğum mu sezaryen mi planlayalım. Randevunuz için bize ulaşın. {klinik}',
        'birth'=>'Küçük patilerimiz yakında sizinle! 🐾 {hasta} için tahmini doğum yarın. Huzursuzluk, yuva yapma ya da 2 saati aşan sancıda hemen arayın. Doğum sonrası kontrolü unutmayın; anne ve yavruları birlikte muayene edelim. {klinik}',
        'parasite'=>'{hasta} için aylık iç-dış parazit uygulaması zamanı. Gebelikte güvenli ürünle kliniğimizde uygulayalım. {klinik}',
    ];
}
