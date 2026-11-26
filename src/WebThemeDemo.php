<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

/**
 * Web Sitem tema vitrini ve canlı demo siteler. "/web-tema/{tema}" adresinde her tema, gerçek site motoruyla (WebBuilderPublic)
 * "Örnek Veteriner Kliniği" içeriğiyle açılır. Tüm sayfa geçişleri çalışır; iletişim formu ve evde hizmet talebi demo olduğu için pasiftir.
 * Veritabanına yazmaz, oturum gerektirmez, arama motorlarına kapalıdır.
 */
final class WebThemeDemo
{
    /** Tema anahtarı => [ad, kısa esprili tanıtım, öne çıkan üç özellik] */
    public const PITCH = [
        'modern'=>['Modern Klinik','Fesleğen yeşili, krem tonlar, bol nefes alan boşluklar. Kedilerin bile “hmm, fena değil” dediği sakinlikte bir tema.',
            ['Sade ve ferah düzen','Yumuşak geçişli kartlar','Her yaştan ziyaretçiye kolay okuma']],
        'premium'=>['Premium Veteriner','Mermer, altın çizgiler ve zeytin yeşili. Patisini silmeden içeri girmeyen misafirler için butik klinik havası.',
            ['Tam ekran sinematik giriş','Altın vurgulu zarif yazı','Butik ve özel klinikler için']],
        'pati'=>['Canlı Klinik','Renkler kuyruk sallıyor! Enerjisi bir yavru köpekten az, sabah kahvesinden fazla. Genç ve neşeli klinikler buraya.',
            ['Hareketli pati izleri','Canlı renk geçişleri','Sosyal medyaya yakışan görünüm']],
        'medikal'=>['Medikal Pro','Steril, net, güven veren. Röntgen filmi kadar şeffaf; EKG çizgisi bile ritmini kaçırmıyor.',
            ['Kurumsal ve klinik düzen','EKG çizgili hareketli giriş','Hastane ve 7/24 klinikler için']],
    ];
    /** Sitenizle gelen özellikler (Web Sitem'de gerçekten var olanlar). */
    public const FEATURES = [
        ['📅','Online randevu','Hekim seçerek, çakışmasız saatlerle.'],
        ['✅','Otomatik onay','İsterseniz uygun talepler kendiliğinden onaylanır.'],
        ['🌐','Kendi alan adınız','www.klinigim.com ya da ücretsiz alt adres.'],
        ['🎨','4 tema × 2 renk','Tek tıkla tema ve renk değiştirin.'],
        ['📝','Blog ve kategoriler','Bilgilendirici yazılarla Google’da öne çıkın.'],
        ['👩‍⚕️','Ekibimiz','Hekim ve personeli fotoğraflı tanıtın.'],
        ['🐾','Ailemiz galerisi','Sahip onaylı mutlu hasta fotoğrafları.'],
        ['🤖','Ziyaretçi asistanı','Saat, adres, hizmet ve acil yönlendirme.'],
        ['🧮','Evcil hayvan araçları','İnsan yaşı, kayıp ilanı afişi, QR kimlik kartı.'],
        ['🕒','Açığız / kapalıyız','Çalışma saatleri ve tatiller otomatik.'],
        ['🏠','Evde hizmet talebi','Ziyaretçi evden muayene isteyebilir.'],
        ['✉️','Güvenli iletişim formu','Spam korumalı, e-posta bildirimli.'],
        ['🔎','SEO hazır','Site haritası, meta etiketleri, yapılandırılmış veri.'],
        ['🌍','13 dil','Ziyaretçi sayfayı kendi dilinde okur.'],
        ['📊','Ziyaret istatistikleri','Görüntüleme, arama ve yol tarifi sayıları.'],
        ['📱','Her cihazda hızlı','Mobil uyumlu, görseller otomatik küçülür.'],
    ];

    private const MEDIA = ['team-elif','team-zeynep','team-selin','team-deniz','pet-pamuk','pet-zeytin','pet-limon','pet-duman','pet-dostlar','blog-asi','blog-kedi','blog-yaz','about'];

    public static function handle(\PDO $db,array $config,string $path,string $method): never
    {
        if (!in_array($method,['GET','HEAD'],true)) self::send(405,'Demo sitede form gönderimi kapalıdır.','text/plain');
        if (!preg_match('~\A/web-tema(?:/([a-z]+))?(?:/(.*))?\z~D',$path,$m)) self::send(404,'Sayfa bulunamadı.','text/plain');
        $theme=$m[1]??'';
        $route=trim($m[2]??'','/');
        if ($theme==='medya' || preg_match('~\Amedya/([a-z-]+)\z~D',$route)) {
            $file=preg_replace('/\.webp\z/','',basename($route));
            if (!in_array($file,self::MEDIA,true)) self::send(404,'Görsel bulunamadı.','text/plain');
            header('Cache-Control: public, max-age=2592000, immutable');
            self::send(200,(string)file_get_contents(dirname(__DIR__).'/public/web-themes/demo/'.$file.'.webp'),'image/webp');
        }
        if (!isset(WebBuilder::THEMES[$theme])) { header('Location: /web-sitem',true,302); exit; }
        $palette=($_GET['renk']??'')==='b'?'b':'a';
        $web=new WebBuilder($db,$config);
        $public=new WebBuilderPublic($web,new WebBooking($db,$web),$config);
        $site=['partner_id'=>'demo-'.$theme,'slug'=>'ornek-veteriner-klinigi','custom_host'=>'','domain_verified'=>0,'published'=>1];
        $base='/web-tema/'.$theme;
        $draft=self::draft($theme,$palette);
        $visitForm='<section class="visit-application"><p class="notice" role="status">Bu bir tema önizlemesidir. Gerçek sitenizde ziyaretçiler buradan evde muayene, aşı ya da klinik transferi talebi gönderir; talep VetZimo’da Evde Hizmet ekranınıza düşer.</p></section>';
        $catalog=$route==='evde-hizmet'||$route===''?['home_section'=>true]:['home_section'=>false];
        try {
            [$code,$html]=$public->render($site,$draft,$base,$route,[],null,true,'',$catalog,$visitForm);
        } catch (\Throwable) {
            [$code,$html]=$public->render($site,$draft,$base,'',[],null,true,'',$catalog,$visitForm);
        }
        if ($route==='randevu') $html=self::bookingMock($html);
        if ($palette==='b') $html=preg_replace('~href="(/web-tema/'.$theme.'(?:/[^"?#]*)?)"~','href="$1?renk=b"',$html)??$html;
        $html=str_replace('</head>','<link rel="stylesheet" href="/web-theme-demo.css?v=2"></head>',$html);
        $html=preg_replace('~<body([^>]*)>~','<body$1>'.self::bar($theme,$palette,$route),$html,1)??$html;
        header('X-Robots-Tag: noindex, nofollow');
        self::send($code,$html,'text/html');
    }

    /** Demo sitede şube veritabanında olmadığı için randevu adımları örnek hekim ve saatlerle gösterilir (kayıt oluşturulmaz). */
    private static function bookingMock(string $html): string
    {
        $html=str_replace('<option value="">Şube seçin</option></select>','<option value="merkez" selected>Merkez · Çankaya</option></select>',$html);
        $day=new \DateTimeImmutable('tomorrow',new \DateTimeZone('Europe/Istanbul'));
        $slots='';
        foreach (['09:30','10:00','10:30','11:30','13:30','14:00','15:30','16:00','17:30'] as $i=>$t) $slots.='<button type="button" class="button'.($i%4===2?' outline':'').'" disabled'.($i%4===2?' title="Dolu"':'').'>'.$t.'</button>';
        $mock='<section class="booking-tools vz-demo-slots"><h2>Uygun saatler · '.$day->format('d.m.Y').'</h2>'.
            '<p><strong>Hekim:</strong> Fark etmez · Vet. Hek. Elif Arslan · Vet. Hek. Zeynep Koç · Vet. Hek. Selin Aydın</p>'.
            '<div class="vz-demo-slot-grid">'.$slots.'</div><p class="booking-notice">Bu bir tema önizlemesidir; saat seçimi ve randevu kaydı kapalıdır. Gerçek sitenizde seçilen saat, VetZimo randevu takviminize anında düşer ve aynı saate ikinci randevu verilmez.</p></section>';
        $pos=strpos($html,'</form>',(int)strpos($html,'slot-form'));
        return $pos===false?$html:substr_replace($html,'</form>'.$mock,$pos,7);
    }

    private static function send(int $code,string $body,string $type): never
    {
        http_response_code($code);
        header('Content-Type: '.$type.($type==='image/webp'?'':'; charset=utf-8'));
        echo $body;
        exit;
    }

    private static function bar(string $theme,string $palette,string $route): string
    {
        $e=WebBuilderAdmin::e(...);
        $links='';
        foreach (self::PITCH as $key=>[$name]) $links.='<a href="/web-tema/'.$key.($route!==''?'/'.$e($route):'').($palette==='b'?'?renk=b':'').'"'.($key===$theme?' aria-current="true"':'').'>'.$e($name).'</a>';
        $self='/web-tema/'.$theme.($route!==''?'/'.$e($route):'');
        return '<div class="vz-demo-bar" role="region" aria-label="Tema önizlemesi"><div class="vz-demo-inner">'.
            '<span class="vz-demo-badge">DEMO</span><strong>'.$e(self::PITCH[$theme][0]).'</strong>'.
            '<nav class="vz-demo-themes" aria-label="Temalar">'.$links.'</nav>'.
            '<span class="vz-demo-palette" role="group" aria-label="Renk"><a href="'.$self.'"'.($palette==='a'?' aria-current="true"':'').'>A · '.$e(WebBuilder::THEMES[$theme][1]).'</a>'.
            '<a href="'.$self.'?renk=b"'.($palette==='b'?' aria-current="true"':'').'>B · '.$e(WebBuilder::THEMES[$theme][2]).'</a></span>'.
            '<a class="vz-demo-cta" href="/clinic#web-sitem/tema" target="_top">Bu temayı kullan</a></div></div>';
    }

    /** Temaya göre içerik tonu biraz değişir; kişiler, hizmetler ve yazılar aynıdır. */
    public static function draft(string $theme,string $palette): array
    {
        $tone=[
            'modern'=>['Sakin bir klinik, mutlu dostlar','Ankara Çankaya’da 2012’den beri; aşıdan cerrahiye kadar her adımda yanınızdayız.'],
            'premium'=>['Dostunuza butik bir bakım deneyimi','Randevulu, beklemesiz ve kişiye özel muayene. Çankaya’nın taş binasında, zeytin ağaçlarının gölgesinde.'],
            'pati'=>['Kuyruk sallatan veteriner kliniği','Aşı, check-up, diş taşı, kısırlaştırma… Korkuyu ödül mamasıyla, endişeyi güler yüzle gideriyoruz!'],
            'medikal'=>['7/24 Acil ve tam donanımlı veteriner hastanesi','Dijital röntgen, ultrason, kan tahlili ve ameliyathane tek çatı altında. Sonuçlar dakikalar içinde.'],
        ][$theme];
        $today=WebBuilder::today();
        $date=static fn(int $days)=>date('Y-m-d',strtotime($today.' -'.$days.' days'));
        $team=[
            ['team-elif','Vet. Hek. Elif Arslan','Klinik Direktörü','İç hastalıkları ve kardiyoloji',"Ankara Üniversitesi Veteriner Fakültesi mezunu. 14 yıldır kedi ve köpeklerde kalp hastalıkları üzerine çalışıyor. Evde iki kedisi ve bir golden retriever’ı var; üçü de onun hasta olduğunu söylüyor."],
            ['team-zeynep','Vet. Hek. Zeynep Koç','Kedi Dostu Hekim','Kedi hastalıkları ve davranış',"Uluslararası “kedi dostu klinik” eğitimli. Muayeneyi kedinin hızında yapar; gerekirse önce beş dakika sadece sohbet eder."],
            ['team-selin','Vet. Hek. Selin Aydın','Cerrahi Sorumlusu','Yumuşak doku cerrahisi ve anestezi',"Kısırlaştırma, tümör operasyonları ve diş cerrahisinde 9 yıllık deneyim. Ameliyat sonrası her hastayı bizzat arayıp sorar."],
            ['team-deniz','Vet. Hek. Deniz Yıldız','Görüntüleme ve Acil','Ultrason, röntgen ve yoğun bakım',"Gece nöbetlerinin sakin kahramanı. Gebelik ultrasonlarında yavru saymayı en çok o sever."],
        ];
        $rows=[];
        foreach ($team as $i=>[$img,$name,$title,$spec,$body]) $rows['t'.$i]=['name'=>$name,'title'=>$title,'specialty'=>$spec,'body'=>$body,'image'=>$img,'alt'=>$name,'position'=>$i+1,'visible'=>true,'link'=>''];
        $pets=[
            ['pet-pamuk','Pamuk','Kedi','4 yaşında tekir. Kalp taraması temiz çıktı, ödül olarak iki kat ton balığı istedi.'],
            ['pet-zeytin','Zeytin','Köpek','Border collie. Aşıları tamam, enerjisi hâlâ tükenmedi; hemşirelerimiz koşu ayakkabısı aldı.'],
            ['pet-limon','Limon','Köpek','Jack Russell. Diş taşı temizliği sonrası gülüşüyle tüm bekleme salonunu fethetti.'],
            ['pet-duman','Duman','Kedi','British shorthair. Kısırlaştırma ameliyatından üç günde toparlandı, şimdi koltuğun tek hâkimi.'],
            ['pet-dostlar','Bal & Fındık','Diğer','Kedi ile köpeğin aynı evde barış içinde yaşayabildiğinin kanıtı. Ortak check-up günü randevusu bizden.'],
        ];
        $gallery=[];
        foreach ($pets as $i=>[$img,$name,$species,$body]) $gallery['g'.$i]=['name'=>$name,'species'=>$species,'body'=>$body,'image'=>$img,'alt'=>$name,'position'=>$i+1,'visible'=>true,'consent'=>true,'category'=>''];
        $posts=[
            ['blog-asi','yavru-kopek-asi-takvimi','Yavru köpeğinizin ilk yıl aşı takvimi','Aşılar',$date(3),
                'Karma aşıdan kuduza, iç-dış parazitten kennel cough’a: ilk 16 haftada nelere dikkat etmelisiniz?',
                "## İlk aşı ne zaman?\nYavrular 6–8 haftalıkken ilk karma aşıyı olur, ardından 3–4 hafta arayla tekrar edilir.\n\n## Kuduz aşısı\n12. haftadan sonra yapılır ve yasal olarak zorunludur.\n\n## Parazit uygulamaları\nİç ve dış parazit uygulamaları ayda bir düzenli tekrarlanmalıdır.\n\nAşı takvimini sizin için hazırlıyor, zamanı gelince SMS ile hatırlatıyoruz."],
            ['blog-kedi','kediniz-veterinerden-korkuyorsa','Kediniz veterinerden korkuyorsa 5 altın kural','Kedi Bakımı',$date(9),
                'Taşıma çantasını dolaptan bayram günü çıkarmayın! Stressiz bir klinik ziyareti için uzman önerileri.',
                "1. Taşıma çantasını evde açık bırakın, içine sevdiği battaniyeyi koyun.\n2. Yolculukta çantanın üzerini ince bir örtüyle kapatın.\n3. Feromon spreyini 15 dakika önce sıkın.\n4. Kliniğimizde kediler köpeklerden ayrı bekleme alanında ağırlanır.\n5. Eve dönünce ödül unutulmasın."],
            ['blog-yaz','sicak-havada-evcil-hayvan','Sıcak havalarda dostlarınızı koruyun','Mevsimsel',$date(20),
                'Asfalt, park hâlindeki araç ve öğle güneşi: yaz aylarında sıcak çarpmasının belirtileri ve ilk yardım.',
                "Sıcak çarpmasında hızlı soluma, aşırı salya ve halsizlik görülür. Hayvanı serin bir yere alın, ılık (soğuk değil) suyla ıslatın ve hemen kliniği arayın.\n\nYürüyüşleri sabah erken ve akşam serinliğinde yapın; asfaltı elinizin tersiyle 5 saniye test edin."],
        ];
        $blog=[];
        foreach ($posts as $i=>[$img,$slug,$title,$cat,$d,$summary,$body]) $blog['b'.$i]=['title'=>$title,'slug'=>$slug,'category'=>$cat,'date'=>$d,'summary'=>$summary,'body'=>$body,
            'image'=>$img,'alt'=>$title,'visible'=>true,'author'=>$team[$i][1],'tags'=>'','seoTitle'=>'','seoDescription'=>'','position'=>$i+1];
        return [
            'identity'=>['name'=>'Örnek Veteriner Kliniği','title'=>'Örnek Veteriner Kliniği · Ankara','description'=>$tone[1],'keywords'=>'veteriner, ankara, aşı, kedi, köpek',
                'slogan'=>$tone[0],'city'=>'Ankara','district'=>'Çankaya','neighborhood'=>'Kavaklıdere'],
            'contact'=>['phone'=>'0312 555 00 00','whatsapp'=>'+905550000000','email'=>'merhaba@ornekveteriner.com','address'=>'Kavaklıdere Mah. Patili Sok. No: 7, Çankaya / Ankara',
                'instagram'=>'https://www.instagram.com/','directions'=>'https://www.google.com/maps'],
            'theme'=>$theme,'palette'=>$palette,
            'content'=>[
                ''=>['title'=>'','summary'=>$tone[1],'body'=>''],
                'hakkimizda'=>['title'=>'Hakkımızda','summary'=>'Örnek Veteriner Kliniği; 4 hekim, 6 teknisyen ve sayısız mama ödülüyle her gün yaklaşık 40 dostumuzu ağırlıyor.',
                    'body'=>'Çalışma saatlerimiz: Hafta içi 09:00–20:00, Cumartesi 10:00–17:00. Pazar ve gece saatlerinde acil hattımız açık.',
                    'image'=>'about','alt'=>'Klinik muayene odası',
                    'story'=>'2012’de tek bir muayene odasıyla başladık. Bugün dijital röntgen, ultrason, laboratuvar ve iki ameliyathaneyle Ankara’nın en sevilen kliniklerinden biriyiz. Ama hâlâ her hastaya ilk günkü merakla bakıyoruz.',
                    'mission'=>'Korkusuz muayene, şeffaf ücret, anlaşılır açıklama. Hasta sahiplerimiz her aşamada ne yapıldığını bilir; aşı, kontrol ve tahlil sonuçları VetZimo uygulamasında görünür.',
                    'services'=>"Koruyucu aşılar ve aşı takvimi\nGenel muayene ve check-up\nKısırlaştırma ve yumuşak doku cerrahisi\nDiş taşı temizliği\nDijital röntgen ve ultrason\nKan tahlili ve biyokimya\nGebelik ve doğum takibi\nMikroçip ve pasaport işlemleri\nEvde muayene ve aşı\n7/24 acil",
                    'facilities'=>"2 ameliyathane, kedi ve köpekler için ayrı bekleme alanı, yoğun bakım ünitesi, otopark."],
                'ekibimiz'=>['title'=>'Ekibimiz','summary'=>'Her biri kendi alanında uzman, hepsi hayvansever bir ekip.'],
                'blog'=>['title'=>'Blog','summary'=>'Hekimlerimizden kısa, anlaşılır ve işe yarar bilgiler.'],
                'ailemiz'=>['title'=>'Ailemiz','summary'=>'Sahiplerinin izniyle paylaşılan mutlu hastalarımız.'],
                'randevu'=>['title'=>'Randevu Al','summary'=>'Gerçek sitenizde ziyaretçiler buradan hekim ve saat seçerek randevu alır; talep anında VetZimo randevu takviminize düşer.'],
                'iletisim'=>['title'=>'İletişim','summary'=>'Bize telefonla, WhatsApp’tan ya da formdan ulaşın. (Demo sitede form pasiftir.)'],
            ],
            'sections'=>['services','team','gallery','blog','contact'],
            'team'=>$rows,'gallery'=>$gallery,'blog'=>$blog,
            'booking'=>['enabled'=>true,'hours'=>[],'holidays'=>[],'duration'=>30],
            'settings'=>['index'=>false,'contact'=>true,'assistant'=>true,'assistantNote'=>'Muayene ve aşı randevuları için hafta içi 09:00–20:00 arası açığız. Otoparkımız ücretsizdir.'],
        ];
    }

    /** Web Sitem açılış sayfasındaki tema vitrini. */
    public static function showcase(bool $hasSite): string
    {
        $e=WebBuilderAdmin::e(...);
        $cards='';
        $i=0;
        foreach (self::PITCH as $key=>[$name,$pitch,$points]) {
            $li='';
            foreach ($points as $p) $li.='<li>'.$e($p).'</li>';
            $cards.='<article class="tv-card tv-'.$key.'" style="--i:'.$i++.'"><a class="tv-shot" href="/web-tema/'.$key.'" target="_blank" rel="noopener" aria-label="'.$e($name).' temasını incele">'.
                '<img src="/web-themes/'.$key.'-preview.webp?v=40" alt="" width="800" height="520" loading="lazy"><span class="tv-tag">'.$e($name).'</span></a>'.
                '<div class="tv-body"><h3>'.$e($name).'</h3><p>'.$e($pitch).'</p><ul>'.$li.'</ul>'.
                '<div class="tv-actions"><a class="tv-inspect" href="/web-tema/'.$key.'" target="_blank" rel="noopener"><span>Detaylı incele</span><i aria-hidden="true">→</i></a>'.
                '<a class="tv-alt" href="/web-tema/'.$key.'?renk=b" target="_blank" rel="noopener">B rengini gör</a></div></div></article>';
        }
        $features='';
        foreach (self::FEATURES as $n=>[$icon,$title,$text]) $features.='<li style="--i:'.$n.'"><span aria-hidden="true">'.$icon.'</span><div><strong>'.$e($title).'</strong><small>'.$e($text).'</small></div></li>';
        return '<section class="theme-vitrine" aria-labelledby="tvTitle"><div class="tv-head"><p class="tv-eyebrow">Temalar</p><h2 id="tvTitle">Kliniğinize yakışan temayı seçin</h2>'.
            '<p>Her tema “Örnek Veteriner Kliniği” içeriğiyle hazır bir demo sitedir. Gezinin, sayfalar arasında dolaşın; beğendiğinizi '.($hasSite?'Tema ve Renkler bölümünden':'kurulumda').' tek tıkla seçin.</p></div>'.
            '<div class="tv-grid">'.$cards.'</div>'.
            '<div class="tv-all"><div class="tv-all-head"><p class="tv-eyebrow">Hepsi dahil</p><h2>Sitenizle gelen 16 özellik</h2><p>Ek modül satın alma veya gizli ücret yoktur. Siteniz VetZimo’daki randevu, hasta ve bildirim sistemine bağlı çalışır.</p></div>'.
            '<ul class="tv-features">'.$features.'</ul></div></section>';
    }
}
