<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

final class WebBuilderAdmin
{
    public const TABS = [
        'genel'=>'Genel Bakış','kurulum'=>'Web Siteni Oluştur','tema'=>'Tema ve Renkler',
        'duzen'=>'Ana Sayfa Düzeni','rakamlar'=>'Klinik Rakamları','hakkimizda'=>'Hakkımızda','ekibimiz'=>'Ekibimiz','blog'=>'Blog Yönetimi','kategoriler'=>'Blog Kategorileri',
        'ailemiz'=>'Ailemiz','medya'=>'Görseller','randevu'=>'Randevu Ayarları','iletisim'=>'İletişim Bilgileri','seo'=>'SEO Ayarları',
        'yayin'=>'Alan Adı ve Yayınlama','ayarlar'=>'Genel Ayarlar',
    ];
    public const PAGE_SIZE=15;
    private const IDENTITY=['name'=>'Klinik adı','title'=>'SEO başlığı','description'=>'Meta açıklaması','keywords'=>'Anahtar kelimeler',
        'slogan'=>'Klinik sloganı','city'=>'İl','district'=>'İlçe','neighborhood'=>'Mahalle'];
    private const CONTACT=['phone'=>'Telefon','whatsapp'=>'WhatsApp numarası','email'=>'E-posta','address'=>'Açık adres',
        'directions'=>'Yol tarifi bağlantısı','maps'=>'Google Haritalar yerleştirme kodu veya bağlantısı','instagram'=>'Instagram','facebook'=>'Facebook','social'=>'Diğer sosyal medya'];
    private const BRANCH_CONTACT=['address'=>'Açık adres','phone'=>'Telefon','directions'=>'Yol tarifi bağlantısı'];
    private const PAGE_FIELDS=['title'=>'Başlık','summary'=>'Kısa açıklama','body'=>'İçerik','alt'=>'Görsel açıklaması','link'=>'Ek bağlantı'];
    private const GROUPS=[
        'ekibimiz'=>['team',['name'=>'Ad soyad','title'=>'Unvan','specialty'=>'Uzmanlık','body'=>'Kısa özgeçmiş','link'=>'Sosyal medya']],
        'blog'=>['blog',['title'=>'Başlık','slug'=>'URL adı','summary'=>'Kısa özet','body'=>'İçerik','category'=>'Kategori','tags'=>'Etiketler',
            'author'=>'Yazar','date'=>'Yayın tarihi','seoTitle'=>'SEO başlığı','seoDescription'=>'SEO açıklaması']],
        'ailemiz'=>['gallery',['name'=>'Hayvan adı','species'=>'Tür','body'=>'Kısa açıklama']],
    ];

    public function __construct(private readonly WebBuilder $web,private readonly string $editor='/web-sitem') {}

    public static function e(mixed $text): string
    {
        return htmlspecialchars((string)$text,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
    }
    public static function fields(array $definitions,array $values,array $required=[]): string
    {
        $html='';
        foreach ($definitions as $key=>$label) {
            $value=self::e(is_scalar($values[$key]??null)?$values[$key]:'');
            $needed=in_array($key,$required,true);
            $type=match($key){'date'=>'date','email'=>'email','phone','whatsapp'=>'tel','position'=>'number', default=>'text'};
            $large=in_array($key,['body','summary','description','maps','mission','story','services','facilities','privacy','holidays','redirects','notes'],true);
            $html.='<label'.($large?' class="wide"':'').'>'.self::e($label).($needed?' <small class="hint">(zorunlu)</small>':'').
                ($large?'<textarea name="'.$key.'" rows="'.($key==='body'?7:3).'">'.$value.'</textarea>':
                    '<input type="'.$type.'" name="'.$key.'" value="'.$value.'"'.($needed?' required':'').'>').'</label>';
        }
        return $html;
    }
    private static function values(array $definitions,array $post): array
    {
        $result=[];
        foreach ($definitions as $key=>$label) {
            try {
                $raw=WebBuilder::text($post[$key]??'',24000);
                $result[$key]=match($key) {
                    'maps'=>WebBuilder::maps($raw),
                    'link','directions','instagram','facebook','social'=>WebBuilder::https($raw),
                    'phone','whatsapp'=> $raw===''?'':(WebBuilder::phone(WebBuilder::text($raw,32))?:throw new RuntimeException('Geçerli bir telefon numarası girin.',422)),
                    'email'=> $raw===''?'':(filter_var(WebBuilder::text($raw,254),FILTER_VALIDATE_EMAIL)?:throw new RuntimeException('E-posta geçersiz.',422)),
                    'body','story','mission','services','facilities','privacy','redirects'=>WebBuilder::text($raw,24000),
                    default=>WebBuilder::text($raw,1500),
                };
            } catch (RuntimeException $error) {
                throw new RuntimeException($label.' — '.$error->getMessage(),$error->getCode(),$error);
            }
        }
        return $result;
    }
    public static function hours(string $value): array
    {
        $ranges=[];
        foreach (preg_split('/\s*,\s*/',trim($value),-1,PREG_SPLIT_NO_EMPTY) as $range) {
            if (!preg_match('/\A((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)\z/D',$range,$m) || $m[1]>=$m[2]) {
                throw new RuntimeException('Çalışma saatlerini 09:00-13:00, 14:00-18:00 biçiminde girin.',422);
            }
            if (count($ranges)>=8) throw new RuntimeException('Bir güne en fazla sekiz çalışma aralığı eklenebilir.',422);
            foreach ($ranges as [$start,$end]) if ($m[1]<$end && $start<$m[2]) throw new RuntimeException('Çalışma aralıkları çakışıyor.',422);
            $ranges[]=[$m[1],$m[2]];
        }
        sort($ranges);
        return $ranges;
    }
    private static function selected(mixed $flag): bool { return $flag==='yes'; }

    public function save(array $actor,?array $site,array $post,array $files): string
    {
        if (($post['tab']??'')==='yayin' && ($post['action']??'')==='verify') return $this->saveForm($actor,$site,$post,$files);
        return $this->web->transaction(fn()=>$this->saveForm($actor,$site,$post,$files));
    }
    private function saveForm(array $actor,?array $site,array $post,array $files): string
    {
        $tab=(string)($post['tab']??'');
        if (!isset(self::TABS[$tab])) throw new RuntimeException('İşlem geçersiz.',422);
        $action=$post['action']??'save';
        if (!$site && $tab==='kurulum' && $action==='save') {
            $identity=self::identity($post);
            if (($post['slug']??'')==='') throw new RuntimeException('Kısa site adresini girin. Örnek: melodim-veteriner',422);
            $this->web->create($actor,WebBuilder::key($post['slug']),$identity);
            if (($post['publish']??'')==='yes') {
                $created=$this->web->site($actor['partner_id'],true);
                $this->web->publish($created,(int)$created['revision']);
            }
            return ($post['next']??'')==='yes'?'iletisim':'kurulum';
        }
        if (!$site) throw new RuntimeException('Önce web sitenizi oluşturun.',404);
        $site=$this->web->site($site['partner_id'],true);
        if (!$site) throw new RuntimeException('Site artık mevcut değil.',404);
        $revision=(int)($post['revision']??0);
        if ($revision!==(int)$site['revision']) throw new RuntimeException('Taslak güncellendi. Sayfayı yenileyin.',409);
        if ($tab==='yayin' && $action!=='save') {
            match($action) {
                'publish'=>$this->web->publish($site,$revision),
                'unpublish'=>$this->web->release($site,null,$revision),
                'rollback'=>$this->web->release($site,(int)($post['release']??0),$revision),
                'domain'=>$this->web->domain($site,strtolower(WebBuilder::text($post['host']??'',253))),
                'verify'=>$this->web->verifyDomain($site),
                default=>throw new RuntimeException('İşlem geçersiz.',422),
            };
            return 'yayin';
        }
        $draft=WebBuilder::decode($site['draft']);
        $removed=[];
        $image=function(string $key,array $record) use($files,$post,$site,&$removed): string {
            $remove=($post['remove_'.$key]??'')==='yes';
            if ($remove && !empty($record[$key])) $removed[]=$record[$key];
            if (($files[$key]['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_NO_FILE) {
                $label=match($key){'logo'=>'Klinik logosu','favicon'=>'Favicon',default=>'Görsel'};
                try { return $this->web->upload($site,$files[$key]); }
                catch (RuntimeException $error) { throw new RuntimeException($label.' — '.$error->getMessage(),$error->getCode(),$error); }
            }
            return $remove?'':($record[$key]??'');
        };
        if (in_array($tab,['kurulum','seo'],true)) {
            $draft['identity']=self::identity($post);
        } elseif ($tab==='iletisim') {
            $record=$draft['contact'];
            $draft['contact']=self::values(self::CONTACT,$post);
            foreach (['logo','favicon'] as $key) $draft['contact'][$key]=$image($key,$record);
            foreach ($this->web->branches($site['partner_id']) as $branch) {
                $value=$post['branchContact'][$branch->id]??[];
                $draft['contact']['branches'][$branch->id]=self::values(self::BRANCH_CONTACT,is_array($value)?$value:[]);
            }
        } elseif ($tab==='tema') {
            if (!is_string($post['theme']??null) || !isset(WebBuilder::THEMES[$post['theme']]) || !in_array($post['palette']??'', ['a','b'],true)) throw new RuntimeException('Tema seçimi geçersiz.',422);
            [$draft['theme'],$draft['palette']]=[$post['theme'],$post['palette']];
        } elseif ($tab==='duzen') {
            $sections=[];
            foreach (WebBuilder::SECTIONS as $key=>$title) if (self::selected($post['show'][$key]??null)) $sections[$key]=(int)($post['pos'][$key]??0);
            asort($sections);
            $draft['sections']=array_keys($sections);
            $page=$draft['content']['']??[];
            $page=array_replace($page,self::values(['title'=>'Başlık','summary'=>'Kısa açıklama','body'=>'İçerik'],$post+$page));
            $page['image']=$image('image',$page);
            $page['alt']=WebBuilder::text($post['hero_alt']??$page['alt']??'',480);
            $focus=$post['hero_focus']??$page['focus']??'center';
            $page['focus']=in_array($focus,['left','center','right','top','bottom'],true)?$focus:'center';
            $draft['content']['']=$page;
        } elseif ($tab==='rakamlar') {
            $numbers=['title'=>WebBuilder::text($post['numbers_title']??'',240),'items'=>[]];
            foreach (WebBuilder::NUMBERS as $key=>$label) {
                $entry=$post['numbers'][$key]??[];
                if (!is_array($entry)) continue;
                $numbers['items'][$key]=[
                    'visible'=>self::selected($entry['show']??null),
                    'label'=>WebBuilder::text($entry['label']??'',160),
                    'value'=>WebBuilder::text($entry['value']??'',60),
                ];
            }
            $draft['numbers']=$numbers;
            if (self::selected($post['show_numbers']??null) && !in_array('numbers',$draft['sections'],true)) {
                array_unshift($draft['sections'],'numbers');
            } elseif (!self::selected($post['show_numbers']??null)) {
                $draft['sections']=array_values(array_diff($draft['sections'],['numbers']));
            }

        } elseif ($tab==='hakkimizda') {
            $record=self::values(self::PAGE_FIELDS+['story'=>'Kuruluş hikâyesi','mission'=>'Misyon ve vizyon','services'=>'Hizmetler','facilities'=>'Klinik imkânları'],$post);
            $record['image']=$image('image',$draft['content']['hakkimizda']??[]);
            $draft['content']['hakkimizda']=$record;
        } elseif (isset(self::GROUPS[$tab])) {
            [$group,$fields]=self::GROUPS[$tab];
            $id=WebBuilder::text($post['id']??'',32);
            if ($id!=='' && !isset($draft[$group][$id])) throw new RuntimeException('İçerik bulunamadı.',404);
            if ($action==='delete' && $id!=='') {
                if (!empty($draft[$group][$id]['image'])) $removed[]=$draft[$group][$id]['image'];
                unset($draft[$group][$id]);
            } else {
                $record=self::values($fields+['alt'=>'Görsel açıklaması'],$post);
                $record['visible']=self::selected($post['visible']??null);
                $record['position']=max(0,min(1000000,(int)($post['position']??0)));
                $record['image']=$image('image',$draft[$group][$id]??[]);
                if ($group==='blog') {
                    $previous=$draft['blog'][$id]??null;
                    $used=array_fill_keys(array_column($draft['blog']??[],'slug'),true);
                    $record['slug']=$previous['slug']??WebBuilder::articleSlug($record['title'],$used);
                    if ($record['category']!=='' && !in_array($record['category'],WebBuilder::blogCategories($draft),true)) {
                        throw new RuntimeException('Listeden bir blog kategorisi seçin.',422);
                    }
                    $record['position']=$previous['position']??count($draft['blog']);
                    $record['author']=(string)$this->web->query('SELECT name FROM partner_account WHERE id=?',[$site['partner_id']])->fetchColumn();
                    $record['date']=$record['date']?:WebBuilder::today();
                    if (!self::validDay($record['date']) || $record['title']==='') throw new RuntimeException('Başlık ve geçerli tarih gerekli.',422);
                    $record['createdAt']=$previous['createdAt']??($previous===null?gmdate('c'):null);
                    $record['createdBy']=$previous['createdBy']??($previous===null?
                        (($actor['name']??'')?:($this->editor==='/web-sitem'?'Bayi yöneticisi':'Merkez yöneticisi')):null);
                } elseif ($record['name']==='') throw new RuntimeException('Ad alanı gerekli.',422);
                $recordId=$id?:bin2hex(random_bytes(16));
                if ($group==='gallery') {
                    if (!in_array($record['species'],WebBuilder::GALLERY_SPECIES,true)) throw new RuntimeException('Hayvan türünü listeden seçin.',422);
                    $previous=$draft[$group][$id]??[];
                    $record['position']=$previous['position']??(1+max([-1,...array_column($draft[$group],'position')]));
                    $record['createdAt']=$previous['createdAt']??gmdate('c');
                    $record['consent']='';
                    if ($record['image'] && $record['image']===($previous['image']??'') && !empty($previous['consent'])) {
                        $record['consent']=$previous['consent'];
                        $record['consentAt']=$previous['consentAt']??null;
                        $record['consentBy']=$previous['consentBy']??null;
                    } elseif ($record['image'] && self::selected($post['permission']??null)) {
                        $record['consent']='gallery-'.$recordId.'-'.$record['image'];
                        $record['consentAt']=gmdate('c');
                        $record['consentBy']=$actor['account_id']??$actor['id']??'';
                    }
                    if (!$record['image'] && ($post['remove_image']??'')==='yes') $record['visible']=false;
                    if ($record['visible'] && (!$record['consent'] || !$record['image'])) throw new RuntimeException('Galeri yayını için fotoğraf ekleyip yayın iznini onaylayın.',422);
                }
                $draft[$group][$recordId]=$record;
            }
        } elseif ($tab==='kategoriler') {
            $categories=WebBuilder::blogCategories($draft);
            $old=WebBuilder::text($post['old_name']??'',240);
            $name=WebBuilder::text($post['category_name']??'',240);
            if ($old!=='' && !in_array($old,$categories,true)) throw new RuntimeException('Kategori bulunamadı.',404);
            if ($action==='delete') {
                if ($old==='') throw new RuntimeException('Kategori bulunamadı.',404);
                if (in_array($old,array_column($draft['blog'],'category'),true)) throw new RuntimeException('Kategoriyi silmeden önce bu kategorideki yazıları başka bir kategoriye taşıyın.',422);
            } else {
                if ($name==='') throw new RuntimeException('Kategori adı gerekli.',422);
                if ($name!==$old && in_array($name,$categories,true)) throw new RuntimeException('Bu kategori zaten var.',422);
                foreach ($draft['blog'] as &$blog) {
                    if ($old!=='' && ($blog['category']??'')===$old) $blog['category']=$name;
                }
                unset($blog);
            }
            $draft['blogCategories']=array_values(array_filter($categories,static fn($item)=>$item!==$old));
            if ($action!=='delete') $draft['blogCategories'][]=$name;
        } elseif ($tab==='medya') {
            $id=$post['media_id']??'';
            if (($post['confirm_media']??'')!=='yes' || !is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/D',$id)) {
                throw new RuntimeException('Görseli kalıcı olarak silmek için onay kutusunu işaretleyin.',422);
            }
            if (!$this->web->query('SELECT id FROM clinic_web_media WHERE partner_id=? AND id=?',[$site['partner_id'],$id])->fetchColumn()) {
                throw new RuntimeException('Görsel bulunamadı.',404);
            }
            $removed[]=$id;
            $draft=WebBuilder::stripMedia($draft,[$id]);
        } elseif ($tab==='randevu') {
            $branches=array_column($this->web->branches($site['partner_id']),'id');
            $submitted=is_array($post['branches']??null)?$post['branches']:[];
            $duration=(int)($post['duration']??30);
            if (!in_array($duration,[15,20,30,45,60],true)) throw new RuntimeException('Süre geçersiz.',422);
            $holidays=preg_split('/\s+/',WebBuilder::text($post['holidays']??'',4000),-1,PREG_SPLIT_NO_EMPTY);
            foreach ($holidays as $day) if (!self::validDay($day)) throw new RuntimeException('Tatil günlerini YYYY-AA-GG biçiminde girin.',422);
            $booking=['enabled'=>self::selected($post['enabled']??null),'autoConfirm'=>self::selected($post['autoConfirm']??null),
                'duration'=>$duration,'branches'=>array_values(array_intersect($branches,$submitted)),'holidays'=>$holidays,
                'privacy'=>WebBuilder::text($post['privacy']??'',24000),'hours'=>[]];
            foreach ($branches as $branch) {
                $provider=WebBuilder::text($post['provider'][$branch]??'',80);
                if ($provider!=='' && !isset($this->web->roster($site['partner_id'],$branch)[$provider])) throw new RuntimeException('Hekim veya personel seçimi geçersiz.',422);
                $booking['providers'][$branch]=$provider;
                foreach (WebBuilder::DAYS as $day=>$label) {
                    $booking['hours'][$branch][$day]=self::hours(WebBuilder::text($post['hours'][$branch][$day]??'',160));
                    if ($provider) $booking['providerHours'][$branch][$day]=self::hours(WebBuilder::text($post['providerHours'][$branch][$day]??'',160));
                }
                if ($provider && $booking['enabled'] && in_array($branch,$booking['branches'],true) && !array_filter($booking['providerHours'][$branch]??[])) throw new RuntimeException('Seçilen sağlık çalışanı için en az bir saat aralığı girin.',422);
            }
            if ($booking['enabled'] && (!$booking['branches'] || !$booking['privacy'])) throw new RuntimeException('En az bir şube ve aydınlatma metni gerekli.',422);
            if ($booking['enabled']) foreach ($booking['branches'] as $branch) if (!array_filter($booking['hours'][$branch]??[])) throw new RuntimeException('Her randevu şubesi için çalışma saati girin.',422);
            $draft['booking']=$booking;
        } elseif ($tab==='ayarlar') {
            $draft['settings']=['index'=>self::selected($post['index']??null),'contact'=>self::selected($post['contact']??null),
                'contactPrivacy'=>WebBuilder::text($post['privacy']??'',24000),'contactMail'=>self::selected($post['contactMail']??null),'redirects'=>[]];
            if ($draft['settings']['contact'] && !$draft['settings']['contactPrivacy']) throw new RuntimeException('İletişim formu için aydınlatma metni gerekli.',422);
            foreach (preg_split('/\R/',WebBuilder::text($post['redirects']??'',5000),-1,PREG_SPLIT_NO_EMPTY) as $line) {
                if (!preg_match('~\A([a-z0-9-]{1,63})\s+([a-z0-9-]{1,63})\z~D',trim($line),$m) ||
                    isset(WebBuilder::PAGES[$m[1]]) || !isset(WebBuilder::PAGES[$m[2]])) throw new RuntimeException('Yönlendirme örneği: eski-hakkimizda hakkimizda',422);
                $draft['settings']['redirects'][$m[1]]=$m[2];
            }
        } else throw new RuntimeException('İşlem geçersiz.',422);
        $this->web->deleteMedia($site['partner_id'],$removed,$draft);
        $this->web->edit($site,$draft,$revision);
        if ($site['published'] || ($post['publish']??'')==='yes') $this->web->publish($site,$revision+1);
        if (($post['next']??'')==='yes') return ['kurulum'=>'iletisim','iletisim'=>'tema','tema'=>'duzen','duzen'=>'yayin'][$tab]??$tab;
        return $tab;
    }
    private static function identity(array $post): array
    {
        $identity=self::values(self::IDENTITY,$post);
        if ($identity['name']==='') throw new RuntimeException('Klinik adını girin.',422);
        return $identity;
    }
    private static function validDay(string $day): bool
    {
        return preg_match('/\A(\d{4})-(\d{2})-(\d{2})\z/D',$day,$m) && checkdate((int)$m[2],(int)$m[3],(int)$m[1]);
    }
    private function form(string $tab,?array $site,string $fields,string $actions='',string $action='save',bool $uploads=false): string
    {
        $actions=$actions?:'<button>'.($site && $site['published']?'Kaydet':'Taslağı kaydet').'</button>';
        if ($action==='save') $actions.='<button type="submit" name="publish" value="yes" class="secondary">Yayınla</button>';
        return '<form class="editor" method="post" action="'.self::e($this->editor).'?tab='.self::e($tab).'"'.($uploads?' enctype="multipart/form-data"':'').
            '><input type="hidden" name="tab" value="'.self::e($tab).'"><input type="hidden" name="action" value="'.self::e($action).
            '"><input type="hidden" name="revision" value="'.(int)($site['revision']??0).'">'.$fields.
            '<div class="controls wide">'.$actions.'</div></form>';
    }
    public static function check(string $name,string $label,bool $checked): string
    {
        return '<label class="check"><input type="checkbox" name="'.self::e($name).'" value="yes"'.($checked?' checked':'').'>'.self::e($label).'</label>';
    }
    private function file(string $key,string $label,array $record,?string $dimensions=null): string
    {
        $current=$record[$key]??'';
        $input='<label class="upload-box"><input type="file" name="'.$key.'" accept="image/jpeg,image/png,image/webp,image/avif"><span class="upload-plus" aria-hidden="true">+</span>'.
            '<strong>'.self::e($label).'</strong><small data-file-name>'.($dimensions??($key==='favicon'?'Önerilen 256 × 256 px':'Önerilen 1200 × 800 px')).
            ' · JPEG, PNG, WebP, AVIF · En fazla 6,5 MB ve 16 MP</small></label>';
        return '<div class="upload-field">'.$input.($current?'<div class="asset"><img alt="" src="'.self::e($this->editor).'/medya/'.self::e($current).'">'.
            self::check('remove_'.$key,'Görseli kalıcı olarak sil',false).'</div>':'').'</div>';
    }
    public static function page(string $title,string $contents,string $class=''): string
    {
        return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'.
            '<meta name="robots" content="noindex,nofollow"><title>'.self::e($title).' · VetZimo</title><link rel="stylesheet" href="/web-builder-admin.css?v=38"><script src="/web-builder-admin.js?v=38" defer></script></head>'.
            '<body class="'.self::e($class).'">'.$contents.'</body></html>';
    }
    public function render(array $actor,?array $site,string $tab,array $get,?string $error=null,array $submitted=[]): string
    {
        $draft=$site?WebBuilder::decode($site['draft']):[];
        if (!$site && $tab!=='kurulum') $tab='genel';
        $nav='';
        if ($site) foreach (self::TABS as $key=>$label) $nav.='<a'.($key===$tab?' aria-current="page"':'').' href="?tab='.$key.'">'.self::e($label).'</a>';
        $wizard=['kurulum','iletisim','tema','duzen','yayin'];
        $index=array_search($tab,$wizard,true);
        $steps='';
        if ($index!==false) {
            $steps='<ol class="steps" aria-label="Kurulum ilerlemesi">';
            foreach (['Kimlik','Klinik bilgileri','Tema','Sayfalar','Yayın'] as $i=>$step) $steps.='<li'.($i===$index?' aria-current="step"':'').'>'.($i+1).'. '.self::e($step).'</li>';
            $steps.='</ol>';
        }
        $back=$index!==false&&$index>0?'<a class="button secondary" href="?tab='.$wizard[$index-1].'">Geri</a>':'';
        $next=$index!==false&&$index<4?'<button name="next" value="yes">Sonraki</button>':'';
        $actions=$back.'<button class="secondary">'.($site&&$site['published']?'Kaydet':'Taslağı kaydet').'</button>'.$next;
        $body=$this->panel($actor,$site,$draft,$tab,$get,$actions,$submitted);
        $notice='<div id="builder-error" class="builder-error" role="alert" tabindex="-1"'.($error===null?' hidden':'').'>'.self::e($error??'').'</div>';
        return self::page(self::TABS[$tab],'<header class="builder-bar"><a href="'.($this->editor==='/web-sitem'?'/klinik#settings':'/yonetim/web-siteleri').'">‹ VetZimo</a><strong>Web Sitem</strong></header>'.
            '<div class="builder-layout">'.($nav?'<nav aria-label="Site yönetimi">'.$nav.'</nav>':'').'<main><h1>'.self::e(self::TABS[$tab]).'</h1>'.$steps.$notice.($site&&$site['control_status']==='paused'?'<p class="hint">Site merkez yönetimi tarafından yayından kaldırıldı.</p>':
                ($site&&$site['published']?'<p class="hint">Yayındaki sitede kaydedilen değişiklikler hemen görünür.</p>':'')).
            ($site&&in_array($tab,['iletisim','duzen','hakkimizda','ekibimiz','blog','ailemiz','medya'],true)?
                '<p class="hint">Depolama: '.number_format(($this->web->mediaBytes($site['partner_id'])+strlen($site['draft']))/1000000,2,',','.').' / '.$this->web->quotaMb($site['partner_id']).' MB</p>':'').
            $body.'</main></div>');
    }
    private function panel(array $actor,?array $site,array $d,string $tab,array $get,string $actions,array $submitted): string
    {
        if ($tab==='genel') {
            if (!$site) return '<section class="welcome"><h2>Kliniğinizin web sitesini oluşturun</h2><p>Temanızı seçin, klinik bilgilerinizi ekleyin ve randevu taleplerini VetZimo’da alın.</p><a class="button" href="?tab=kurulum">Ücretsiz Web Siteni Oluştur</a></section>';
            return '<section class="welcome"><h2>'.self::e($d['identity']['name']).'</h2><p>'.self::e($this->web->base($site)).'</p><p>'.
                ($site['published']?'Yayında':'Taslak').' · '.self::e(WebBuilder::THEMES[$d['theme']][0]).' · '.self::e($site['updated_at']).
                '</p><div class="controls"><a class="button" href="?tab=duzen">Siteyi düzenle</a><a class="button secondary" href="?tab=yayin">Önizle / Yayınla</a></div></section>'.$this->statistics($site);
        }
        if (in_array($tab,['kurulum','seo'],true)) {
            return $this->form($tab,$site,(!$site?self::fields(['slug'=>'Kısa site adresi'],$submitted,['slug']):'').
                '<p class="wide hint">Zorunlu alanlar işaretlidir. SEO başlığını, açıklamayı ve diğer bilgileri daha sonra ekleyebilirsiniz.</p>'.
                self::fields(self::IDENTITY,array_replace($d['identity']??[],$submitted),['name']),$tab==='kurulum'?$actions:'');
        }
        if ($tab==='iletisim') {
            $branches='';
            foreach ($this->web->branches($site['partner_id']) as $branch) {
                $input=$submitted['branchContact'][$branch->id]??[];
                $data=array_replace($d['contact']['branches'][$branch->id]??[],is_array($input)?array_filter($input,'is_string'):[]);
                $branches.='<fieldset class="wide branch-hours"><legend>'.self::e($branch->name).' · isteğe bağlı</legend>';
                foreach (self::BRANCH_CONTACT as $key=>$label) $branches.='<label>'.$label.'<input name="branchContact['.self::e($branch->id).']['.$key.']" value="'.self::e($data[$key]??'').'"></label>';
                $branches.='</fieldset>';
            }
            return $this->form($tab,$site,'<p class="wide hint">Bu adımdaki bütün alanlar isteğe bağlıdır. Boş bırakıp devam edebilir, İletişim Bilgileri bölümünden daha sonra ekleyebilirsiniz.</p>'.
                '<p class="wide hint">Google Haritalar’da Paylaş → Harita yerleştir → HTML’yi kopyala adımlarını izleyip kodu ilgili alana yapıştırın.</p>'.
                self::fields(self::CONTACT,array_replace($d['contact'],$submitted)).$this->file('logo','Klinik logosu (isteğe bağlı)',$d['contact']).
                $this->file('favicon','Favicon (isteğe bağlı)',$d['contact']).$branches,$actions,'save',true);
        }
        if ($tab==='tema') {
            $options='';
            foreach (WebBuilder::THEMES as $key=>[$title,$a,$b]) {
                $options.='<label class="theme-card '.$key.'"><input type="radio" name="theme" value="'.$key.'"'.($d['theme']===$key?' checked':'').
                    '><img class="theme-sample" data-theme-preview="'.$key.'" src="/web-themes/'.$key.($d['palette']==='b'?'-b':'').'-preview.webp?v=38" alt="" width="800" height="520" loading="lazy"><strong>'.self::e($title).'</strong><small>A · '.self::e($a).'<br>B · '.self::e($b).'</small></label>';
            }
            return $this->form($tab,$site,'<fieldset class="wide themes"><legend>Tema</legend>'.$options.'</fieldset><fieldset class="wide controls"><legend>Renk kombinasyonu</legend>'.
                '<label class="check"><input type="radio" name="palette" value="a"'.($d['palette']==='a'?' checked':'').'>A</label>'.
                '<label class="check"><input type="radio" name="palette" value="b"'.($d['palette']==='b'?' checked':'').'>B</label></fieldset>',$actions);
        }
        if ($tab==='rakamlar') {
            $totals=$this->web->clinicNumbers($site['partner_id'],$d);
            $numbers=$d['numbers']??[];
            $fields=self::fields(['numbers_title'=>'Bölüm başlığı'],['numbers_title'=>$numbers['title']??'']).
                self::check('show_numbers','Ana sayfada göster',in_array('numbers',$d['sections'],true)).
                '<p class="wide hint">Elle değer girdiğinizde sitede o değer görünür. Otomatik sayıyı göstermek için değeri boş bırakın.</p>';
            foreach (WebBuilder::NUMBERS as $key=>$label) {
                $row=$numbers['items'][$key]??[];
                $prefix='numbers['.$key.']';
                $fields.='<fieldset class="number-setting"><legend>'.self::e($label).'</legend>'.
                    ($totals[$key]!==null?'<p>VetZimo toplamı <strong>'.number_format($totals[$key],0,',','.').'</strong></p>':'').
                    self::check($prefix.'[show]','Bu kartı göster',$row['visible']??false).
                    '<label>Etiket<input name="'.$prefix.'[label]" maxlength="50" value="'.self::e($row['label']??'').'"></label>'.
                    '<label>Elle değer<input name="'.$prefix.'[value]" maxlength="20" value="'.self::e($row['value']??'').'"></label></fieldset>';
            }
            return $this->form($tab,$site,$fields);
        }
        if ($tab==='duzen') {
            $page=$d['content']['']??[];
            $options='';
            foreach (['center'=>'Orta','left'=>'Sol','right'=>'Sağ','top'=>'Üst','bottom'=>'Alt'] as $focus=>$label) {
                $options.='<option value="'.$focus.'"'.(($page['focus']??'center')===$focus?' selected':'').'>'.$label.'</option>';
            }
            $fields=self::fields(['title'=>'Ana sayfa başlığı','summary'=>'Başlık altı açıklama','body'=>'Ana sayfa metni'],$page).'<h2 class="wide">Ana sayfa görseli</h2>'.
                $this->file('image','Ana sayfa görseli',$page,'Önerilen yatay 1600 × 900 px').
                '<div class="hero-options"><p class="hint">Görsel WebP olarak küçültülür ve ekran boyutuna uyar. Fotoğrafın görünmesini istediğiniz bölgeye göre odağı seçin.</p>'.
                '<label>Görsel odağı<select name="hero_focus">'.$options.'</select></label>'.
                self::fields(['hero_alt'=>'Görsel açıklaması'],['hero_alt'=>$page['alt']??'']).'</div><h2 class="wide">Ana sayfa bölümleri</h2>';
            foreach (WebBuilder::SECTIONS as $key=>$title) {
                $pos=array_search($key,$d['sections'],true);
                $fields.='<label>'.self::e($title).' sırası<input type="number" min="1" max="99" name="pos['.$key.']" value="'.($pos===false?9:$pos+1).'"></label>'.
                    self::check('show['.$key.']',$title.' görünür',$pos!==false);
            }
            return $this->form($tab,$site,$fields,$actions,'save',true);
        }
        if ($tab==='hakkimizda') {
            $fields=self::PAGE_FIELDS+['story'=>'Kuruluş hikâyesi','mission'=>'Misyon ve vizyon','services'=>'Hizmetler (satır başına bir hizmet)','facilities'=>'Klinik imkânları'];
            $record=$d['content']['hakkimizda']??[];
            return $this->form($tab,$site,self::fields($fields,$record).$this->file('image','Sayfa görseli',$record),'','save',true);
        }
        if ($tab==='kategoriler') {
            $html=$this->form($tab,$site,self::fields(['category_name'=>'Yeni kategori adı'],$submitted,['category_name']));
            foreach (WebBuilder::blogCategories($d) as $category) {
                $hidden='<input type="hidden" name="old_name" value="'.self::e($category).'">';
                $html.='<section class="management-list"><h2>'.self::e($category).'</h2>'.
                    $this->form($tab,$site,$hidden.self::fields(['category_name'=>'Kategori adı'],['category_name'=>$category],['category_name'])).
                    $this->form($tab,$site,$hidden,'<button class="danger">Kategoriyi sil</button>','delete').'</section>';
            }
            return $html;
        }
        if ($tab==='blog') return $this->blogPanel($site,$d,$get,$submitted);
        if ($tab==='ailemiz') return $this->galleryPanel($site,$d,$get,$submitted);
        if (isset(self::GROUPS[$tab])) {
            [$group,$fields]=self::GROUPS[$tab];$list='<a class="button secondary" href="?tab='.$tab.'">Yeni kayıt</a>';
            foreach ($d[$group] as $id=>$row) $list.='<a href="?tab='.$tab.'&amp;id='.$id.'">'.self::e($row['name']??$row['title']).'</a>';
            $id=(string)($get['id']??'');
            if (!isset($d[$group][$id])) $id='';
            $record=$d[$group][$id]??[];
            $hidden='<input type="hidden" name="id" value="'.self::e($id).'">';
            $form=$this->form($tab,$site,$hidden.self::fields($fields+['position'=>'Sıra','alt'=>'Görsel açıklaması'],$record).
                $this->file('image','Görsel',$record).self::check('visible','Yayına dâhil et',$record['visible']??($group==='blog')),'','save',true);
            return '<div class="controls page-links">'.$list.'</div>'.$form.($id?$this->form($tab,$site,$hidden,'<button class="secondary">Taslak kaydını sil</button>','delete'):'');
        }
        if ($tab==='medya') return $this->mediaPanel($site,$get);
        if ($tab==='randevu') {
            $booking=$d['booking'];$fields='';
            foreach ($this->web->branches($site['partner_id']) as $branch) {
                $branchId=self::e($branch->id);
                $fields.='<fieldset class="wide branch-hours"><legend>'.self::e($branch->name).'</legend><label class="check"><input type="checkbox" name="branches[]" value="'.$branchId.'"'.
                    (in_array($branch->id,$booking['branches']??[],true)?' checked':'').'>Randevuya açık</label>';
                foreach (WebBuilder::DAYS as $day=>$label) {
                    $hours=implode(', ',array_map(static fn($r)=>implode('-',$r),$booking['hours'][$branch->id][$day]??[]));
                    $fields.='<label>'.$label.'<input name="hours['.$branchId.']['.$day.']" value="'.self::e($hours).'" placeholder="09:00-13:00, 14:00-18:00"></label>';
                }
                $fields.='<details class="wide"><summary>Hekim / personel uygunluğu</summary><div class="branch-hours"><label class="wide">Randevu görevlisi<select name="provider['.$branchId.']"><option value="">Klinik daha sonra atayacak</option>';
                foreach ($this->web->roster($site['partner_id'],$branch->id) as $id=>$name) {
                    $fields.='<option value="'.self::e($id).'"'.(($booking['providers'][$branch->id]??'')===$id?' selected':'').'>'.self::e($name).'</option>';
                }
                $fields.='</select></label>';
                foreach (WebBuilder::DAYS as $day=>$label) {
                    $hours=implode(', ',array_map(static fn($r)=>implode('-',$r),$booking['providerHours'][$branch->id][$day]??[]));
                    $fields.='<label>'.$label.'<input name="providerHours['.$branchId.']['.$day.']" value="'.self::e($hours).'" placeholder="09:00-13:00, 14:00-18:00"></label>';
                }
                $fields.='</div></details></fieldset>';
            }
            $duration='<label>Randevu süresi<select name="duration">';
            foreach ([15,20,30,45,60] as $minutes) $duration.='<option value="'.$minutes.'"'.(($booking['duration']??30)===$minutes?' selected':'').'>'.$minutes.' dakika</option>';
            return $this->form($tab,$site,self::check('enabled','Web randevularını aç',$booking['enabled']??false).
                self::check('autoConfirm','Uygun talepleri otomatik onayla',$booking['autoConfirm']??false).$duration.'</select></label>'.$fields.
                self::fields(['holidays'=>'Tatil günleri (YYYY-AA-GG, ayrı satırlarda)','privacy'=>'Randevu formu aydınlatma metni'],
                    ['holidays'=>implode("\n",$booking['holidays']??[]),'privacy'=>$booking['privacy']??'']));
        }
        if ($tab==='yayin') return $this->publication($site,$d,$get);
        $redirects=[];
        foreach ($d['settings']['redirects']??[] as $old=>$new) $redirects[]=$old.' '.$new;
        return $this->form($tab,$site,self::check('index','Yayınlanan site arama motorlarına açık',$d['settings']['index']??true).
            self::check('contact','İletişim formunu aç',$d['settings']['contact']??false).
            self::check('contactMail','Yeni iletişim mesajı için bayi yöneticisine e-posta gönder',$d['settings']['contactMail']??false).
            self::fields(['privacy'=>'İletişim formu aydınlatma metni','redirects'=>'Yönlendirmeler (eski-ad yeni-ad)'],['privacy'=>$d['settings']['contactPrivacy']??'','redirects'=>implode("\n",$redirects)]));
    }
    public static function pageNumber(mixed $value): int
    {
        return is_scalar($value)?max(1,(int)$value):1;
    }

    public static function pagination(int $current,int $last,callable $url): string
    {
        if ($last<=1) return '';
        $numbers=array_unique([1,max(1,$current-1),$current,min($last,$current+1),$last]);
        $link=static fn($page,$label,$title)=>'<a href="'.self::e($url($page)).'" aria-label="'.$title.'">'.$label.'</a>';
        $html='<nav class="builder-pagination" aria-label="Sayfalama">';
        if ($current>1) $html.=$link($current-1,'‹','Önceki sayfa');
        $previous=0;
        foreach ($numbers as $page) {
            if ($page>$previous+1) $html.='<span aria-hidden="true">…</span>';
            $html.=$page===$current?'<span aria-current="page">'.$page.'</span>':$link($page,$page,'Sayfa '.$page);
            $previous=$page;
        }
        if ($current<$last) $html.=$link($current+1,'›','Sonraki sayfa');
        return $html.'</nav>';
    }

    private function galleryPanel(array $site,array $draft,array $get,array $submitted): string
    {
        $items=array_reverse($draft['gallery']??[],true);
        $id=is_string($get['id']??null)&&isset($items[$get['id']])?$get['id']:'';
        $page=min(self::pageNumber($get['sayfa']??1),max(1,(int)ceil(count($items)/self::PAGE_SIZE)));
        $url=static fn($n)=>'?tab=ailemiz&sayfa='.$n;
        $record=array_replace($items[$id]??[],$submitted);
        $species=WebBuilder::gallerySpecies($record);
        $options='<option value="">Tür seçin</option>';
        foreach (WebBuilder::GALLERY_SPECIES as $type) {
            $options.='<option'.($record&&$species===$type?' selected':'').'>'.self::e($type).'</option>';
        }
        $hidden='<input type="hidden" name="id" value="'.self::e($id).'"><input type="hidden" name="sayfa" value="'.$page.'">';
        $fields=$hidden.self::fields(['name'=>'Hayvan adı','body'=>'Kısa açıklama','alt'=>'Görsel açıklaması'],$record,['name']).
            '<label>Tür<select name="species" required>'.$options.'</select></label>'.$this->file('image','Galeri fotoğrafı',$record).
            '<div class="wide">'.self::check('permission','Eklediğim fotoğraf için yayın izni alındı.',self::selected($submitted['permission']??null)).
            self::check('visible','Yayına dâhil et',isset($submitted['action'])?self::selected($submitted['visible']??null):($record['visible']??true)).'</div>';
        $html='<section id="gallery-editor" class="post-editor"><div class="section-heading"><h2>'.($id?'Kaydı düzenle':'Yeni galeri kaydı').'</h2>'.
            ($id?'<a class="button secondary" href="'.self::e($url($page)).'#gallery-editor">+ Yeni kayıt</a>':'').'</div>'.
            $this->form('ailemiz',$site,$fields,'','save',true).
            ($id?'<details class="post-delete"><summary>Silme seçenekleri</summary>'.
                $this->form('ailemiz',$site,$hidden,'<button class="danger">Kaydı sil</button>','delete').'</details>':'').'</section>';
        $html.='<section id="gallery-list" class="management-list"><div class="section-heading"><h2>Eklenen kayıtlar</h2><span class="list-count">'.count($items).' kayıt</span></div>';
        if (!$items) return $html.'<p class="list-empty">Henüz galeri kaydı eklenmemiş.</p></section>';
        $offset=($page-1)*self::PAGE_SIZE;
        $html.='<div class="table-scroll" tabindex="0" role="region" aria-label="Eklenen galeri kayıtları"><table class="management-table gallery-table"><thead><tr>'.
            '<th scope="col">#</th><th scope="col">Hayvan adı</th><th scope="col">Tür</th><th scope="col">Durum</th></tr></thead><tbody>';
        foreach (array_slice($items,$offset,self::PAGE_SIZE,true) as $key=>$item) {
            $live=!empty($item['visible'])&&!empty($item['consent'])&&!empty($item['image'])&&$site['published']&&$site['control_status']!=='paused';
            $html.='<tr><td>'.(++$offset).'</td><th scope="row"><a href="'.self::e($url($page).'&id='.$key).'#gallery-editor">'.self::e($item['name']).'</a></th>'.
                '<td>'.self::e(WebBuilder::gallerySpecies($item)).'</td><td><span class="publish-state'.($live?' live':'').'">'.($live?'Yayında':'Taslak').'</span></td></tr>';
        }
        $last=max(1,(int)ceil(count($items)/self::PAGE_SIZE));
        return $html.'</tbody></table></div>'.self::pagination($page,$last,static fn($n)=>$url($n).'#gallery-list').'</section>';
    }

    private function blogPanel(array $site,array $draft,array $get,array $submitted): string
    {
        [, $fields]=self::GROUPS['blog'];
        $posts=array_reverse($draft['blog']??[],true);
        uasort($posts,static fn($a,$b)=>strcmp($b['createdAt']??$b['date']??'',$a['createdAt']??$a['date']??''));
        $last=max(1,(int)ceil(count($posts)/self::PAGE_SIZE));
        $page=min($last,self::pageNumber($get['sayfa']??1));
        $offset=($page-1)*self::PAGE_SIZE;
        $results=array_slice($posts,$offset,self::PAGE_SIZE,true);
        $views=$this->web->articleViews($site['partner_id'],array_keys($results));
        $id=is_string($get['id']??null)&&isset($posts[$get['id']])?$get['id']:'';
        $record=array_replace($posts[$id]??[],$submitted);
        $active=isset($submitted['action'])?self::selected($submitted['visible']??null):($record['visible']??true);
        $url=static fn($n)=>'?tab=blog&sayfa='.$n;
        $hidden='<input type="hidden" name="id" value="'.self::e($id).'"><input type="hidden" name="sayfa" value="'.$page.'">';
        $options='<option value="">Kategori seçilmedi</option>';
        foreach (WebBuilder::blogCategories($draft) as $category) {
            $options.='<option value="'.self::e($category).'"'.(($record['category']??'')===$category?' selected':'').'>'.self::e($category).'</option>';
        }
        $tools='<div class="format-toolbar wide" role="group" aria-label="İçerik biçimlendirme">';
        foreach (['bold'=>'Kalın','italic'=>'İtalik','underline'=>'Altı çizili','heading'=>'Alt başlık','list'=>'Madde listesi'] as $tool=>$label) {
            $tools.='<button type="button" class="secondary" data-format="'.$tool.'">'.$label.'</button>';
        }
        $tools.='</div>';
        $form=$this->form('blog',$site,$hidden.self::fields(['title'=>'Başlık','summary'=>'Kısa özet'],$record,['title']).$tools.
            self::fields(['body'=>'İçerik'],$record).'<fieldset class="wide post-details"><legend>Yayın bilgileri</legend>'.
            '<label>Kategori<select name="category">'.$options.'</select></label><p><a href="?tab=kategoriler">Blog kategorilerini yönet</a></p>'.
            self::fields(array_intersect_key($fields,array_flip(['tags','date','seoTitle','seoDescription']))+['alt'=>'Görsel açıklaması'],$record).
            $this->file('image','Kapak görseli',$record).self::check('visible','Yayına dâhil et',$active).'</fieldset>','','save',true);
        $html='<section id="blog-editor" class="post-editor"><div class="section-heading"><div><h2>'.($id?'Yazıyı düzenle':'Yeni yazı').'</h2>'.
            ($id?'<p class="hint">'.self::e($posts[$id]['title']).'</p>':'').'</div>'.
            ($id?'<a class="button secondary" href="'.self::e($url($page)).'#blog-editor">+ Yeni yazı</a>':'').'</div>'.$form.
            ($id?'<details class="post-delete"><summary>Silme seçenekleri</summary>'.
                $this->form('blog',$site,$hidden,'<button class="danger">Yazıyı sil</button>','delete').'</details>':'').'</section>'.
            '<section class="management-list" id="blog-list"><div class="section-heading"><h2>Eklenen yazılar</h2><span class="list-count">'.count($posts).' yazı</span></div>';
        if (!$results) return $html.'<p class="list-empty">Henüz yazı eklenmemiş.</p></section>';
        $html.='<div class="table-scroll" tabindex="0" role="region" aria-label="Eklenen yazılar"><table class="management-table"><thead><tr>'.
            '<th scope="col">#</th><th scope="col">Başlık</th><th scope="col">Ekleyen</th><th scope="col">Eklenme tarihi</th><th scope="col">Okunma</th><th scope="col">Durum</th>'.
            '</tr></thead><tbody>';
        foreach ($results as $postId=>$post) {
            $live=!empty($post['visible'])&&$post['date']<=WebBuilder::today()&&$site['published']&&$site['control_status']!=='paused';
            $status=$live?'Yayında':(!empty($post['visible'])&&$post['date']>WebBuilder::today()?'Planlandı':'Taslak');
            $added=empty($post['createdAt'])?'—':(new \DateTimeImmutable($post['createdAt']))->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('d.m.Y H:i');
            $html.='<tr'.($id===$postId?' class="selected-post"':'').'><td>'.(++$offset).'</td><th scope="row"><a href="'.
                self::e($url($page).'&id='.$postId).'#blog-editor">'.self::e($post['title']).'</a>'.
                (!empty($post['category'])?'<small>'.self::e($post['category']).'</small>':'').'</th><td>'.self::e($post['createdBy']??'—').
                '</td><td>'.$added.'</td><td class="view-count">'.number_format($views[$postId]??0,0,',','.').'</td>'.
                '<td><span class="publish-state'.($live?' live':'').'">'.$status.'</span></td></tr>';
        }
        return $html.'</tbody></table></div>'.self::pagination($page,$last,static fn($n)=>$url($n).'#blog-list').'</section>';
    }

    private function mediaPanel(array $site,array $get): string
    {
        $partner=$site['partner_id'];
        $count=(int)$this->web->query('SELECT COUNT(*) FROM clinic_web_media WHERE partner_id=?',[$partner])->fetchColumn();
        if (!$count) return '<p>Henüz yüklenmiş görsel yok.</p>';
        $last=(int)ceil($count/24);
        $page=max(1,min($last,(int)($get['sayfa']??1)));
        $offset=($page-1)*24;
        $rows=$this->web->query('SELECT id,OCTET_LENGTH(bytes) AS size FROM clinic_web_media WHERE partner_id=? ORDER BY id LIMIT 24 OFFSET '.$offset,[$partner])->fetchAll();
        $html='<p class="hint">Görseli silerseniz sitedeki kullanımları ve eski yayın sürümlerindeki kopyaları kaldırılır.</p><div class="media-grid">';
        foreach ($rows as $row) {
            $id=self::e($row['id']);
            $html.='<article><img loading="lazy" alt="" src="'.self::e($this->editor).'/medya/'.$id.'"><p>'.
                number_format((int)$row['size']/1000,0,',','.').' KB</p>'.
                $this->form('medya',$site,'<input type="hidden" name="media_id" value="'.$id.'">'.
                    '<label class="check wide"><input type="checkbox" name="confirm_media" value="yes" required>Kalıcı silmeyi onaylıyorum</label>',
                    '<button class="danger">Görseli sil</button>','delete').'</article>';
        }
        $html.='</div><div class="controls">';
        if ($page>1) $html.='<a href="?tab=medya&amp;sayfa='.($page-1).'">Önceki</a>';
        if ($page<$last) $html.='<a href="?tab=medya&amp;sayfa='.($page+1).'">Sonraki</a>';
        return $html.'</div>';
    }
    private function publication(array $site,array $d,array $get): string
    {
        $issues=WebBuilder::publishIssues($d);
        $preview='<div class="controls">';
        foreach (['desktop'=>'Masaüstü','tablet'=>'Tablet','mobile'=>'Mobil'] as $mode=>$label) $preview.='<a class="button secondary" href="?tab=yayin&amp;view='.$mode.'">'.$label.' önizleme</a>';
        $preview.=!empty($d['booking']['enabled'])?'<a class="button secondary" href="'.self::e($this->editor).'/onizleme/randevu">Randevu bağlantısını dene</a></div>':'</div>';
        if (in_array($get['view']??'',['desktop','tablet','mobile'],true)) {
            $preview.='<iframe class="preview '.self::e($get['view']).'" title="Taslak site önizlemesi" src="'.self::e($this->editor).'/onizleme"></iframe>';
        }
        $addr=self::e($this->web->base($site));
        $body=$preview.'<p>Yayın adresi: <a href="'.$addr.'">'.$addr.'</a></p><p>'.
            ($issues?self::e(implode(' ',$issues)):'Yayın için zorunlu bilgiler tamam. Randevu açık ise şube saatlerini önizlemede kontrol edin.').'</p>';
        $body.=$this->form('yayin',$site,'','<button'.($issues?' disabled':'').'>Yayınla</button>','publish');
        if ($site['published']) $body.=$this->form('yayin',$site,'','<button class="secondary">Yayından kaldır</button>','unpublish');
        $standard=self::e($this->web->standardUrl($site));
        $host=$site['custom_host']?:'www.klinikadiniz.com';
        if (($get['yayinda']??'')==='1' && $site['published']) {
            $body.='<p class="publish-guide-status" role="status">Siteniz yayımlandı. <a href="'.$addr.'">Yayındaki siteyi aç</a></p>';
        }
        $body.='<section class="domain-guide" aria-labelledby="domain-title"><h2 id="domain-title">Sitenizi kendi alan adınızla açın</h2>'.
            '<div class="domain-examples"><div><strong>VetZimo adresiniz</strong><a href="'.$standard.'">'.$standard.'</a></div>'.
            '<div><strong>Özel alan adıyla görünüm</strong><code>https://'.self::e($host).'/iletisim</code></div></div>'.
            '<ol class="domain-steps"><li><strong>1. Alan adını kaydedin</strong><p>Kullanacağınız adresi aşağıya yazın. Örneğin www.klinikadiniz.com.</p></li>'.
            '<li><strong>2. DNS ve HTTPS kurulumunu yapın</strong><p>Hosting yöneticinizden alan adını VetZimo yayın sunucusuna bağlamasını ve HTTPS sertifikasını etkinleştirmesini isteyin. DNS hedefini hosting yöneticinizden alın. Özel adresin VetZimo yayın ayarlarına eklenmesini isteyin.</p></li>'.
            '<li><strong>3. Sahipliği doğrulayın</strong><p>Aşağıda verilen TXT kaydını alan adı sağlayıcınızın DNS paneline ekleyin. Ardından bu ekrandan doğrulayın.</p></li></ol>';
        $body.=$this->form('yayin',$site,self::fields(['host'=>'Özel alan adı'],['host'=>$site['custom_host']]),'<button>Alan adını kaydet</button>','domain');
        if ($site['custom_host']) $body.='<dl class="dns-record"><div><dt>Tür</dt><dd>TXT</dd></div><div><dt>Ad</dt><dd><code>_vetnet.'.self::e($site['custom_host']).'</code></dd></div>'.
            '<div><dt>Değer</dt><dd><code>vetnet='.self::e($site['domain_token']).'</code></dd></div></dl>'.
            '<p>'.($site['domain_verified']?'DNS doğrulandı.':'DNS doğrulaması bekliyor.').'</p>'.
            $this->form('yayin',$site,'','<button class="secondary">DNS kaydını doğrula</button>','verify');
        $body.='<p class="hint">Hem www hem de www içermeyen adresi kullanacaksanız, birini bu ekranda kaydedin. Diğerini hosting panelinden kaydettiğiniz adrese yönlendirin.</p></section>';
        $select='';
        foreach ($this->web->query('SELECT id,created_at FROM clinic_web_release WHERE partner_id=? ORDER BY id DESC LIMIT 30',[$site['partner_id']])->fetchAll() as $row) {
            $select.='<option value="'.(int)$row['id'].'">#'.(int)$row['id'].' · '.self::e($row['created_at']).'</option>';
        }
        return $body.($select?$this->form('yayin',$site,'<label>Önceki sürüm<select name="release">'.$select.'</select></label>','<button class="secondary">Bu sürümü yayımla</button>','rollback'):'');
    }
    private function statistics(array $site): string
    {
        $partner=$site['partner_id'];
        $state=$this->web->workspace($partner);
        $appointments=array_column($state->appointments??[],null,'id');
        $ids=$this->web->query('SELECT id FROM clinic_web_appointment WHERE partner_id=? AND created_at>=CURRENT_DATE-INTERVAL 29 DAY',[$partner])->fetchAll(\PDO::FETCH_COLUMN);
        $approved=count(array_filter($ids,static fn($id)=>in_array($appointments[$id]->status??'',['Onaylandı','Tamamlandı','Muayenede'],true)));
        $labels=['visits'=>'Yaklaşık ziyaretler','requests'=>'Randevu talepleri','contact'=>'İletişim mesajları','calls'=>'Telefon tıklamaları','directions'=>'Yol tarifi tıklamaları','page:randevu'=>'Randevu formu görüntülemeleri'];
        $counts=[];
        $pageRows=[];
        foreach ($this->web->query("SELECT metric,SUM(n) AS total FROM clinic_web_daily WHERE partner_id=? AND day>=CURRENT_DATE-INTERVAL 29 DAY AND metric NOT LIKE 'article:%' GROUP BY metric ORDER BY total DESC",[$partner])->fetchAll() as $row) {
            $key=$row['metric'];
            $counts[$key]=(int)$row['total'];
            if (str_starts_with($key,'page:')) $pageRows[$key]=$counts[$key];
        }
        $html='<section class="management-list"><div class="section-heading"><h2>Site istatistikleri</h2><span class="list-count">Son 30 gün</span></div><dl class="stat-pills">';
        $metrics=['Onaylanan randevu'=>$approved,'Sayfa görüntülemeleri'=>array_sum($pageRows)];
        foreach ($labels as $key=>$label) $metrics[$label]=$counts[$key]??0;
        foreach ($metrics as $label=>$value) $html.='<div><dt>'.self::e($label).'</dt><dd>'.number_format($value,0,',','.').'</dd></div>';
        $html.='</dl>';
        if ($pageRows) {
            $html.='<details><summary>Sayfalara göre görüntüleme</summary><ul class="report">';
            foreach ($pageRows as $key=>$value) {
                $path=substr($key,5);
                $html.='<li>'.self::e(WebBuilder::PAGES[$path]??$path).' <strong>'.number_format($value,0,',','.').'</strong></li>';
            }
            $html.='</ul></details>';
        }
        $html.='</section><section class="management-list"><h2>İletişim ve randevu hareketleri</h2><details><summary>İletişim mesajları</summary>';
        foreach ($this->web->query('SELECT message,created_at,notified_at,notify_at,notify_error FROM clinic_web_inbox WHERE partner_id=? ORDER BY id DESC LIMIT 100',[$partner])->fetchAll() as $row) {
            $msg=WebBuilder::decode($row['message']);
            $html.='<article class="message"><h3>'.self::e($msg['name']).'</h3><small>'.self::e($row['created_at'].' · '.$msg['email']).'</small><p>'.nl2br(self::e($msg['body'])).'</p>'.
                ($row['notify_at']?'<small>E-posta: '.($row['notified_at']?'Gönderildi':self::e($row['notify_error']?:'Sırada')).'</small>':'').'</article>';
        }
        $html.='</details><details><summary>Randevu e-postaları</summary><ul class="report">';
        foreach ($this->web->query('SELECT appointment_id,attempts,sent_at,last_error FROM clinic_web_mail WHERE partner_id=? ORDER BY next_at DESC LIMIT 50',[$partner])->fetchAll() as $row) {
            $html.='<li><a href="/klinik#record/appointments/'.rawurlencode($row['appointment_id']).'">Randevu</a> · '.
                ($row['sent_at']?'Gönderildi':self::e($row['last_error']?:'Sırada')).' · '.(int)$row['attempts'].' deneme</li>';
        }
        $html.='</ul></details><details><summary>Randevu işlem geçmişi</summary><ul class="report">';
        foreach ($this->web->query('SELECT appointment_id,actor_name,actor_role,event,occurred_at FROM clinic_web_appointment_event WHERE partner_id=? ORDER BY id DESC LIMIT 50',[$partner])->fetchAll() as $row) {
            $change=WebBuilder::decode($row['event'])['after'];
            $when=new \DateTimeImmutable($row['occurred_at'],new \DateTimeZone('UTC'));
            $html.='<li><a href="/klinik#record/appointments/'.rawurlencode($row['appointment_id']).'">Randevu</a> · '.self::e($change['status']??'').
                ' · '.self::e($row['actor_name'].' ('.$row['actor_role'].')').' · '.$when->setTimezone(new \DateTimeZone('Europe/Istanbul'))->format('d.m.Y H:i').'</li>';
        }
        return $html.'</ul></details></section>';
    }
}
