<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use RuntimeException;

final class WebBuilderRoutes
{
    private static function body(string $html,int $code=200,bool $preview=false): never
    {
        header("Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-src 'self' https://www.google.com https://maps.google.com https://www.google.com.tr https://maps.google.com.tr; frame-ancestors ".($preview?"'self'":"'none'"));
        header('Content-Type: text/html; charset=utf-8');
        header('Referrer-Policy: same-origin');
        http_response_code($code);
        echo $html;
        exit;
    }
    private static function editorRequest(): bool
    {
        return ($_SERVER['HTTP_X_VETNET_EDITOR']??'')==='1';
    }
    public static function editorError(string $message,int $status): never
    {
        if (self::editorRequest()) \reply(['error'=>$message],$status);
        self::body(WebBuilderAdmin::page('Web Sitem','<main class="center-view"><h1>Web Sitem</h1><p class="builder-error" role="alert">'.
            WebBuilderAdmin::e($message).'</p><a class="button" href="/giris">Giriş ekranı</a></main>'),$status);
    }
    private static function image(WebBuilder $web,array $row,string $id,bool $published=false): never
    {
        $params=[$row['partner_id'],$id];
        $tag='"wb-'.hash('sha256',$row['partner_id'].'/'.$id).'"';
        if ($published && in_array($tag,array_map('trim',explode(',',$_SERVER['HTTP_IF_NONE_MATCH']??'')),true) &&
            $web->query('SELECT 1 FROM clinic_web_media WHERE partner_id=? AND id=?',$params)->fetchColumn()) {
            header('Cache-Control: private, no-cache');
            header('ETag: '.$tag);
            http_response_code(304);
            exit;
        }
        $bytes=$web->query('SELECT bytes FROM clinic_web_media WHERE partner_id=? AND id=?',$params)->fetchColumn();
        if (!$bytes) throw new RuntimeException('Görsel bulunamadı.',404);
        if ($published) {
            header('Cache-Control: private, no-cache');
            header('ETag: '.$tag);
        }
        header('Content-Type: image/webp');
        echo $bytes;
        exit;
    }
    public static function handle(\PDO $db,array $config,DealerWorkspace $workspaces,SessionRepository $sessions,
        string $path,string $method,string $host,bool $external,int $now): never
    {
        $web=new WebBuilder($db,$config);
        $booking=new WebBooking($db,$web);
        $admin=new WebBuilderAdmin($web);
        $public=new WebBuilderPublic($web,$booking,$config);
        if (!$external && $path==='/api/web-builder/alerts' && $method==='GET') {
            $actor=$workspaces->actor($_COOKIE,$now);
            if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Klinik oturumu değişti.',409);
            \reply(['items'=>$booking->alerts($actor,WebBuilder::text($_GET['branch']??'',80))]);
        }
        if (!$external && $path==='/yonetim/web-siteleri') {
            $center=new Center($db,$config);
            $owner=$center->requireOwner($_COOKIE,$now,$method==='POST');
            $plans=(new Commerce($db))->catalog();
            $search=is_string($_GET['q']??null)&&preg_match('/\A.{0,120}\z/us',$_GET['q'])?trim($_GET['q']):'';
            $requestedPage=WebBuilderAdmin::pageNumber($_GET['sayfa']??1);
            $centerUrl=static function(int $page) use($search): string {
                $params=($search!==''?['q'=>$search]:[])+($page>1?['sayfa'=>$page]:[]);
                return '/yonetim/web-siteleri'.($params?'?'.http_build_query($params):'');
            };
            if ($method==='POST') {
                $action=$_POST['site_action']??'';
                if (in_array($action,['pause','resume','delete'],true)) {
                    $id=WebBuilder::text($_POST['partner']??'',80);
                    $row=$web->site($id);
                    if (!$row) self::editorError('Site bulunamadı.',404);
                    if ((int)($_POST['revision']??0)!==(int)$row['revision']) self::editorError('Site güncellendi. Önce yönetim sayfasını yenileyin.',409);
                    if ($action==='delete' && (!is_string($_POST['confirm_slug']??null) || !hash_equals($row['slug'],trim($_POST['confirm_slug'])))) {
                        self::editorError('Siteyi silmek için kısa site adresini eksiksiz yazın.',422);
                    }
                    $web->transaction(function() use($web,$center,$owner,$row,$action,$id) {
                        $web->moderate($row,$action);
                        $center->audit($owner['account_id'],'web.site.'.$action,$id);
                    });
                    header('Location: '.$centerUrl($requestedPage),true,303);exit;
                }
                $id=WebBuilder::text($_POST['plan']??'',80);
                if ($id!=='_default' && !isset($plans[$id])) throw new RuntimeException('Paket bulunamadı.',404);
                $quota=$_POST['quota']??'';
                if (!is_string($quota) || ($quota!=='' && !preg_match('/\A[0-9]{1,4}\z/D',$quota))) self::editorError('Depolama kotasını 0 ile 9999 MB arasında tam sayı olarak girin.',422);
                $web->transaction(function() use($web,$id,$quota) {
                    $web->query('INSERT INTO clinic_web_package(plan_id,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
                        [$id,($_POST['enabled']??'')==='yes'?1:0]);
                    if ($quota==='') $web->query('DELETE FROM clinic_web_storage WHERE plan_id=?',[$id]);
                    else $web->query('INSERT INTO clinic_web_storage(plan_id,max_mb) VALUES (?,?) ON DUPLICATE KEY UPDATE max_mb=VALUES(max_mb)',[$id,(int)$quota]);
                });
                $center->audit($owner['account_id'],'web.package',$id);
                header('Location: '.$centerUrl($requestedPage),true,303);exit;
            }
            $e=WebBuilderAdmin::e(...);
            $stats=$web->query('SELECT COUNT(*) total,COALESCE(SUM(s.published IS NOT NULL AND c.status IS NULL),0) live FROM clinic_web_site s LEFT JOIN clinic_web_site_control c ON c.partner_id=s.partner_id WHERE c.status IS NULL OR c.status=\'paused\'')->fetch();
            $resources=$web->query('SELECT COUNT(*) AS images,COALESCE(SUM(byte_size),0) AS bytes FROM clinic_web_media')->fetch();
            $mail=$web->query("SELECT COUNT(*) FROM clinic_web_mail WHERE sent_at IS NULL AND last_error<>''")->fetchColumn();
            $html='<header class="builder-bar"><a href="/yonetim">‹ Merkez paneli</a><strong>Web Sitesi Yönetimi</strong></header><main class="center-view"><h1>Web Sitesi Yönetimi</h1><dl class="metrics">'.
                '<div><dt>Toplam</dt><dd>'.(int)$stats['total'].'</dd></div><div><dt>Yayında</dt><dd>'.(int)$stats['live'].'</dd></div>'.
                '<div><dt>Taslak / kapalı</dt><dd>'.((int)$stats['total']-(int)$stats['live']).'</dd></div><div><dt>Görseller</dt><dd>'.(int)$resources['images'].' · '.number_format((int)$resources['bytes']/1048576,1,',','.').' MB</dd></div>'.
                '<div><dt>Yeniden denenecek e-posta hatası</dt><dd>'.(int)$mail.'</dd></div></dl>';
            $packages='';
            $grants=array_column($web->query('SELECT plan_id,enabled FROM clinic_web_package')->fetchAll(),'enabled','plan_id');
            $quotas=array_column($web->query('SELECT plan_id,max_mb FROM clinic_web_storage')->fetchAll(),'max_mb','plan_id');
            foreach (['_default'=>['name'=>'Varsayılan izin']]+$plans as $id=>$plan) {
                $packages.='<form method="post" class="controls"><input type="hidden" name="plan" value="'.$e($id).'">'.
                    WebBuilderAdmin::check('enabled',$plan['name'],(bool)($grants[$id]??$grants['_default']??1)).
                    '<label>Depolama kotası (MB)<input name="quota" type="number" min="0" max="9999" placeholder="Varsayılan" value="'.$e($quotas[$id]??'').'"></label><button>Kaydet</button></form>';
            }
            $title="JSON_UNQUOTE(JSON_EXTRACT(s.draft,'$.identity.name'))";
            $where=" FROM clinic_web_site s JOIN partner_account a ON a.id=s.partner_id
                LEFT JOIN clinic_web_site_control c ON c.partner_id=s.partner_id
                WHERE (c.status IS NULL OR c.status='paused')";
            $params=[];
            if ($search!=='') {
                $where.=" AND (a.name COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR a.code COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR CONVERT($title USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR CONVERT(s.slug USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')";
                $term='%'.strtr($search,['!'=>'!!','%'=>'!%','_'=>'!_']).'%';
                $params=array_fill(0,4,$term);
            }
            $total=(int)$web->query('SELECT COUNT(*)'.$where,$params)->fetchColumn();
            $limit=WebBuilderAdmin::PAGE_SIZE;
            $last=max(1,(int)ceil($total/$limit));
            $page=min($requestedPage,$last);
            $offset=($page-1)*$limit;
            $rows=$web->query("SELECT s.partner_id,s.slug,s.custom_host,s.domain_verified,(s.published IS NOT NULL) AS published,s.revision,
                c.status AS moderation,a.name,a.code,$title AS site_name,
                JSON_UNQUOTE(JSON_EXTRACT(s.draft,'$.theme')) AS theme".$where.
                " ORDER BY s.updated_at DESC,s.partner_id LIMIT $limit OFFSET $offset",$params)->fetchAll();
            $html.='<section class="management-list"><div class="section-heading"><h2>Bayilerin web siteleri</h2><span class="list-count">'.$total.' site</span></div>'.
                '<form class="center-search" method="get" action="/yonetim/web-siteleri"><label>Bayi veya site adıyla ara'.
                '<input type="search" name="q" maxlength="120" value="'.$e($search).'" placeholder="Bayi, site adı veya kısa adres"></label>'.
                '<button>Ara</button>'.($search!==''?'<a class="button secondary" href="/yonetim/web-siteleri">Temizle</a>':'').'</form>'.
                ($rows?'<ul class="managed-sites">':'<p class="list-empty">'.($search!==''?'Aramanıza uyan site bulunamadı.':'Henüz site oluşturulmamış.').'</p>');
            foreach ($rows as $row) {
                $partner=$e($row['partner_id']);
                $target='<input type="hidden" name="partner" value="'.$partner.'"><input type="hidden" name="revision" value="'.(int)$row['revision'].'">';
                $paused=$row['moderation']==='paused';
                $status=$paused?'Merkez tarafından kapalı':($row['published']?'Yayında':'Taslak');
                $html.='<li class="managed-site"><div><h3>'.$e($row['site_name']?:$row['name']).'</h3>'.
                    '<p>'.$e($row['name']).' · '.$e($row['code']).'</p>'.
                    '<p class="hint">'.$e(WebBuilder::THEMES[$row['theme']][0]??$row['theme']).' · '.$e($web->base($row)).'</p></div>'.
                    '<div class="controls"><span class="publish-state'.(!$paused&&$row['published']?' live':'').'">'.$status.'</span>'.
                    '<a class="button" href="/web-sitem/merkez/'.$partner.'">Siteyi düzenle</a>'.
                    '<form method="post">'.$target.'<button name="site_action" value="'.($paused?'resume':'pause').'" class="secondary">'.($paused?'Yayın engelini kaldır':'Yayından kaldır').'</button></form></div>'.
                    '<details><summary>Siteyi kalıcı olarak sil</summary><p>Site içeriği, görseller ve yayın geçmişi silinir. Klinik randevu kayıtları korunur.</p>'.
                    '<form method="post" class="controls">'.$target.'<label>Onay için <strong>'.$e($row['slug']).'</strong> yazın<input name="confirm_slug" required></label>'.
                    '<button name="site_action" value="delete" class="danger">Siteyi sil</button></form></details></li>';
            }
            $html.=($rows?'</ul>':'').WebBuilderAdmin::pagination($page,$last,$centerUrl).'</section>'.
                '<details class="management-list package-settings"><summary>Paket yetkileri ve depolama kotaları</summary>'.$packages.'</details></main>';
            self::body(WebBuilderAdmin::page('Web Sitesi Yönetimi',$html));
        }
        $preview=false;
        $actor=null;
        if (!$external && ($path==='/web-sitem' || str_starts_with($path,'/web-sitem/'))) {
            $centerEditor=preg_match('~\A(/web-sitem/merkez/([A-Za-z0-9_-]{1,80}))(?=/|$)~D',$path,$centerPath);
            $editor=$centerEditor?$centerPath[1]:'/web-sitem';
            try {
                if ($centerEditor) {
                    $center=new Center($db,$config);
                    $actor=$center->requireOwner($_COOKIE,$now,$method==='POST');
                    $actor['partner_id']=$centerPath[2];
                    $path='/web-sitem'.substr($path,strlen($editor));
                    $admin=new WebBuilderAdmin($web,$editor);
                } else {
                    $actor=$workspaces->actor($_COOKIE,$now);
                }
            } catch (RuntimeException $error) {
                if ($path==='/web-sitem' && in_array($error->getCode(),[401,403],true)) {
                    self::editorError('Web Sitem bölümünü açmak için VetZimo’e bayi yöneticisi hesabıyla giriş yapın.',403);
                }
                throw $error;
            }
            if (!$centerEditor && !$web->allowed($actor)) {
                $message=($actor['role']??'')==='dealer'?'Web Sitem bu bayi paketinde etkin değil. Merkez yöneticinizle iletişime geçin.':
                    'Web Sitem bölümünü yönetmek için bayi yöneticisi hesabı gerekir.';
                if ($path==='/web-sitem') self::editorError($message,403);
                throw new RuntimeException($message,403);
            }
            $row=$web->site($actor['partner_id']);
            if ($centerEditor && !$row) self::editorError('Düzenlenecek site bulunamadı.',404);
            $tab=is_string($_GET['tab']??null)&&isset(WebBuilderAdmin::TABS[$_GET['tab']])?$_GET['tab']:'genel';
            if ($path==='/web-sitem') {
                if ($method==='POST') {
                    try {
                        if (!$_POST && (int)($_SERVER['CONTENT_LENGTH']??0)>0) {
                            throw new RuntimeException('Form sunucuya ulaşmadı. Daha küçük bir görsel seçin veya görsel olmadan kaydedin.',413);
                        }
                        $tab=$admin->save($actor,$row,$_POST,$_FILES);
                        if ($centerEditor) $center->audit($actor['account_id'],'web.site.edit',$actor['partner_id']);
                        $return=['tab'=>$tab];
                        if ($tab==='yayin' && ($_POST['action']??'')==='publish') $return['yayinda']='1';
                        if (in_array($tab,['ekibimiz','ailemiz','blog'],true) && !empty($_POST['id']) && is_string($_POST['id']) && ($_POST['action']??'')!=='delete') $return['id']=$_POST['id'];
                        $fragment='';
                        if (in_array($tab,['ailemiz','blog'],true)) {
                            $return['sayfa']=WebBuilderAdmin::pageNumber($_POST['sayfa']??1);
                            $fragment=($tab==='blog'?'#blog':'#gallery').(isset($return['id'])?'-editor':'-list');
                        }
                        $location=$editor.'?'.http_build_query($return).$fragment;
                        if (self::editorRequest()) \reply(['location'=>$location]);
                        header('Location: '.$location,true,303);exit;
                    } catch (RuntimeException $e) {
                        $code=$e->getCode();
                        if (!in_array($code,[404,409,413,422,503],true)) throw $e;
                        if (self::editorRequest()) \reply(['error'=>$e->getMessage()],$code);
                        $currentTab=$_POST['tab']??$tab;
                        if (is_string($currentTab) && isset(WebBuilderAdmin::TABS[$currentTab])) $tab=$currentTab;
                        $edit=$_GET;
                        foreach (['page','id','sayfa'] as $key) if (is_string($_POST[$key]??null)) $edit[$key]=$_POST[$key];
                        if ($code===409 && $row && (int)($_POST['revision']??0)!==(int)$row['revision']) {
                            $row['revision']=(int)($_POST['revision']??0);
                        }
                        self::body($admin->render($actor,$row,$tab,$edit,$e->getMessage(),$_POST),$code);
                    }
                }
                self::body($admin->render($actor,$row,$tab,$_GET));
            }
            if (!$row || $method!=='GET') throw new RuntimeException('Sayfa bulunamadı.',404);
            if (preg_match('~\A/web-sitem/medya/([a-f0-9]{32})\z~D',$path,$m)) self::image($web,$row,$m[1]);
            if (!preg_match('~\A/web-sitem/onizleme(?:/(.*))?\z~D',$path,$m)) throw new RuntimeException('Sayfa bulunamadı.',404);
            $preview=true;
            $route=$m[1]??'';
            $base=$editor.'/onizleme';
            $draft=WebBuilder::decode($row['draft']);
        } else {
            if ($external) {
                if (!$web->hostReady($host)) self::missing();
                $row=$web->publicSite($host,true);
                if (!$row && ($zone=$config['webBuilderZone']??'') && str_ends_with($host,'.'.$zone)) {
                    $candidate=$web->publicSite(substr($host,0,-strlen($zone)-1));
                    if ($candidate && $web->base($candidate)==='https://'.$host) $row=$candidate;
                }
                $route=trim($path,'/');
            } else {
                if (!preg_match('~\A/(web|siteler)/([a-z0-9-]{1,63})(?:/(.*))?\z~D',$path,$m)) self::missing();
                $row=$web->publicSite($m[2]);
                $route=rtrim($m[3]??'','/');
                if ($row && $m[1]==='siteler' && $method==='GET') {
                    $suffix=$route===''?'':'/'.implode('/',array_map(rawurlencode(...),explode('/',$route)));
                    header('Location: /web/'.$row['slug'].$suffix.($_GET?'?'.http_build_query($_GET):''),true,301);
                    exit;
                }
            }
            if (!$row) self::missing();
            $base=$external?'https://'.$host:$config['origin'].'/web/'.$row['slug'];
            $draft=WebBuilder::decode($row['snapshot']);
            if (!$external && in_array($route,['randevu','evde-hizmet','evden-takip'],true)) $actor=$sessions->resolve($_COOKIE,$now);
        }
        if ($method==='GET' && preg_match('~\Amedya/([a-f0-9]{32})\z~D',$route,$m)) {
            if (!$preview) {
                $publicDraft=$draft;
                foreach (['team','blog','gallery'] as $group) $publicDraft[$group]=array_filter($draft[$group]??[],static fn($record)=>
                    !empty($record['visible']) && ($group!=='blog'||$record['date']<=WebBuilder::today()) &&
                    ($group!=='gallery'||!empty($record['consent'])));
                if (!in_array($m[1],WebBuilder::mediaIds($publicDraft),true)) self::missing();
            }
            self::image($web,$row,$m[1],!$preview);
        }
        if (!$preview && $route==='evden-takip' && $method==='GET') {
            $origin=rtrim($config['origin'],'/');
            $destination=(($actor['role']??'')==='customer' && $actor['partner_id']===$row['partner_id'])
                ? '/hasta-sahibi?bildirim=homecare'
                : '/giris?'.http_build_query(['donus'=>'/web/'.$row['slug'].'/evden-takip']);
            header('Location: '.$origin.$destination,true,303);
            exit;
        }
        $visitCatalog=[];
        if (!$preview && class_exists(HomeVisit::class)) {
            $visits=new HomeVisit($db,$config);
            $visitCatalog=$visits->publicCatalog($row['partner_id']);
        }
        $visitForm='';
        if ($route==='evde-hizmet' && $visitCatalog) {
            $partner=$row['partner_id'];
            if (($actor['role']??'')!=='customer'||$actor['partner_id']!==$partner) $actor=null;
            $pages=new HomeVisitPages($visits,$db);
            $target=$base.'/evde-hizmet';
            $status=200;
            $notice='';
            if ($method==='POST') {
                try {
                    (new DealerLogin($db,$config['rateSecret']))->throttle('visit:public:'.$row['slug'].':request:'.$partner.':'.($_SERVER['REMOTE_ADDR']??''),$now);
                    $pages->submitRequest($partner,$actor,$_POST);
                    header('Location: '.$target.'?alindi=1#basvuru',true,303);
                    exit;
                } catch (RuntimeException $error) {
                    $status=$error->getCode();
                    if (!in_array($status,[403,404,409,422,429],true)) throw $error;
                    $notice=$error->getMessage();
                }
            }
            $success=$method==='GET'&&($_GET['alindi']??'')==='1';
            $login=$config['origin'].'/giris?'.http_build_query(['donus'=>'/web/'.$row['slug'].'/evde-hizmet']);
            $visitForm=$success?
                '<section id="basvuru" class="visit-application"><div class="notice" role="status"><h2>Talebiniz alındı.</h2><p>'.
                ($actor?'Klinik yanıtını hasta sahibi panelinizden takip edebilirsiniz.</p><a class="button" href="/hasta-sahibi?bildirim=visit">Taleplerimi göster</a>':
                    'Takip bağlantısı e-posta adresinize gönderilmek üzere sıraya alındı.</p>').
                '</div><p><a href="'.WebBuilderAdmin::e($target).'">Yeni başvuru oluştur</a></p></section>':
                (!$actor?'<p class="visit-signin">VetZimo hesabınız varsa <a href="'.WebBuilderAdmin::e($login).'">giriş yapın</a> veya aşağıdan ziyaretçi olarak başvurun.</p>':'').
                $pages->requestForm($partner,$visitCatalog,$actor,$method==='POST'?$_POST:[],$target);
            if ($method==='POST') {
                [$code,$html]=$public->render($row,$draft,$base,$route,[],$actor,false,$notice,$visitCatalog,$visitForm);
                self::body($html,$status);
            }
        }
        if (!$preview && $method==='GET' && $route==='sitemap.xml') {
            if (!($draft['settings']['index']??true)) self::missing();
            header('Content-Type: application/xml; charset=utf-8');echo $public->sitemap($row,$draft);exit;
        }
        if (!$preview && $method==='GET' && $route==='robots.txt') {
            header('Content-Type: text/plain; charset=utf-8');echo ($draft['settings']['index']??true)?
                "User-agent: *\nAllow: /\nSitemap: ".$web->base($row)."/sitemap.xml\n":"User-agent: *\nDisallow: /\n";exit;
        }
        if (!$preview && $method==='GET' && isset($draft['settings']['redirects'][$route])) {
            header('Location: '.$base.'/'.$draft['settings']['redirects'][$route],true,301);exit;
        }
        if (!$preview && $method==='GET' && in_array($route,['t/telefon','t/yol-tarifi'],true)) {
            $tel=$route==='t/telefon';
            $value=$draft['contact'][$tel?'phone':'directions']??'';
            if (!$value) self::missing();
            $web->stat($row['partner_id'],$tel?'calls':'directions');
            if ($tel && ($_GET['count']??'')==='yes') { http_response_code(204);exit; }
            if ($tel) self::body(WebBuilderAdmin::page('Telefon','<main class="center-view"><p>Kliniği arayın</p><a class="button" href="tel:'.WebBuilderAdmin::e($value).'">'.WebBuilderAdmin::e($value).'</a></main>'));
            header('Location: '.$value,true,302);exit;
        }
        if ($method==='POST') {
            if ($preview || !in_array($route,['randevu','iletisim'],true)) self::missing();
            $source=$_SERVER['REMOTE_ADDR']??'';
            $status=200;$notice='';
            try {
                if (($_POST['website']??'')!=='') throw new RuntimeException('Form doğrulanamadı.',422);
                (new DealerLogin($db,$config['rateSecret']))->throttle('web-form:'.$route.':'.$row['partner_id'].':'.$source,$now);
                if ($route==='randevu') {
                    WebBooking::verifyMath($row['partner_id'],$config['rateSecret'],$now,$_POST);
                    $action=$_POST['action']??'';
                    if ($action==='move' || $action==='cancel') {
                        $booking->change($row,$draft,$actor,$_POST);
                        header('Location: /hasta-sahibi?'.($action==='move'?'randevu=guncellendi':'randevu=iptal'),true,303);
                        exit;
                    }
                    $booking->book($row,$draft,$actor,$_POST);
                    $notice='Randevu talebiniz alındı.';
                } else {
                    if (empty($draft['settings']['contact'])) self::missing();
                    WebBooking::verifyMath('contact:'.$row['partner_id'],$config['rateSecret'],$now,$_POST);
                    $message=['name'=>WebBuilder::text($_POST['name']??'',160),'email'=>WebBuilder::text($_POST['email']??'',254),
                        'body'=>WebBuilder::text($_POST['body']??'',3000)];
                    if (!$message['name'] || !$message['body'] || !filter_var($message['email'],FILTER_VALIDATE_EMAIL) ||
                        ($_POST['consent']??'')!=='yes') throw new RuntimeException('Ad, geçerli e-posta, mesaj ve aydınlatma onayı gerekli.',422);
                    $message['privacy_sha256']=hash('sha256',$draft['settings']['contactPrivacy']??'');
                    $web->query('INSERT INTO clinic_web_inbox(partner_id,message,notify_at) VALUES (?,?,?)',
                        [$row['partner_id'],WebBuilder::json($message),!empty($draft['settings']['contactMail'])?$now:null]);
                    $web->stat($row['partner_id'],'contact');
                    $notice='Mesajınız kliniğe ulaştı.';
                }
            } catch (RuntimeException $error) {
                $status=$error->getCode();
                if (!in_array($status,[404,409,422,429],true)) throw $error;
                $notice=$error->getMessage();
            }
            if ($status===200) {
                header('Location: '.$base.'/'.$route.'?alindi=1',true,303);
                exit;
            }
            [$code,$html]=$public->render($row,$draft,$base,$route,$_POST,$actor,false,$notice,$visitCatalog);
            self::body($html,$status);
        }
        if ($method!=='GET') self::missing();
        $notice=(!$preview && ($_GET['alindi']??'')==='1')?match($route){
            'randevu'=>'Randevu talebiniz alındı.','iletisim'=>'Mesajınız kliniğe ulaştı.',default=>'',
        }:'';
        [$code,$html,$articleId]=$public->render($row,$draft,$base,$route,$_GET,$actor,$preview,$notice,$visitCatalog,$visitForm);
        if (!$preview && $code===200 && empty($_SERVER['HTTP_SEC_PURPOSE'])) {
            $key=explode('/',$route,2)[0];
            $web->stat($row['partner_id'],'page:'.$key);
            if ($articleId!==null) $web->stat($row['partner_id'],'article:'.$articleId);
            $cookie='__Host-wb-'.substr(hash('sha256',$row['partner_id']),0,12);
            if (empty($_COOKIE[$cookie])) {
                $web->stat($row['partner_id'],'visits');
                setcookie($cookie,'1',['expires'=>$now+1800,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Lax']);
            }
        }
        self::body($html,$code,$preview);
    }
    private static function missing(): never
    {
        self::body(WebBuilderAdmin::page('Sayfa bulunamadı','<main class="center-view"><h1>Sayfa bulunamadı</h1></main>'),404);
    }
}
