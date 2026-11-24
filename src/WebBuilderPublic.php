<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

final class WebBuilderPublic
{
    public function __construct(private readonly WebBuilder $web,private readonly WebBooking $booking,private readonly array $config) {}

    private static function e(mixed $value): string { return WebBuilderAdmin::e($value); }
    private static function label(array $draft,string $page): string
    {
        return ($draft['content'][$page]['title']??'')?:WebBuilder::PAGES[$page];
    }
    private static function href(string $base,string $page=''): string
    {
        return self::e($base.($page===''?'':'/'.$page));
    }
    private static function formatted(string $text): string
    {
        $escaped=self::e($text);
        $allowed=['b'=>'strong','i'=>'em','u'=>'u'];
        for ($i=0;$i<8;$i++) {
            $formatted=preg_replace_callback('~\[([biu])\]((?:(?!\[/?[biu]\]).)*)\[/\1\]~u',
                static fn($match)=>'<'.$allowed[$match[1]].'>'.$match[2].'</'.$allowed[$match[1]].'>',$escaped);
            if ($formatted===null || $formatted===$escaped) break;
            $escaped=$formatted;
        }
        return preg_replace_callback('~\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*~u',
            static function($match) {
                if (!empty($match[3])) return '<em>'.$match[3].'</em>';
                if (!empty($match[2])) return '<u>'.$match[2].'</u>';
                return '<strong>'.$match[1].'</strong>';
            },$escaped)??$escaped;
    }
    private static function rich(string $text): string
    {
        $out='';$list=false;
        foreach (preg_split('/\R/',$text) as $line) {
            $line=trim($line);
            if (str_starts_with($line,'- ')) {
                if (!$list) {$out.='<ul>';$list=true;}
                $out.='<li>'.self::formatted(substr($line,2)).'</li>';
                continue;
            }
            if ($list) {$out.='</ul>';$list=false;}
            if ($line==='') continue;
            $out.=str_starts_with($line,'## ')?'<h3>'.self::formatted(substr($line,3)).'</h3>':'<p>'.self::formatted($line).'</p>';
        }
        return $out.($list?'</ul>':'');
    }
    private static function image(array $row,string $media,string $class='',bool $hero=false,string $theme='modern'): string
    {
        $url=!empty($row['image'])?$media.$row['image']:($hero?($theme==='modern'?'/web-builder-hero.webp':'/web-themes/'.$theme.'-hero.webp'):'');
        if (!$url) return '';
        return '<img class="'.self::e($class).'" src="'.self::e($url).'" alt="'.self::e($row['alt']??'').'" decoding="async"'.($hero?' fetchpriority="high"':' loading="lazy"').'>';
    }
    private static function records(array $draft,string $type,bool $preserveKeys=false): array
    {
        $rows=array_filter($draft[$type]??[],static fn($r)=>!empty($r['visible']) &&
            ($type!=='blog' || $r['date']<=WebBuilder::today()) && ($type!=='gallery' || (!empty($r['consent']) && !empty($r['image']))));
        uasort($rows,$type==='blog'?static fn($a,$b)=>strcmp($b['date'],$a['date']):static fn($a,$b)=>$a['position']<=>$b['position']);
        return $preserveKeys?$rows:array_values($rows);
    }
    private static function excerpt(string $text): string
    {
        $text=preg_replace('~\[/?[biu]\]|\*{1,2}|__~','',$text);
        $text=trim(preg_replace('/\s+/u',' ',preg_replace('/^\s*(?:##|- )/m','',$text)));
        if (!preg_match('/\A(.{140,160})(?=\s)(?=.+)/u',$text,$match) &&
            !preg_match('/\A(.{160})./u',$text,$match)) return $text;
        return rtrim($match[1]).'…';
    }
    private static function availability(array $hours,array $holidays): string
    {
        if (!array_filter($hours)) return '';
        $now=new \DateTimeImmutable('now',new \DateTimeZone('Europe/Istanbul'));
        $clock=$now->format('H:i');
        $open=false;
        if (!in_array($now->format('Y-m-d'),$holidays,true)) {
            foreach ($hours[(int)$now->format('N')]??[] as [$start,$end]) {
                if ($clock>=$start && $clock<$end) {$open=true;break;}
            }
        }
        return '<span class="open-state'.($open?' open':' closed').'" data-hours="'.self::e(WebBuilder::json($hours)).
            '" data-holidays="'.self::e(WebBuilder::json($holidays)).'">'.($open?'Şu an açığız':'Maalesef kapalıyız').'</span>';
    }
    private static function cards(array $items,string $type,string $base,string $media): string
    {
        if (!$items) return '';
        $html='<div class="cards cards-'.self::e($type).'">';
        foreach ($items as $row) {
            $pic=self::image($row,$media);
            if ($type==='gallery' && $pic) $pic='<a class="gallery-photo" href="'.self::e($media.$row['image']).'" data-gallery>'.$pic.'<span>Fotoğrafı büyüt</span></a>';
            $title=self::e($row['name']??$row['title']);
            $detail=match($type){'blog'=>self::excerpt($row['summary']?:$row['body']),'team'=>trim($row['title'].' · '.$row['specialty'],' ·'),'gallery'=>$row['species'],default=>''};
            $html.='<article>'.$pic.'<div class="card-body"><h3>'.($type==='blog'?'<a href="'.self::href($base,'blog/'.$row['slug']).'">'.$title.'</a>':$title).
                '</h3>'.($detail?'<p>'.self::e($detail).'</p>':'').
                ($type!=='blog'?self::rich($row['body']):'<small><time datetime="'.self::e($row['date']).'">'.self::e($row['date']).'</time></small>').
                ($type==='blog'?'<a class="read-link" href="'.self::href($base,'blog/'.$row['slug']).'">Yazıyı Oku <span aria-hidden="true">↗</span></a>':'').
                (!empty($row['link'])?'<a href="'.self::e($row['link']).'">Profil bağlantısı</a>':'').'</div></article>';
        }
        return $html.'</div>';
    }
    private static function icon(string $name): string
    {
        $path=match($name) {
            'phone'=>'M6 2h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4a3 3 0 0 1-3 3C10 21 3 14 3 5a3 3 0 0 1 3-3z',
            'mail'=>'M2 5h20v14H2z M2 5l10 8 10-8',
            'instagram'=>'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M17 7h.01',
            'facebook'=>'M14 21v-8h3l.6-3H14V8c0-1 .5-2 2-2h2V3h-3c-3 0-5 2-5 5v2H7v3h3v8',
            'social'=>'M10 13a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7 M14 11a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7',
            'directions'=>'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
            'whatsapp'=>'M21 11.5a9 9 0 0 1-13.5 8L3 21l1.5-4.4A9 9 0 1 1 21 11.5z M9 7l2 3-1 1c1 2 2 3 4 3l1-1 2 1c0 2-1 3-3 2-3-1-6-4-7-7 0-1 1-2 2-2z',
        };
        return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'.$path.'"/></svg>';
    }
    private static function callLink(string $number,string $base,bool $track,bool $hero=false): string
    {
        return '<a class="'.($hero?'button hero-action':'contact-icon').'" href="tel:'.self::e($number).'" aria-label="Ara"'.
            ($track?' data-call-metric="'.self::href($base,'t/telefon').'?count=yes"':'').'>'.self::icon('phone').($hero?' Ara':'').'</a>';
    }
    private function contact(array $site,array $d,string $base,bool $preview): string
    {
        $c=$d['contact'];$links='';
        if (!empty($c['phone'])) $links.=self::callLink($c['phone'],$base,!$preview);
        if (!empty($c['whatsapp'])) $links.='<a class="contact-icon" aria-label="WhatsApp" href="https://wa.me/'.self::e(ltrim($c['whatsapp'],'+')).'">'.self::icon('whatsapp').'</a>';
        if (!empty($c['email'])) $links.='<a class="contact-icon" aria-label="E-posta" href="mailto:'.self::e($c['email']).'">'.self::icon('mail').'</a>';
        foreach (['instagram'=>'Instagram','facebook'=>'Facebook','social'=>'Sosyal medya','directions'=>'Yol tarifi al'] as $key=>$label) {
            if (empty($c[$key])) continue;
            $url=$key==='directions'&&!$preview?self::href($base,'t/yol-tarifi'):self::e($c[$key]);
            $links.='<a class="contact-icon" aria-label="'.$label.'" title="'.$label.'" href="'.$url.'">'.self::icon($key).'</a>';
        }
        $branches='';
        foreach ($this->web->branches($site['partner_id']) as $branch) {
            $hours=$d['booking']['hours'][$branch->id]??[];
            $details=$c['branches'][$branch->id]??[];
            if (!array_filter($hours) && !array_filter($details)) continue;
            $branches.='<article class="branch-hours-card"><div class="branch-hours-heading"><h3>'.self::e($branch->name).'</h3>'.self::availability($hours,$d['booking']['holidays']??[]).'</div>';
            if (!empty($details['address'])) $branches.='<p><strong>Adresimiz:</strong> '.self::e($details['address']).'</p>';
            if (!empty($details['phone'])) $branches.=self::callLink($details['phone'],$base,false);
            if (!empty($details['directions'])) $branches.='<p><a href="'.self::e($details['directions']).'">Şubeye yol tarifi al</a></p>';
            if (array_filter($hours)) {
                $branches.='<h4>Çalışma saatleri</h4><dl>';
                foreach(WebBuilder::DAYS as $day=>$label) $branches.='<div><dt>'.$label.'</dt><dd>'.
                    self::e(implode(' / ',array_map(static fn($r)=>implode('–',$r),$hours[$day]??[]))?:'Kapalı').'</dd></div>';
                $branches.='</dl>';
            }
            $branches.='</article>';
        }
        $address=!empty($c['address'])?'<div class="contact-address"><strong>Adresimiz:</strong><p>'.self::e($c['address']).'</p></div>':'';
        $map=!empty($c['maps'])?'<section class="contact-map"><h3>Harita</h3><iframe class="map" loading="lazy" title="Klinik konumu" src="'.self::e($c['maps']).'" referrerpolicy="no-referrer"></iframe></section>':'';
        if (!$address && !$links && !$branches && !$map) return '';
        return '<div class="contact-panel">'.
            ($address||$links?'<div class="contact-summary">'.$address.($links?'<div class="actions" aria-label="İletişim seçenekleri">'.$links.'</div>':'').'</div>':'').
            ($branches||$map?'<div class="contact-columns'.($branches&&$map?' has-both':'').'">'.
                ($branches?'<div class="contact-hours">'.$branches.'</div>':'').$map.'</div>':'').'</div>';
    }

    private function numbers(array $site,array $draft): string
    {
        $settings=$draft['numbers']??[];
        $totals=$this->web->clinicNumbers($site['partner_id'],$draft);
        $cards='';
        foreach (WebBuilder::NUMBERS as $key=>$label) {
            $item=$settings['items'][$key]??[];
            if (empty($item['visible'])) continue;
            $value=$item['value']??'';
            if ($value==='') {
                if ($totals[$key]===null) continue;
                $value=number_format($totals[$key],0,',','.');
            }
            $cards.='<div><dt>'.self::e(($item['label']??'')?:$label).'</dt><dd>'.self::e($value).'</dd></div>';
        }
        return $cards?'<section class="block clinic-numbers"><h2>'.self::e(($settings['title']??'')?:WebBuilder::SECTIONS['numbers']).
            '</h2><dl>'.$cards.'</dl></section>':'';
    }

    private function home(array $site,array $d,string $base,string $media,bool $preview): string
    {
        $page=$d['content']['']??[];$about=$d['content']['hakkimizda']??[];
        $title=self::e(self::label($d,'')==='Ana Sayfa'?$d['identity']['name']:self::label($d,''));
        $intro=self::e(($page['summary']??'')?:($d['identity']['slogan']?:$d['identity']['description']));
        $city=implode(' / ',array_filter([$d['identity']['city'],$d['identity']['district']]));
        $hours=[];
        foreach ($this->web->branches($site['partner_id']) as $branch) {
            foreach ($d['booking']['hours'][$branch->id]??[] as $day=>$ranges) {
                $hours[$day]=array_merge($hours[$day]??[],$ranges);
            }
        }
        $availability=self::availability($hours,$d['booking']['holidays']??[]);
        $action=!empty($d['booking']['enabled'])?'<a class="button hero-action" href="'.self::href($base,'randevu').'">Randevu al</a>':'';
        $phone=$d['contact']['phone']??'';
        if ($phone!=='') $action.=self::callLink($phone,$base,!$preview,true);
        $copy='<div class="hero-copy">'.($city?'<p class="location">'.self::e($city).'</p>':'').'<h1>'.$title.'</h1>'.
            ($intro?'<p class="intro">'.$intro.'</p>':'').($action||$availability?'<div class="hero-cta">'.$action.$availability.'</div>':'').'</div>';
        $focus=$page['focus']??'center';
        $focus=in_array($focus,['left','right','top','bottom'],true)||(!empty($page['image'])&&$focus==='center')?' hero-focus-'.$focus:'';
        $picture=self::image($page,$media,'hero-image'.$focus,true,$d['theme']);
        $layout=match($d['theme']){'premium'=>'hero-cover','pati'=>'hero-story','medikal'=>'hero-index',default=>'hero-split'};
        // Süsleme katmanı: her tema kendi hareketli öğelerini gösterir (lekeler, pati izleri, EKG çizgisi, altın çizgi).
        $decor='<div class="hero-decor" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i>'.
            '<svg class="hero-ecg" viewBox="0 0 320 60" preserveAspectRatio="none" focusable="false"><path d="M0 34h96l8-14 10 30 12-44 10 40 8-12h176"/></svg></div>';
        $html='<section class="site-hero '.$layout.'">'.$decor.'<div class="hero-media">'.$picture.'</div>'.$copy.'</section>';
        if (!empty($page['body'])) $html.='<div class="prose">'.self::rich($page['body']).'</div>';
        $services=preg_split('/\R/',$about['services']??'',-1,PREG_SPLIT_NO_EMPTY);
        foreach ($d['sections'] as $section) {
            if ($section==='numbers') {
                $html.=$this->numbers($site,$d);
                continue;
            }
            $inner=match($section) {
                'services'=>$services?'<ul class="services"><li>'.implode('</li><li>',array_map(self::e(...),$services)).'</li></ul>':'',
                'team'=>self::cards(array_slice(self::records($d,'team'),0,3),'team',$base,$media),
                'gallery'=>self::cards(array_slice(self::records($d,'gallery'),0,3),'gallery',$base,$media),
                'blog'=>self::cards(array_slice(self::records($d,'blog'),0,3),'blog',$base,$media),
                'contact'=>$this->contact($site,$d,$base,$preview),
                default=>'',
            };
            if ($inner) $html.='<section class="block section-'.$section.'"><h2>'.self::e(WebBuilder::SECTIONS[$section]).'</h2>'.$inner.'</section>';
        }
        return $html;
    }
    private function mathInput(array $site,string $action='randevu'): string
    {
        $math=WebBooking::mathQuestion($action==='iletisim'?'contact:'.$site['partner_id']:$site['partner_id'],$this->config['rateSecret'],time());
        return '<label>Güvenlik sorusu · '.self::e($math['label']).'<input name="security_answer" inputmode="numeric" required maxlength="2" pattern="[0-9]{1,2}" autocomplete="off"></label>'.
            '<input type="hidden" name="security_token" value="'.self::e($math['token']).'">';
    }

    private function appointment(array $site,array $d,string $base,array $get,?array $customer,bool $preview): string
    {
        $branch=is_string($get['branch']??null)?$get['branch']:'';
        $day=is_string($get['date']??null)?$get['date']:WebBuilder::today();
        $edit=!$preview&&is_string($get['duzenle']??null)?$get['duzenle']:'';
        $primary='/web/'.$site['slug'].'/randevu';
        $return=WebBooking::returnPath($primary.'?'.http_build_query(['branch'=>$branch,'date'=>$day,'duzenle'=>$edit]))??$primary;
        $local=$base===$this->config['origin'].'/web/'.$site['slug'];
        $url=self::href($base,'randevu');
        $owner=null;$patients=[];$current=null;$revision='';$html='';
        if (!$preview && ($customer['role']??'')==='customer') {
            [$owner,$patients]=$this->booking->formIdentity($site['partner_id'],$customer);
        }
        if (!$preview && !$owner) {
            $link=$local?'/app?'.http_build_query(['donus'=>$return]):$this->config['origin'].$return;
            $html='<p class="booking-notice"><a class="button outline" href="'.self::e($link).'">'.
                ($local?'VetZimo hesabıyla giriş yap':'Randevuyu VetZimo’da aç').'</a>'.
                ($edit===''?' Ziyaretçi olarak da randevu alabilirsiniz.':'').'</p>';
            if ($edit!=='' && !$customer) return $html;
        }
        if ($edit!=='') {
            try {
                [$current,$branch]=$this->booking->ownerAppointment($site,$customer,$edit);
            } catch (RuntimeException $error) {
                if ($error->getCode()!==404) throw $error;
                return '<p class="booking-notice">Bu hesaba bağlı düzenlenebilir bir randevu bulunamadı. <a href="/hasta-sahibi">Randevularım</a></p>';
            }
            $revision=WebBooking::changeVersion($current);
            if (!WebBooking::changeable($current)) return '<p class="booking-notice">Bu randevu artık düzenlenemiyor. <a href="/hasta-sahibi">Randevularım</a></p>';
            if (!isset($get['date']) || $get['date']==='') $day=$current->date;
            $html.='<section class="booking-tools"><h2>Mevcut randevu</h2><p>'.self::e($current->date.' · '.$current->time.' · '.$current->service).'</p>'.
                '<a href="/hasta-sahibi">Randevularım</a><details><summary>Randevuyu iptal et</summary><form class="public-form" method="post" action="'.$url.'">'.
                '<input type="hidden" name="action" value="cancel"><input type="hidden" name="duzenle" value="'.self::e($edit).'">'.
                '<input type="hidden" name="change_version" value="'.$revision.'">'.$this->mathInput($site).
                '<button class="button outline">İptali onayla</button></form></details></section>';
        }
        if (empty($d['booking']['enabled'])) return $html.'<p>Çevrimiçi randevu şu anda kapalı. <a href="'.self::href($base,'iletisim').'">Kliniğe ulaşın</a>.</p>';
        $branches=array_values(array_filter($this->web->branches($site['partner_id']),static fn($row)=>in_array($row->id,$d['booking']['branches'],true)));
        if (count($branches)===1) $branch=$branches[0]->id;
        if ($branch==='') {
            $preferred=$customer['branch_id']??'';
            if ($owner && in_array($preferred,array_column($branches,'id'),true)) $branch=$preferred;
        }
        $options='<option value="">Şube seçin</option>';
        $dataBranch='';
        foreach ($branches as $row) {
            $selected=$row->id===$branch;
            if ($selected) $dataBranch=($row->sharedWith??'')?:$row->id;
            $options.='<option value="'.self::e($row->id).'"'.($selected?' selected':'').'>'.self::e($row->name).'</option>';
        }
        $branchField=count($branches)===1
            ? '<input type="hidden" name="branch" value="'.self::e($branch).'"><p><strong>'.self::e($this->web->partnerName($site['partner_id'])).'</strong></p>'
            : '<label>Şube<select name="branch" required>'.$options.'</select></label>';
        $team=$branch!==''&&!$current?$this->booking->staffOptions($site,$d,$branch):[];
        $staff=is_string($get['staff']??null)&&isset($team[$get['staff']])?$get['staff']:'';
        $staffField='';
        if ($team) {
            $staffField='<label>Hekim / personel<select name="staff"><option value="">Fark etmez · ilk uygun kişi</option>';
            foreach ($team as $id=>$name) $staffField.='<option value="'.self::e((string)$id).'"'.((string)$id===$staff?' selected':'').' data-ui-preserve>'.self::e($name).'</option>';
            $staffField.='</select></label>';
        }
        $html.='<form class="public-form slot-form" method="get" action="'.$url.'">'.
            ($current?'<input type="hidden" name="duzenle" value="'.self::e($edit).'">':$branchField.$staffField).
            '<label>'.($current?'Yeni randevu tarihi':'Randevu tarihi').'<input type="date" name="date" required min="'.WebBuilder::today().'" value="'.self::e($day).'"></label>'.
            '<button class="button">Uygun saatleri göster</button></form>';
        if ($branch==='') return $html;
        $slots=$current?$this->booking->slots($site,$d,$branch,$day,null,$this->booking->staffFor($site,$d,$branch,$current->clinician??''),$current->id):$this->booking->slots($site,$d,$branch,$day,null,$staff);
        if (!$slots) return $html.'<p class="booking-notice">'.($staff!==''?'Seçilen kişi için bu gün boş saat yok. Başka bir gün ya da “Fark etmez” seçeneğini deneyin.':'Bu şube ve gün için boş saat yok.').'</p>';
        $times='';
        foreach ($slots as $time=>$slot) $times.='<option value="'.self::e($time).'"'.(($get['time']??'')===$time?' selected':'').'>'.self::e($time).
            ($team&&$staff===''?' · '.self::e($slot->clinician):'').'</option>';
        $fields='<input type="hidden" name="branch" value="'.self::e($branch).'"><input type="hidden" name="date" value="'.self::e($day).'">'.
            ($staff!==''?'<input type="hidden" name="staff" value="'.self::e($staff).'"><p class="booking-staff">'.self::e($team[$staff]).'</p>':'').
            '<label>Uygun saat<select name="time" required>'.$times.'</select></label>';
        if ($current) return $html.'<form class="public-form" method="post" action="'.$url.'">'.$fields.
            '<input type="hidden" name="action" value="move"><input type="hidden" name="duzenle" value="'.self::e($edit).'">'.
            '<input type="hidden" name="change_version" value="'.$revision.'">'.$this->mathInput($site).
            '<button class="button">Yeni saati kaydet</button></form>';
        $patientOptions='';
        $selectedPatient=is_string($get['patient_id']??null)?$get['patient_id']:(count($patients)===1?$patients[0]->id:'');
        if ($owner && $owner->branch===$dataBranch) foreach ($patients as $patient) {
            $patientOptions.='<option value="'.self::e($patient->id).'"'.($patient->id===$selectedPatient?' selected':'').'>'.self::e($patient->name).'</option>';
        }
        $identity=$patientOptions?'<label>Kayıtlı hayvan<select name="patient_id" data-patient-picker><option value="">Hayvan bilgilerini kendim yazacağım</option>'.$patientOptions.'</select></label>':'';
        return $html.'<form class="public-form" method="post" action="'.$url.'">'.$fields.$identity.
            '<label>Ad soyad<input name="name" autocomplete="name" maxlength="160" value="'.self::e(self::formValue($get,'name',$owner->name??'')).'" required></label>'.
            '<label>Telefon<input type="tel" name="phone" autocomplete="tel" maxlength="32" value="'.self::e(self::formValue($get,'phone',$owner?WebBuilder::phone($customer['identifier']):'')).'" required></label>'.
            '<label>E-posta (isteğe bağlı)<input type="email" name="email" autocomplete="email" maxlength="254" value="'.self::e(self::formValue($get,'email',$owner->email??'')).'"></label>'.
            '<label>Hayvan adı<input name="animal" maxlength="160" data-visitor-field value="'.self::e(self::formValue($get,'animal')).'"></label>'.
            '<label>Hayvan türü<input name="species" maxlength="80" data-visitor-field value="'.self::e(self::formValue($get,'species')).'"></label>'.
            '<label>Ziyaret nedeni<input name="service" maxlength="250" value="'.self::e(self::formValue($get,'service')).'" required></label>'.
            '<label class="wide">Ek açıklama<textarea maxlength="1500" name="notes">'.self::e(self::formValue($get,'notes')).'</textarea></label>'.
            '<div class="trap" aria-hidden="true"><label>Bu alanı boş bırakın<input name="website" tabindex="-1" autocomplete="off"></label></div>'.
            '<details class="wide"><summary>KVKK aydınlatma metni</summary>'.self::rich($d['booking']['privacy']).'</details>'.
            '<label class="check wide"><input type="checkbox" name="consent" value="yes" required'.(($get['consent']??'')==='yes'?' checked':'').'>Aydınlatma metnini okudum.</label>'.
            $this->mathInput($site).'<button class="button"'.($preview?' disabled':'').'>Randevu talebi gönder</button></form>';
    }

    private static function formValue(array $input,string $key,string $fallback=''): string
    {
        return is_string($input[$key]??null)?$input[$key]:$fallback;
    }
    private static function categoryLinks(array $items,string $base,string $path,string $active,string $search=''): string
    {
        $names=array_unique(array_filter(array_column($items,'category'),static fn($name)=>$name!==''));
        if (!$names) return '';
        sort($names,SORT_NATURAL|SORT_FLAG_CASE);
        $html='<nav class="category-buttons" aria-label="Kategoriler">';
        foreach (['',...$names] as $name) {
            $query=http_build_query(array_filter(['kategori'=>$name,'q'=>$search],static fn($value)=>$value!==''));
            $html.='<a href="'.self::href($base,$path).($query?'?'.self::e($query):'').'"'.
                ($name===$active?' aria-current="page"':'').'>'.self::e($name===''?'Tümü':$name).'</a>';
        }
        return $html.'</nav>';
    }
    private function blog(array $d,string $base,string $media,string $post,array $get): array
    {
        $items=self::records($d,'blog',true);
        if ($post!=='') {
            foreach ($items as $id=>$row) if ($row['slug']===$post) {
                $related=array_values(array_filter($items,static fn($other)=>$other['slug']!==$post));
                usort($related,static fn($a,$b)=>($b['category']===$row['category'])<=>($a['category']===$row['category']));
                $related=array_slice($related,0,3);
                return [$row,'<time datetime="'.self::e($row['date']).'">'.self::e($row['date']).'</time> '.self::e($row['author']).
                    self::image($row,$media,'page-image article-image').'<div class="prose">'.self::rich($row['body']).'</div>'.
                    ($row['tags']?'<p>'.self::e($row['tags']).'</p>':'').($related?'<h2>Benzer blog yazıları</h2>'.self::cards($related,'blog',$base,$media):''),$id];
            }
            return [null,'',null];
        }
        $q=is_string($get['q']??null)?substr($get['q'],0,120):'';
        $category=is_string($get['kategori']??null)?$get['kategori']:'';
        $categories=self::categoryLinks($items,$base,'blog',$category,$q);
        $items=array_values(array_filter($items,static fn($r)=>($category===''||$r['category']===$category) &&
            ($q===''||preg_match('/'.preg_quote($q,'/').'/iu',implode(' ',[$r['title'],$r['summary'],$r['tags']])))));
        $pages=max(1,(int)ceil(count($items)/9));$n=min($pages,max(1,(int)($get['sayfa']??1)));
        $html=$categories.'<form class="public-form blog-search" method="get" action="'.self::href($base,'blog').'"><label>Yazılarda ara<input name="q" value="'.self::e($q).'"></label>'.
            '<input type="hidden" name="kategori" value="'.self::e($category).'"><button class="button">Ara</button></form>'.
            (self::cards(array_slice($items,($n-1)*9,9),'blog',$base,$media)?:'<p>Bu seçime uygun yazı bulunamadı.</p>');
        if ($pages>1) {
            $html.='<nav class="actions" aria-label="Blog sayfaları">';
            foreach (array_unique([1,max(1,$n-1),$n,min($pages,$n+1),$pages]) as $i)
                $html.='<a'.($n===$i?' aria-current="page"':'').' href="'.self::href($base,'blog').'?'.self::e(http_build_query(['q'=>$q,'kategori'=>$category,'sayfa'=>$i])).'">'.$i.'</a>';
            $html.='</nav>';
        }
        return [[], $html,null];
    }
    /** Web sitesi asistanı için yalnızca sitede zaten yayımlanan bilgiler (iç kayıt içermez). */
    private function assistant(array $site,array $d,string $base,bool $preview,bool $homeVisits): string
    {
        if (!($d['settings']['assistant']??true)) return '';
        $c=$d['contact']??[];
        $text=static fn(mixed $value,int $limit=300): string=>is_string($value)?mb_substr(trim($value),0,$limit):'';
        $branches=[];
        foreach ($this->web->branches($site['partner_id']) as $branch) {
            $hours=$d['booking']['hours'][$branch->id]??[];
            $details=$c['branches'][$branch->id]??[];
            if (!array_filter($hours) && !array_filter($details)) continue;
            $branches[]=['name'=>(string)$branch->name,'address'=>$text($details['address']??''),'phone'=>$text($details['phone']??'',40),
                'directions'=>$text($details['directions']??'',600),'hours'=>(object)array_filter($hours)];
        }
        $services=preg_split('/\R/',$text($d['content']['hakkimizda']['services']??'',6000),-1,PREG_SPLIT_NO_EMPTY);
        $data=[
            'clinic'=>$text($d['identity']['name']??''),
            'phone'=>$text($c['phone']??'',40),'whatsapp'=>$text($c['whatsapp']??'',40),'email'=>$text($c['email']??'',254),
            'address'=>$text($c['address']??''),'directions'=>empty($c['directions'])?'':($preview?$text($c['directions'],600):self::href($base,'t/yol-tarifi')),
            'branches'=>$branches,'holidays'=>array_values(array_filter($d['booking']['holidays']??[],'is_string')),
            'services'=>array_values(array_filter(array_slice(array_map(static fn($line)=>trim(ltrim(trim($line),'-•*')),$services),0,60))),
            'note'=>$text($d['settings']['assistantNote']??'',3000),
            'links'=>[
                'booking'=>!empty($d['booking']['enabled'])?self::href($base,'randevu'):'',
                'contact'=>self::href($base,'iletisim'),'contactForm'=>!empty($d['settings']['contact']),
                'homeVisit'=>$homeVisits?self::href($base,'evde-hizmet').'#yeni':'',
                'homeCare'=>$preview?'':self::href($base,'evden-takip'),
                'about'=>self::href($base,'hakkimizda'),
            ],
        ];
        return '<script type="application/json" id="site-assistant-data">'.
            json_encode($data,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE).'</script>'.
            '<script type="module" src="/site-assistant.js?v=1"></script>';
    }

    public function render(array $site,array $d,string $base,string $path,array $get,?array $customer=null,bool $preview=false,string $notice='',array $visitCatalog=[],string $visitForm=''): array
    {
        [$page,$post]=array_pad(explode('/',$path,2),2,'');
        $media=$base.'/medya/';
        $visitPage=$page==='evde-hizmet' && $visitCatalog;
        $toolsPage=$page==='araclar';
        $notFound=(!$visitPage&&!$toolsPage&&!isset(WebBuilder::PAGES[$page])) || ($page!=='blog' && $post!=='');
        $record=$d['content'][$page]??[];
        $title=$notFound?'Sayfa bulunamadı':($visitPage?'Evde Hizmet':($toolsPage?'Evcil Hayvan Araçları':self::label($d,$page)));
        if ($toolsPage && !$notFound) $record=['summary'=>'Evcil hayvanınızın insan yaşı karşılığını hesaplayın, kayıp ilanı afişi ve QR kimlik kartı hazırlayın. Bilgiler cihazınızda kalır, hiçbir yere gönderilmez.'];
        $description=$record['summary']??'';
        $article=[];
        $articleId=null;
        if (!$notFound && $page==='blog') {
            [$article,$blog,$articleId]=$this->blog($d,$base,$media,$post,$get);
            if ($article===null) {$notFound=true;$title='Sayfa bulunamadı';}
            elseif ($article) {$title=$article['title'];$description=$article['seoDescription']?:$article['summary'];}
        }
        $visitLink=$visitCatalog?'<a class="button" href="'.self::e($base.'/evde-hizmet#yeni').'">Evde hizmet talep et</a>':'';
        $body='';
        if ($notice) $body.='<p class="notice" role="status">'.self::e($notice).'</p>';
        if ($notFound) {
            $body.='<h1>Sayfa bulunamadı</h1><p><a href="'.self::href($base).'">Ana sayfaya dön</a></p>';
        } elseif ($page==='') {
            $body.=$this->home($site,$d,$base,$media,$preview);
            if ($visitLink && $visitCatalog['home_section']) $body.='<section class="block section-about"><h2>Evinize veteriner hizmeti</h2><p>Ziyaret veya klinik transferi için talep gönderip klinikten teklif alın.</p>'.$visitLink.'</section>';
        } else {
            $body.='<nav class="crumb" aria-label="Sayfa konumu"><a href="'.self::href($base).'">Ana Sayfa</a> / '.
                ($post!==''?'<a href="'.self::href($base,'blog').'">Blog</a> / ':'').'<span>'.self::e($title).'</span></nav><h1>'.self::e($title).'</h1>';
            if (!$article) $body.=self::image($record,$media,'page-image').
                '<div class="prose">'.self::rich(($record['summary']??'')."\n".($record['body']??'')).'</div>';
            if (!empty($record['link'])) $body.='<p><a href="'.self::e($record['link']).'">Bağlantıyı aç</a></p>';
            if ($visitPage) {
                $body.=$visitForm;
            } elseif ($toolsPage) {
                $body.=self::toolsPage($d);
            } elseif ($page==='hakkimizda') {
                foreach (['story'=>'Kuruluş hikâyesi','mission'=>'Misyon ve vizyon','services'=>'Hizmetler','facilities'=>'Klinik imkânları'] as $key=>$label)
                    if (!empty($record[$key])) $body.='<section class="prose"><h2>'.$label.'</h2>'.self::rich($record[$key]).'</section>';
            } elseif ($page==='ekibimiz'||$page==='ailemiz') {
                $type=$page==='ekibimiz'?'team':'gallery';
                $records=self::records($d,$type);
                if ($type==='gallery') {
                    $category=is_string($get['kategori']??null)?$get['kategori']:'';
                    $filterRows=array_map(static fn($item)=>['category'=>WebBuilder::gallerySpecies($item)],$records);
                    $body.=self::categoryLinks($filterRows,$base,$page,$category);
                    if ($category!=='') $records=array_values(array_filter($records,static fn($item)=>
                        WebBuilder::gallerySpecies($item)===$category || ($item['category']??'')===$category));
                }
                $body.=self::cards($records,$type,$base,$media);
            } elseif ($page==='blog') {
                $body.=$blog;
            } elseif ($page==='randevu') {
                $body.=$this->appointment($site,$d,$base,$get,$customer,$preview);
            } elseif ($page==='iletisim') {
                if (!empty($d['settings']['contact'])) $body.='<section class="contact-message"><h2>Mesaj gönderin</h2>'.
                    '<form class="public-form" method="post" action="'.self::href($base,'iletisim').'">'.
                    '<label>Ad soyad<input name="name" required maxlength="160" value="'.self::e(self::formValue($get,'name')).'"></label>'.
                    '<label>E-posta<input name="email" type="email" required maxlength="254" value="'.self::e(self::formValue($get,'email')).'"></label>'.
                    '<label class="wide">Mesaj<textarea name="body" required maxlength="3000">'.self::e(self::formValue($get,'body')).'</textarea></label>'.
                    '<details class="wide"><summary>Aydınlatma metni</summary>'.self::rich($d['settings']['contactPrivacy']??'').'</details>'.
                    '<label class="check wide"><input type="checkbox" name="consent" value="yes" required'.(($get['consent']??'')==='yes'?' checked':'').'>Aydınlatma metnini okudum.</label>'.
                    '<div class="trap" aria-hidden="true"><label>Bu alanı boş bırakın<input name="website" tabindex="-1" autocomplete="off"></label></div>'.
                    $this->mathInput($site,'iletisim').'<button class="button"'.($preview?' disabled':'').'>Mesajı gönder</button></form></section>';
                $body.=$this->contact($site,$d,$base,$preview);
            }
        }
        $clinic=$d['identity']['name'];
        $nav='';
        foreach (WebBuilder::PAGES as $route=>$label) {
            if ($route==='iletisim' && $visitCatalog) $nav.='<a href="'.self::href($base,'evde-hizmet').'"'.($visitPage?' aria-current="page"':'').'>Evde Hizmet</a>';
            $nav.='<a href="'.self::href($base,$route).'"'.($route===$page?' aria-current="page"':'').'>'.self::e(self::label($d,$route)).'</a>';
        }
        $canonical=$this->web->base($site).($path===''?'':'/'.$path);
        $seoTitle=$page===''?($d['identity']['title']?:$clinic):(($article['seoTitle']??'')?:$title.' · '.$clinic);
        $description=$description?:$d['identity']['description'];
        $index=!$preview&&!$notFound&&($d['settings']['index']??true);
        $favicon=empty($d['contact']['favicon'])?'':'<link rel="icon" type="image/webp" href="'.self::e($media.$d['contact']['favicon']).'">';
        $logo=empty($d['contact']['logo'])?'':'<img src="'.self::e($media.$d['contact']['logo']).'" alt="" width="44" height="44">';
        $schema=['@context'=>'https://schema.org','@type'=>'VeterinaryCare','name'=>$clinic,'url'=>$this->web->base($site)];
        if (!empty($d['contact']['phone'])) $schema['telephone']=$d['contact']['phone'];
        if (!empty($d['contact']['address'])) $schema['address']=['@type'=>'PostalAddress','streetAddress'=>$d['contact']['address'],'addressLocality'=>$d['identity']['city'],'addressCountry'=>'TR'];
        $socialImage=$article['image']??$record['image']??'';
        $head='<meta name="robots" content="'.($index?'index,follow':'noindex,nofollow').'"><meta name="description" content="'.self::e($description).'">'.
            '<meta name="keywords" content="'.self::e($d['identity']['keywords']).'"><link rel="canonical" href="'.self::e($canonical).'">'.
            '<meta property="og:title" content="'.self::e($seoTitle).'"><meta property="og:description" content="'.self::e($description).'">'.
            '<meta property="og:type" content="'.($article?'article':'website').'"><meta property="og:url" content="'.self::e($canonical).'">'.
            ($socialImage?'<meta property="og:image" content="'.self::e($this->web->base($site).'/medya/'.$socialImage).'">':'').$favicon.
            (!$preview&&!$notFound?'<script type="application/ld+json">'.json_encode($schema,JSON_HEX_TAG|JSON_HEX_AMP|JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE).'</script>':'');
        $footerHours='';
        if (!$notFound) foreach ($this->web->branches($site['partner_id']) as $branch) {
            $status=self::availability($d['booking']['hours'][$branch->id]??[],$d['booking']['holidays']??[]);
            if ($status) $footerHours.='<span class="footer-hours">'.self::e($branch->name).$status.'</span>';
        }
        $phone=$d['contact']['phone']??'';
        $strip=$phone!==''?'<div class="top-strip"><div><span>Acil durumda bizi arayın</span><a href="tel:'.self::e($phone).'" data-ui-preserve>'.self::e($phone).'</a></div></div>':'';
        $homeCareLink=$preview?'':' <a href="'.self::href($base,'evden-takip').'">Evden Takip</a>';
        $html='<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'.
            self::e($seoTitle).'</title>'.$head.'<link rel="stylesheet" href="/web-builder-site.css?v=55"><link rel="stylesheet" href="/web-builder-themes.css?v=3"><script src="/web-builder-site.js?v=39" defer></script>'.
            ($toolsPage&&!$notFound?'<link rel="stylesheet" href="/web-tools.css?v=1"><script type="module" src="/web-tools.js?v=1"></script>':'').
            ($visitPage?'<script src="/home-visits.js?v=44" defer></script>':'').'</head>'.
            '<body class="theme-'.self::e($d['theme']).' palette-'.self::e($d['palette']).'"><a class="skip" href="#icerik">İçeriğe geç</a><header class="site-header">'.$strip.'<div class="header-inner">'.
            '<a class="site-brand" href="'.self::href($base).'">'.$logo.'<span data-ui-preserve>'.self::e($clinic).'</span></a>'.
            '<nav class="primary-nav" aria-label="Ana menü">'.$nav.'</nav><div class="site-language" data-ui-language></div></div></header><main id="icerik">'.$body.'</main>'.
            '<footer><div><strong>'.self::e($clinic).'</strong> '.$footerHours.$homeCareLink.' <a href="'.self::href($base,'araclar').'">Evcil Hayvan Araçları</a> <a href="'.self::href($base,'iletisim').'">İletişim</a></div>'.
            '<div class="site-platform-credit"><span>Bu site <a href="https://www.vetzimo.com"><img src="/vetzimo-mark.png" width="18" height="18" alt="">VetZimo</a> tarafından sağlanmaktadır.</span></div></footer>'.
            '<dialog id="gallery-dialog" aria-label="Galeri fotoğrafı"><button type="button" aria-label="Önceki fotoğraf" data-previous>‹</button><img alt="">'.
            '<button type="button" aria-label="Sonraki fotoğraf" data-next>›</button><button type="button" data-close>Kapat</button></dialog>'.($notFound?'':$this->assistant($site,$d,$base,$preview,(bool)$visitCatalog)).'</body></html>';
        return [$notFound?404:200,$html,$articleId];
    }
    /** Evcil hayvan araçları: yaş hesaplayıcı, kayıp ilanı afişi, QR kimlik kartı. Tümü tarayıcıda çalışır (web-tools.js). */
    private static function toolsPage(array $d): string
    {
        $phone=self::e($d['contact']['phone']??'');
        $clinic=self::e($d['identity']['name']??'');
        $species='<option value="cat">Kedi</option><option value="dog-small">Köpek (küçük ırk, 10 kg altı)</option><option value="dog-medium">Köpek (orta ırk, 10–25 kg)</option><option value="dog-large">Köpek (büyük ırk, 25 kg üstü)</option>';
        return '<div class="pet-tools" data-clinic="'.$clinic.'" data-clinic-phone="'.$phone.'">'.
            '<nav class="tool-tabs" aria-label="Araçlar"><a href="#yas" data-tool="yas">Yaş hesaplayıcı</a><a href="#kayip" data-tool="kayip">Kayıp ilanı afişi</a><a href="#kimlik" data-tool="kimlik">QR kimlik kartı</a></nav>'.
            '<section id="yas" class="tool-panel"><h2>İnsan yaşı karşılığı</h2><form class="tool-form" data-age><label>Tür ve boyut<select name="species">'.$species.'</select></label>'.
            '<label>Yaş (yıl)<input name="years" type="number" min="0" max="30" value="3" inputmode="numeric"></label><label>Ay<input name="months" type="number" min="0" max="11" value="0" inputmode="numeric"></label></form>'.
            '<div class="age-result" aria-live="polite"></div><p class="tool-note">Hesaplama Amerikan Veteriner Hekimler Birliği (AVMA) yaş tablosunu temel alır; ırk ve sağlık durumuna göre farklılık gösterebilir.</p></section>'.
            '<section id="kayip" class="tool-panel" hidden><h2>Kayıp ilanı afişi</h2><form class="tool-form" data-lost>'.
            '<label>Hayvanın adı<input name="name" maxlength="40" required></label><label>Tür<select name="species"><option>Kedi</option><option>Köpek</option><option>Kuş</option><option>Diğer</option></select></label>'.
            '<label>Irk<input name="breed" maxlength="40"></label><label>Renk ve belirgin özellikler<input name="marks" maxlength="120"></label>'.
            '<label>Kaybolduğu tarih<input name="date" type="date"></label><label>Kaybolduğu bölge<input name="area" maxlength="80"></label>'.
            '<label>İletişim telefonu<input name="phone" type="tel" maxlength="20" required></label><label>Ödül (isteğe bağlı)<input name="reward" maxlength="40"></label>'.
            '<label class="wide">Fotoğraf<input name="photo" type="file" accept="image/*"></label><label class="check wide"><input type="checkbox" name="chip" value="1">Mikroçipli</label></form>'.
            '<div class="tool-actions"><button type="button" class="button" data-print="lost">Afişi yazdır / PDF kaydet</button></div><div class="poster-wrap"><article class="lost-poster" aria-label="Afiş önizlemesi"></article></div></section>'.
            '<section id="kimlik" class="tool-panel" hidden><h2>QR kimlik kartı</h2><p class="tool-note">Kartı yazdırıp tasmaya ya da taşıma çantasına takın. QR okutulduğunda sahibin telefonu ve notlar görünür.</p><form class="tool-form" data-card>'.
            '<label>Hayvanın adı<input name="name" maxlength="40" required></label><label>Sahibinin telefonu<input name="phone" type="tel" maxlength="20" required></label>'.
            '<label>Mikroçip numarası<input name="chip" maxlength="20" inputmode="numeric"></label><label>Önemli not (alerji, ilaç)<input name="note" maxlength="80"></label></form>'.
            '<div class="tool-actions"><button type="button" class="button" data-print="card">Kartı yazdır</button></div><div class="card-wrap"><article class="id-card" aria-label="Kimlik kartı önizlemesi"></article></div></section></div>';
    }
    public function sitemap(array $site,array $draft): string
    {
        $base=$this->web->base($site);
        $paths=array_keys(WebBuilder::PAGES);
        foreach (self::records($draft,'blog') as $row) $paths[]='blog/'.$row['slug'];
        return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'.
            implode('',array_map(static fn($path)=>'<url><loc>'.htmlspecialchars($base.($path!==''?'/'.$path:''),ENT_XML1,'UTF-8').'</loc></url>',$paths)).'</urlset>';
    }
}
