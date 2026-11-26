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

    public function __construct(private readonly PDO $db) {}

    public function ensure(): void
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS clinic_pregnancy (
            partner_id VARCHAR(80) NOT NULL, patient_id VARCHAR(80) NOT NULL, species VARCHAR(20) NOT NULL,
            mating DATE NOT NULL, ended DATE NULL, source VARCHAR(12) NOT NULL DEFAULT \'clinic\', author VARCHAR(120) NOT NULL DEFAULT \'\',
            updated_at INT UNSIGNED NOT NULL, PRIMARY KEY (partner_id,patient_id), KEY mating_idx (mating)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        if (!$this->db->query("SHOW COLUMNS FROM clinic_pregnancy LIKE 'litter'")->fetch()) $this->db->exec('ALTER TABLE clinic_pregnancy ADD COLUMN litter TINYINT UNSIGNED NULL');
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
        return ['patient'=>$r['patient_id'],'ended'=>$r['ended'],'litter'=>isset($r['litter'])?(int)$r['litter']:null,'source'=>$r['source'],'author'=>$r['author']]+$plan;
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
            $this->db->prepare('DELETE FROM clinic_pregnancy WHERE partner_id=? AND patient_id IN ('.implode(',',array_fill(0,count($expired),'?')).')')->execute([$partner,...$expired]);
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
            return ['pregnancy'=>null];
        }
        if ($action==='end') {
            $ended=isset($body->ended)?self::date($body->ended):self::today();
            if ($ended>self::today()) throw new RuntimeException('Doğum tarihi ileri bir tarih olamaz.',422);
            $litter=isset($body->litter)&&$body->litter!==''&&$body->litter!==null?(int)$body->litter:null;
            if ($litter!==null && ($litter<1||$litter>20)) throw new RuntimeException('Yavru sayısı 1 ile 20 arasında olmalı.',422);
            $this->db->prepare('UPDATE clinic_pregnancy SET ended=?,litter=?,updated_at=? WHERE partner_id=? AND patient_id=?')->execute([$ended,$litter,$now,$partner,$patient]);
            return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
        }
        $mating=self::date($body->mating ?? null);
        $today=self::today();
        if ($mating>$today) throw new RuntimeException('Çiftleşme tarihi ileri bir tarih olamaz.',422);
        if ($mating<self::add($today,-75)) throw new RuntimeException('Bu çiftleşme tarihine göre doğum süresi geçmiş görünüyor. Tarihi kontrol edin.',422);
        $this->db->prepare('INSERT INTO clinic_pregnancy(partner_id,patient_id,species,mating,ended,source,author,updated_at) VALUES (?,?,?,?,NULL,?,?,?)
            ON DUPLICATE KEY UPDATE species=VALUES(species),mating=VALUES(mating),ended=NULL,source=VALUES(source),author=VALUES(author),updated_at=VALUES(updated_at)')
            ->execute([$partner,$patient,$species,$mating,$source,mb_substr($author,0,120),$now]);
        return ['pregnancy'=>$this->forPatients($partner,[$patient])[$patient] ?? null];
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
