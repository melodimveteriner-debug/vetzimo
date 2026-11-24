<?php
declare(strict_types=1);

use VetNet\Cpanel\ClinicApi;
use VetNet\Cpanel\ClinicAccess;
use VetNet\Cpanel\IdentityApi;
use VetNet\Cpanel\Center;
use VetNet\Cpanel\Database;
use VetNet\Cpanel\DealerLogin;
use VetNet\Cpanel\DealerWorkspace;
use VetNet\Cpanel\SessionRepository;

require_once dirname(__DIR__).'/src/StaffPlan.php';

foreach (['NativeApp','UiLocale','Totp','AppointmentReminders','Center','CenterManagement','MarketText','CreditShop','Notifications','ClinicContact','Weather','ExternalImport','ClinicTransfer','BulkClinicMessages','ClinicAccess','WebBuilder','WebBuilderAdmin','WebBuilderPublic','WebBooking','WebBuilderRoutes','HomeCare','HomeVisit','HomeVisitPages','DeliveryNotice','WorkspaceRepository','Database','DealerLogin','SessionRepository','DealerWorkspace','WorkspaceStream','Finance','ClinicApi','IdentityApi','PrintTemplates','Support','Commerce','Appearance'] as $class) {
    require dirname(__DIR__) . '/src/' . $class . '.php';
}

function reply(array $body, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function input(int $limit): object {
    if (!preg_match('~\Aapplication/json(?:\s*;|\z)~i', $_SERVER['CONTENT_TYPE'] ?? '')) {
        throw new RuntimeException('JSON içerik bekleniyor.', 415);
    }
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) throw new RuntimeException('İstek çok büyük.', 413);
    try {
        $value = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('JSON içeriği geçersiz.', 400);
    }
    if (!$value instanceof stdClass) throw new RuntimeException('JSON nesnesi bekleniyor.', 400);
    return $value;
}

function marketAndPanelFavicon(string $html,string $assets): string {
    return preg_replace('~<link\s+rel="icon"[^>]*>~',
        '<link rel="icon" href="/favicon.ico?v=51" type="image/x-icon">',$html,1) ?? $html;
}

function sessionCookie(string $name, string $value, int $expires): void {
    setcookie($name, $value, [
        'expires'=>$expires, 'path'=>'/', 'secure'=>true, 'httponly'=>true, 'samesite'=>'Strict',
    ]);
}

ini_set('display_errors','0');
// JSON yanıtlarını sıkıştır (büyük çalışma alanlarında aktarımı ~10 kat küçültür).
if (extension_loaded('zlib') && !ini_get('zlib.output_compression')) ini_set('zlib.output_compression','1');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

try {
    if (($_SERVER['HTTPS'] ?? '') !== 'on' && ($_SERVER['HTTPS'] ?? '') !== '1') {
        throw new RuntimeException('HTTPS bağlantısı gerekli.', 400);
    }
    $configPath = getenv('VETNET_CPANEL_CONFIG') ?: dirname(__DIR__) . '/config.php';
    if (!is_file($configPath)) throw new RuntimeException('PHP yapılandırması eksik.', 503);
    $config = require $configPath;
    $origin = $config['origin'];
    $method = $_SERVER['REQUEST_METHOD'];
    // REQUEST_URI is a request target. Leading // is part of its path.
    [$rawPath,$queryString] = array_pad(explode('?',$_SERVER['REQUEST_URI'],2),2,'');
    $path = '/'.ltrim($rawPath,'/');
    if ($method==='GET' && $rawPath!==$path && in_array(rtrim($path,'/'),['/klinik','/yonetim','/app','/giris','/hasta-sahibi'],true)) {
        header('Location: '.rtrim($path,'/').($queryString!=='' ? '?'.$queryString : ''),true,308);
        exit;
    }
    if (in_array($path, ['/app/','/giris/','/hasta-sahibi/','/yonetim/','/klinik/'], true)) {
        header('Location: '.rtrim($path,'/'),true,308);
        exit;
    }
    // Giriş adresi /app oldu. Eski /giris bağlantıları (e-postalardaki etkinleştirme bağlantıları dahil)
    // kalıcı olarak yönlenir; tarayıcı # sonrasını korur.
    if ($path === '/giris') {
        header('Location: /app'.($queryString!=='' ? '?'.$queryString : ''),true,$method==='GET'||$method==='HEAD'?301:308);
        exit;
    }
    if (preg_match('~\A(?:/api/(?:vebot(?:/|$)|ops/tools/?$)|/platform/ozellikler/vebot/?$)~i',$path)) {
        throw new RuntimeException('Sayfa bulunamadı.',404);
    }
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $originHost = strtolower((string)parse_url($origin, PHP_URL_HOST));
    $originPort = parse_url($origin, PHP_URL_PORT) ?? 443;
    $primaryHost = $host === $originHost.':'.$originPort || ($originPort===443 && $host===$originHost);
    $externalWeb = !$primaryHost && VetNet\Cpanel\WebBuilder::acceptsHost($config,$host);
    if (!$primaryHost && !$externalWeb) throw new RuntimeException('Site bulunamadı.',404);
    if ($primaryHost && $path==='/.well-known/assetlinks.json' && in_array($method,['GET','HEAD'],true)) {
        header('Content-Type: application/json; charset=utf-8');
        $hashes=array_values(array_unique(array_values(array_filter((array)($config['androidWebAppFingerprints']??[]),
            static fn($fingerprint)=>is_string($fingerprint)&&preg_match('/\A(?:[A-F0-9]{2}:){31}[A-F0-9]{2}\z/D',$fingerprint)))));
        $links=$hashes?[['relation'=>['delegate_permission/common.handle_all_urls'],
            'target'=>['namespace'=>'android_app','package_name'=>'com.vetzimo.vetzimo',
                'sha256_cert_fingerprints'=>$hashes]]]:[];
        if ($method==='GET') echo json_encode($links,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        exit;
    }
    if ($primaryHost && $path==='/uygulama' && in_array($method,['GET','HEAD'],true)) {
        header("Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        header('Content-Type: text/html; charset=utf-8');
        if ($method==='GET') readfile(__DIR__.'/vetzimo-kurulum.html');
        exit;
    }
    if ($method !== 'GET' && !hash_equals($externalWeb ? 'https://'.$host : $origin, $_SERVER['HTTP_ORIGIN'] ?? '')) {
        if (!$externalWeb && $path==='/klinik/evde-hizmet' && ($_GET['gorunum']??'')==='ayarlar') {
            VetNet\Cpanel\HomeVisitPages::settingsError('İstek kaynağı doğrulanamadı. Ayarları VetZimo üzerinden yeniden açıp kaydetmeyi deneyin.',403);
        }
        if (!$externalWeb && $path==='/web-sitem') {
            VetNet\Cpanel\WebBuilderRoutes::editorError('Formun kaynağı doğrulanamadı. Web Sitem bölümünü VetZimo panelinden yeniden açın ve tekrar deneyin.',403);
        }
        throw new RuntimeException('İstek kaynağı doğrulanamadı.', 403);
    }
    if (!$externalWeb && $method === 'GET' && ($path === '/' || $path === '/platform' || str_starts_with($path,'/platform/'))) {
        $marketPath=$path==='/' ? '/platform' : rtrim($path,'/');
        $key = hash('sha256',$marketPath);
        $file = rtrim($config['assets'],'/').'/market-pages/'.$key.'.html';
        if (!is_file($file)) throw new RuntimeException('Sayfa bulunamadı.',404);
        header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
        header('Content-Type: text/html; charset=utf-8');
        $marketDb = Database::connect($config['dsn'],$config['username'],$config['password']);
        $theme = (new VetNet\Cpanel\Appearance($marketDb))->read();
        $html = marketAndPanelFavicon(file_get_contents($file),$config['assets']);
        $page = (new VetNet\Cpanel\CenterManagement($marketDb,new Center($marketDb,$config)))->market($marketPath);
        if ($page) {
            $fields=[];
            $html=VetNet\Cpanel\MarketText::transform($html,$page['edits'] ?? [],$fields);
            $title=htmlspecialchars($page['title'],ENT_QUOTES,'UTF-8');
            $description=htmlspecialchars($page['description'],ENT_QUOTES,'UTF-8');
            $html=preg_replace_callback('~<title>.*?</title>~s',static fn()=>'<title>'.$title.' · VetZimo</title>',$html,1);
            $html=preg_replace_callback('~<meta name="description" content="[^"]*">~',static fn()=>'<meta name="description" content="'.$description.'">',$html,1);
            $html=preg_replace_callback('~(<h1[^>]*>).*?(</h1>)~s',static fn($m)=>$m[1].$title.$m[2],$html,1);
            if (!empty($page['section_title']) || !empty($page['section_text'])) {
                $escape=static fn(string $value)=>htmlspecialchars($value,ENT_QUOTES,'UTF-8');
                $section='<section class="block"><h2>'.$escape($page['section_title'] ?? '').'</h2><p>'.
                    nl2br($escape($page['section_text'] ?? '')).'</p>';
                $sectionUrl=$page['section_url'] ?? '';
                if (filter_var($sectionUrl,FILTER_VALIDATE_URL) && strtolower((string)parse_url($sectionUrl,PHP_URL_SCHEME))==='https') $section.='<a class="button outline" href="'.$escape($sectionUrl).'">Ayrıntıları incele</a>';
                $html=preg_replace_callback('~</main>~',static fn()=>$section.'</section></main>',$html,1);
            }
        }
        if ($marketPath==='/platform/paketler') {
            $cards=(new VetNet\Cpanel\Commerce($marketDb))->marketPackages();
            $html=preg_replace_callback('~<!-- vetnet-package-catalog -->.*?<!-- /vetnet-package-catalog -->~s',static fn()=>$cards,$html,1);
        }
        $html=str_replace(['VeTNeT','VETNET'],['VetZimo','VETZIMO'],$html);
        $palette = htmlspecialchars($theme['palette'],ENT_QUOTES,'UTF-8');
        $html = preg_replace('~<html lang="tr"[^>]*>~', '<html lang="tr" data-site-palette="'.$palette.'" data-theme-lock="'.($theme['locked']?'true':'false').'" data-theme="'.($palette ?: 'classic').'">', $html, 1);
        echo VetNet\Cpanel\UiLocale::page($html,$config);
        exit;
    }
    if (!$externalWeb && $method === 'GET' && in_array($path, ['/klinik', '/app','/hasta-sahibi','/yonetim'], true)) {
        if ($path === '/klinik') {
            $db = Database::connect($config['dsn'], $config['username'], $config['password']);
            $actor = (new SessionRepository($db))->resolve($_COOKIE, time());
            if (!in_array($actor['role'] ?? '',['dealer','branch','staff'],true)) {
                header('Location: /app', true, 303);
                exit;
            }
        }
        $file = rtrim($config['assets'], '/') . (match ($path) {
            '/klinik' => '/index.html',
            '/yonetim' => '/identity-merkez-20261123-r65.html',
            default => '/identity.html',
        });
        if (!is_readable($file)) throw new RuntimeException('VetZimo arayüz dosyaları eksik.', 503);
        header("Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; frame-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        header('Content-Type: text/html; charset=utf-8');
        $html = marketAndPanelFavicon(file_get_contents($file),$config['assets']);
        $pwa = '<link rel="manifest" href="/vetzimo.webmanifest"><link rel="apple-touch-icon" href="/vetzimo-pwa-192.png"><script defer src="/pwa-install.js?v=68"></script>';
        echo VetNet\Cpanel\UiLocale::page(str_ireplace('</head>',$pwa.'</head>',$html),$config);
        exit;
    }
    if (!$externalWeb && $path === '/api/identity/config' && $method === 'GET') {
        reply(['preview'=>false,'clinic'=>null,'captchaSiteKey'=>'']);
    }
    if (!$externalWeb && str_starts_with($path,'/api/locations/')) {
        if ($method!=='GET') {
            header('Allow: GET');
            reply(['error'=>'Yalnızca listeleme desteklenir.'],405);
        }
        if (!preg_match('~\A/api/locations/(districts|neighborhoods)/([1-9][0-9]{0,5})\z~D',$path,$location)) {
            reply(['error'=>'Adres listesi bulunamadı.'],404);
        }
        if (!is_readable(dirname(__DIR__).'/database/visit-addresses.json')) {
            reply(['error'=>'Adres veri dosyası yüklenemedi.'],503);
        }
        $items=array_map(static fn(array $entry): array=>['id'=>$entry[0],'name'=>$entry[1]],
            VetNet\Cpanel\HomeVisit::location($location[1],(int)$location[2]));
        if (class_exists(Collator::class)) {
            $turkish=new Collator('tr_TR');
            usort($items,static fn(array $a,array $b): int=>$turkish->compare($a['name'],$b['name']));
        }
        reply(['items'=>$items]);
    }
    if (!$externalWeb && preg_match('~\A/(?:web-sitem(?:/[^/]+)?|yonetim/web-siteleri|(?:klinik/|yonetim/|hasta-sahibi/)?evde-hizmet(?:/takip)?)\z~D',$path)) {
        ob_start(static fn(string $html): string => stripos($html,'<!doctype html')===0
            ? VetNet\Cpanel\UiLocale::page($html,$config) : $html);
    }
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $now = time();
    $sessions = new SessionRepository($db);
    $workspaces = new DealerWorkspace($db);
    if (!$externalWeb && preg_match('~\A/api/app/v1/(patients|appointments|exams|sales|collections|payments|expenses|products|stockLots|stockMoves|labs|home-visits|inbox|device|deletion|management)(?:/([A-Za-z0-9_-]{1,80}))?\z~D',$path,$match)) {
        $route=$match[1]; $record=$match[2]??null;
        $readOnly=array_key_exists($route,VetNet\Cpanel\NativeApp::RECORD_FIELDS)||$route==='home-visits';
        if ($record!==null && !$readOnly && $route!=='inbox') throw new RuntimeException('İşlem bulunamadı.',404);
        $allowed=($record!==null || $readOnly)&&!(in_array($route,['labs','sales','products','stockLots'],true)&&$record!==null)?['GET']:['GET','POST'];
        if (!in_array($method,$allowed,true)) { header('Allow: '.implode(', ',$allowed)); throw new RuntimeException('Yöntem desteklenmiyor.',405); }
        $app=new VetNet\Cpanel\NativeApp($db,$config);
        $actor=$sessions->resolve($_COOKIE,$now);
        if (!$actor) throw new RuntimeException('Oturum doğrulanamadı.',401);
        if ($route==='management') {
            if ($actor['kind']!=='center' || !(int)$actor['is_owner'] || !hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Merkez yetkisi gerekli.',403);
            if ($method==='POST' && $now-(int)$actor['reauth_at']>300) throw new RuntimeException('Merkez oturumunu yeniden doğrulayın.',403);
            reply($app->management($method==='POST'?input(4096):null));
        }
        if ($actor['kind']!=='phone' || !hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        if ($actor['role']==='customer') $actor=(new IdentityApi($db))->actor($_COOKIE,$now);
        if (in_array($route,['products','stockLots'],true) && $record!==null && $method==='POST')
            reply($app->moveStock($actor,$route,$record,$_COOKIE,$now,input(4096)));
        if ($route==='sales' && $record!==null && $method==='POST') reply($app->collectSale($actor,$record,$_COOKIE,$now,input(4096)));
        if ($route==='labs' && $record!==null && $method==='POST') reply($app->updateLab($actor,$record,$_COOKIE,$now,input(22000)));
        if (isset(VetNet\Cpanel\NativeApp::RECORD_FIELDS[$route])) reply($app->records($actor,$route,$record,$_GET['offset']??'0'));
        $data=$method==='POST'?input(8192):null;
        reply(match($route) {
            'home-visits'=>$app->homeVisits($actor,$record),
            'inbox'=>$app->inbox($actor,$now,$data,$record),
            'device'=>$app->device($actor,$_COOKIE,$now,$data),
            'deletion'=>$app->deletion($actor,$now,$data),
        });
    }
    if (!$externalWeb && $path==='/hesap-silme' && in_array($method,['GET','POST'],true)) {
        $actor=$sessions->resolve($_COOKIE,$now);
        $form='';
        if (($actor['kind']??'')==='phone') {
            $app=new VetNet\Cpanel\NativeApp($db,$config);
            if ($method==='POST') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('app-deletion:'.($_SERVER['REMOTE_ADDR']??''),$now);
                $password=$_POST['password']??null;
                if (!is_string($password) || ($_POST['confirm']??'')!=='yes') throw new RuntimeException('Onay gerekli.',422);
                (new IdentityApi($db))->reauth($_COOKIE,$actor,$password,$now);
                $actor=$sessions->resolve($_COOKIE,$now);
                if (!$actor) throw new RuntimeException('Oturum doğrulanamadı.',401);
                $app->deletion($actor,$now,(object)['confirm'=>true]);
                header('Location: /hesap-silme',true,303); exit;
            }
            $form=$app->deletion($actor,$now,null)['requestedAt']
                ? '<p>Hesap silme talebiniz alındı.</p>'
                : '<form method="post"><label>Şifreniz <input name="password" type="password" autocomplete="current-password" required></label><p><label><input type="checkbox" name="confirm" value="yes" required> Hesabımın silinmesini talep ediyorum.</label></p><button type="submit">Talebi gönder</button></form>';
        } elseif ($method==='POST') throw new RuntimeException('Oturum doğrulanamadı.',401);
        else $form='<p>Talep oluşturmak için <a href="/app">VetZimo hesabınızla giriş yapın</a> ve bu sayfaya dönün.</p>';
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VetZimo · Hesap silme</title><style>body{font:1rem/1.6 system-ui;margin:3rem auto;padding:0 1.2rem;max-width:38rem}input,button{font:inherit}</style><main><h1>Hesap silme talebi</h1><p>Talep mevcut VetZimo hesabınız için kaydedilir ve yönetim tarafından incelenir. Talep kaydı, silmenin tamamlandığı anlamına gelmez.</p>'.$form.'<p><a href="/platform/gizlilik">Gizlilik bilgilendirmesi</a></p></main></html>';
        exit;
    }
    if ($path==='/api/evde-hizmet/konum'||(!$externalWeb && in_array($path,['/klinik/evde-hizmet','/hasta-sahibi/evde-hizmet','/yonetim/evde-hizmet',
        '/evde-hizmet','/evde-hizmet/takip','/api/evde-hizmet/bildirim'],true))) {
        $actor=$sessions->resolve($_COOKIE,$now);
        if ($actor && in_array($actor['role']??'',['dealer','branch','staff'],true)) {
            $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
        }
        (new VetNet\Cpanel\HomeVisitPages(new VetNet\Cpanel\HomeVisit($db,$config),$db))->handle($path,$method,$actor,$now);
    }

    if ($externalWeb || preg_match('~\A(?:/(?:web|siteler)(?:/|$)|/web-sitem(?:/|$)|/yonetim/web-siteleri$|/api/web-builder/alerts$)~D',$path)) {
        VetNet\Cpanel\WebBuilderRoutes::handle($db,$config,$workspaces,$sessions,$path,$method,$host,$externalWeb,$now);
    }
    $appearance = new VetNet\Cpanel\Appearance($db);
    if ($path === '/api/saas/appearance' && $method === 'GET') reply($appearance->read());
    if ($path === '/api/identity/appearance' && $method === 'POST') {
        $actor = $workspaces->actor($_COOKIE,$now);
        if (($_SERVER['HTTP_X_VETNET_SCOPE'] ?? '') !== $actor['membership_id']) throw new RuntimeException('Klinik oturumu değişti.',409);
        if ($appearance->read()['locked']) throw new RuntimeException('Tema merkez yönetiminden kilitli.',403);
        reply($appearance->save('account:'.$actor['account_id'],input(4096)));
    }


    if ($path === '/api/saas/applications' && $method === 'POST') {
        (new DealerLogin($db,$config['rateSecret']))->throttle('sales:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        reply((new VetNet\Cpanel\Commerce($db))->submit(input(16000),$config['rateSecret'],new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? '')));
    }
    if ($path === '/api/saas/my-subscription' && $method === 'GET') {
        $actor = $workspaces->actor($_COOKIE,$now);
        if ($actor['role'] !== 'dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        reply((new VetNet\Cpanel\Commerce($db))->subscription($actor['partner_id']));
    }
    if ($path === '/api/identity/center/login' && $method === 'POST') {
        $result=(new Center($db,$config))->login(input(4096),$_SERVER['REMOTE_ADDR'] ?? '',$now,true);
        if(!$result) throw new RuntimeException('Giriş bilgileri doğrulanamadı.',401);
        $oldToken=$_COOKIE[SessionRepository::SESSION_COOKIE] ?? ''; $oldDevice=$_COOKIE[SessionRepository::DEVICE_COOKIE] ?? '';
        if(is_string($oldToken)&&is_string($oldDevice)) (new DealerLogin($db,$config['rateSecret']))->signOut($oldToken,$oldDevice);
        sessionCookie(SessionRepository::SESSION_COOKIE,$result['token'],$now+$result['age']);
        sessionCookie(SessionRepository::DEVICE_COOKIE,$result['device'],$now+$result['age']);
        reply(['ok'=>true,'destination'=>'/yonetim']);
    }
    if ($method==='GET' && $path==='/api/clinic/weather') {
        $visible=(object)['branches'=>$workspaces->visibleBranches($workspaces->actor($_COOKIE,$now))];
        $branchId=$_GET['branch'] ?? '';
        $branch=is_string($branchId) && $visible ? ClinicAccess::branch($visible,$branchId) : null;
        if (!$branch) throw new RuntimeException('Şube bulunamadı.',403);
        reply(VetNet\Cpanel\Weather::read($branch->city ?? '',$_GET,$config['weatherApiKey'] ?? '',$origin));
    }
    if ($path==='/api/clinic/center-publications' && $method==='GET') {
        $actor=$workspaces->actor($_COOKIE,$now);
        reply(['items'=>(new VetNet\Cpanel\CenterManagement($db,new Center($db,$config)))->published($actor['partner_id'])]);
    }
    if (in_array($path,['/api/ops/shop','/api/ops/shop/order','/api/ops/shop/reference','/api/saas/store'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $shop=new VetNet\Cpanel\CreditShop($db,new VetNet\Cpanel\CenterManagement($db,new Center($db,$config)));
        if ($method==='GET' && $path==='/api/ops/shop') reply($shop->catalog($actor));
        if ($method==='GET' && $path==='/api/saas/store') reply([
            'scopeId'=>$actor['membership_id'],'bank'=>false,'orders'=>[],
            'subscription'=>(new VetNet\Cpanel\Commerce($db))->subscription($actor['partner_id']),
            'plans'=>array_map(static fn($plan)=>$plan+['card'=>false,'purchasable'=>false],array_values((new VetNet\Cpanel\Commerce($db))->publishedCatalog())),
        ]);
        if ($method==='POST' && in_array($path,['/api/ops/shop/order','/api/ops/shop/reference'],true)) {
            if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            $body=input(4096);
            if ($path==='/api/ops/shop/order') reply($shop->order($actor,$body));
            $shop->reference($actor,$body);
            reply(['ok'=>true]);
        }
        throw new RuntimeException('Mağaza işlemi desteklenmiyor.',405);
    }
    if ($method==='POST' && $path==='/api/ops/cache') {
        $actor=$workspaces->actor($_COOKIE,$now);
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        header('Clear-Site-Data: "cache"');
        reply(['ok'=>true]);
    }
    if ($path==='/api/ops/notices' && in_array($method,['GET','POST'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        $grant=ClinicAccess::modules($actor)->support ?? 'none';
        if (isset($actor['packageModules']) && !in_array($grant,['read','write'],true)) reply(['count'=>0,'rows'=>[]]);
        reply((new VetNet\Cpanel\Support($db))->notices($actor,$method==='POST' ? input(1024) : null));
    }
    if ($path==='/api/ops/feed' && in_array($method,['GET','POST'],true)) {
        // Eski içerik akışı merkez yayınlarına (/api/clinic/center-publications) taşındı.
        $workspaces->actor($_COOKIE,$now);
        reply($method==='POST' ? ['ok'=>true] : ['items'=>[],'urgent'=>null]);
    }
    if ($method==='GET' && $path==='/api/ops/releases') {
        $workspaces->actor($_COOKIE,$now);
        $management=new VetNet\Cpanel\CenterManagement($db,new Center($db,$config));
        $rows=$management->rows('releases');
        $pages=max(1,(int)ceil(count($rows)/20));
        $page=min($pages,max(1,(int)($_GET['page'] ?? 1)));
        reply(['pages'=>$pages,'items'=>array_map(static fn($row)=>['title'=>$row['title'],'body'=>$row['text'],
            'version'=>'VetZimo','kind'=>'update','updated_at'=>str_replace(' ','T',$row['updated']).'Z'],
            array_slice($rows,($page-1)*20,20))]);
    }
    if (in_array($path,['/api/ops/contact','/api/ops/contact/verify','/api/clinic/activity'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $scope=$actor['membership_id'];
        if ($path==='/api/clinic/activity' && $method==='GET') {
            $q=$db->prepare("SELECT a.action,a.revision,UNIX_TIMESTAMP(a.created_at) AS stamp,
                (SELECT m.name FROM identity_membership m WHERE m.partner_id=a.partner_id AND m.account_id=a.account_id
                    ORDER BY m.id LIMIT 1) AS actor FROM clinic_audit a WHERE a.partner_id=? ORDER BY a.id DESC LIMIT 200");
            $q->execute([$actor['partner_id']]);
            reply(['items'=>$q->fetchAll()]);
        }
        $contact=new VetNet\Cpanel\ClinicContact($db,new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? ''),$origin);
        if ($path==='/api/ops/contact' && $method==='GET') reply($contact->read($scope));
        if ($method==='POST' && $path!=='/api/clinic/activity') {
            if (!hash_equals($scope,$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            $body=input(4096);
            if ($path==='/api/ops/contact/verify') {
                $contact->verify($scope,$body,$now);
                reply(['ok'=>true]);
            }
            if ($now-(int)$actor['reauth_at']>300) throw new RuntimeException('Önce kimliğinizi yeniden doğrulayın.',403);
            (new DealerLogin($db,$config['rateSecret']))->throttle('clinic-contact:'.$scope,$now);
            reply($contact->request($scope,$body,$now));
        }
        throw new RuntimeException('İşlem yöntemi desteklenmiyor.',405);
    }
    if (str_starts_with($path,'/api/cpanel-center/')) {
        $action=substr($path,strlen('/api/cpanel-center/'));
        $center=new Center($db,$config);$actor=$center->requireOwner($_COOKIE,$now,$method==='POST' && $action!=='reauth');
        $commerce = new VetNet\Cpanel\Commerce($db);
        $management=new VetNet\Cpanel\CenterManagement($db,$center);
        if ($method==='GET' && $action==='market-text') {
            $page=$_GET['page'] ?? '';
            if (!is_string($page) || !preg_match('~^/platform(?:/[a-z0-9-]+)*$~D',$page)) throw new RuntimeException('Sayfa geçersiz.',422);
            $file=rtrim($config['assets'],'/').'/market-pages/'.hash('sha256',$page).'.html';
            if (!is_readable($file)) throw new RuntimeException('Sayfa bulunamadı.',404);
            $fields=[];
            $template=file_get_contents($file);
            VetNet\Cpanel\MarketText::transform($template,[],$fields);
            reply(['fields'=>VetNet\Cpanel\MarketText::editorFields($template),'title'=>$fields[array_key_first(array_filter($fields,static fn($row)=>strtolower($row['tag'])==='h1'))]['text'] ?? '',
                'record'=>$management->market($page)]);
        }
        if ($method==='GET' && isset(VetNet\Cpanel\CenterManagement::FIELDS[$action])) {
            reply(['rows'=>$management->rows($action)]);
        }
        if (in_array($action,['backup','import','external-import'],true)) {
            if (!$actor['reauth_at'] || $now-(int)$actor['reauth_at']>300) throw new RuntimeException('Güvenlik bölümünde kimliğinizi yeniden doğrulayın.',403);
            $partner=$_GET['id'] ?? '';
            if (!is_string($partner) || !preg_match('/\A[a-f0-9]{32}\z/',$partner)) throw new RuntimeException('Bayi seçin.',422);
            if ($action==='backup' && $method==='GET') {
                $branch=$_GET['branch'] ?? '';
                if (!is_string($branch)) throw new RuntimeException('Şube geçersiz.',422);
                reply($management->backup($partner,$branch));
            }
            if ($action==='external-import' && $method==='POST') {
                if (!hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Yönetici oturumu değişti.',409);
                $body=input(VetNet\Cpanel\WorkspaceRepository::WRITE_REQUEST_BYTES);
                if (!is_object($body->data ?? null) || !is_string($body->branch ?? null)
                    || ($body->data->format ?? '')!=='vetnet-kolayvet-v1' || !is_object($body->data->records ?? null)) {
                    throw new RuntimeException('VetZimo Kolayvet aktarım biçimi geçersiz.',422);
                }
                $repository=new VetNet\Cpanel\WorkspaceRepository($db);
                $current=$repository->load('partner:'.$partner);
                if (!$current['state']) throw new RuntimeException('Bayi çalışma alanı bulunamadı.',404);
                [$next,$counts]=VetNet\Cpanel\ExternalImport::merge($current['state'],$body->data->records,$body->branch);
                if (($body->preview ?? false)!==true) {
                    if (($body->revision ?? null)!==$current['revision']) throw new RuntimeException('Çalışma alanı değişti. Yeniden önizleyin.',409);
                    $db->beginTransaction();
                    if ($repository->save('partner:'.$partner,$current['revision'],$next)===null) {
                        $db->rollBack();
                        throw new RuntimeException('Çalışma alanı değişti. Yeniden önizleyin.',409);
                    }
                    $center->audit($actor['account_id'],'management.external_import',$partner);
                    $db->commit();
                }
                reply(['counts'=>$counts,'revision'=>$current['revision']]);
            }
            if ($action==='import' && $method==='POST') {
                if (!hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Yönetici oturumu değişti.',409);
                reply(['added'=>$management->import($partner,input(VetNet\Cpanel\WorkspaceRepository::WRITE_REQUEST_BYTES),$actor)]);
            }
        }
        if ($method==='GET' && $action==='credit-orders') reply(['rows'=>$management->rows('credit_order')]);
        if ($method==='GET' && $action==='branch-directory') {
            $q=$db->query("SELECT user_id,request_branches FROM clinic_workspace WHERE user_id LIKE 'partner:%'");
            $locations=[];
            while ($row=$q->fetch()) {
                $branches=json_decode($row['request_branches']??'[]',false,512,JSON_THROW_ON_ERROR);
                $locations[substr($row['user_id'],8)]=array_map(static fn($branch)=>array_intersect_key(
                    (array)$branch,array_flip(['id','name','status','sharedWith'])), $branches);
            }
            reply(['locations'=>$locations]);
        }
        if ($method==='GET' && $action==='partner-finance') {
            $id=$_GET['id'] ?? null;
            if (!is_string($id)) throw new RuntimeException('Bayi seçin.',422);
            reply($center->partnerFinance($id,$_GET));
        }
        if ($method==='GET' && $action==='finance') {
            $month = $_GET['month'] ?? '';
            if (!is_string($month)) throw new RuntimeException('Geçerli bir ay seçin.',422);
            reply($center->finance($month));
        }
        if ($method==='GET' && $action==='plans') reply(['plans'=>array_values($commerce->catalog()),'termFields'=>VetNet\Cpanel\Commerce::TERMS]);
        if ($method==='GET' && $action==='subscriptions') reply(['terms'=>$db->query(
            'SELECT p.name,s.partner_id,s.plan_name,s.kind,s.starts_on,s.ends_on FROM clinic_subscription s JOIN partner_account p ON p.id=s.partner_id ORDER BY s.ends_on DESC,s.id DESC LIMIT 300'
        )->fetchAll()]);
        if ($method==='GET' && $action==='overview') reply($center->overview());
        $notifications=new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? '');
        if ($method==='GET' && $action==='notifications') reply($notifications->settings());
        if ($method==='GET' && $action==='mail-settings') reply($management->mailSettings());
        if ($method==='GET' && $action==='appearance') reply($appearance->read());
        if ($method==='GET' && $action==='crm') {
            $id=$_GET['id'] ?? null;
            if ($id===null) reply(['leads'=>$commerce->leads()]);
            if (!is_string($id) || strlen($id)!==36) throw new RuntimeException('Başvuru kimliği geçersiz.',422);
            reply($commerce->leadDetail($id));
        }
        if ($method==='GET' && $action==='subscription') {
            $partner = $_GET['id'] ?? '';
            if (!is_string($partner)) throw new RuntimeException('Bayi geçersiz.',422);
            $center->details($partner);
            reply($commerce->subscription($partner) + ['plans'=>array_values($commerce->catalog())]);
        }
        if ($method==='GET' && $action==='partners') {
            if (isset($_GET['page'])) reply($center->partnerPage($_GET['page'],$_GET['q']??'',$_GET['status']??''));
            reply(['partners'=>$center->partners($actor)]);
        }
        if($method==='GET'&&$action==='partner') {
            $id=$_GET['id'] ?? ''; if(!is_string($id))throw new RuntimeException('Bayi seçin.',422);
            reply($center->details($id));
        }
        if($method==='GET'&&$action==='audit') reply(['events'=>$db->query('SELECT action,target_id,created_at FROM center_audit ORDER BY id DESC LIMIT 100')->fetchAll()]);
        if($method==='POST') {
            if(!hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Yönetici oturumu değişti.',409);
            $body=input(in_array($action,['announcements','ads','market','plans'],true) ? 185000 : 4096);
            if (isset(VetNet\Cpanel\CenterManagement::FIELDS[$action])) {
                $management->write($action,$body,$actor);
                reply(['ok'=>true]);
            }
            if ($action==='reauth') {
                $center->reauthenticate($actor,$_COOKIE,$body,$_SERVER['REMOTE_ADDR'] ?? '',$now);
                reply(['ok'=>true]);
            }
            if ($action==='credit-orders') {
                (new VetNet\Cpanel\CreditShop($db,$management))->review($body);
                reply(['ok'=>true]);
            }
            if ($action==='notifications') reply($notifications->save($body));
            if ($action==='notification-test') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('notification-test:'.$actor['account_id'],$now);
                $notifications->send(is_string($body->channel ?? null)?$body->channel:'');
                reply(['ok'=>true]);
            }
            if ($action==='mail-settings') reply($management->saveMailSettings($body));
            if ($action==='mail-test') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('mail-test:'.$actor['account_id'],$now);
                $management->testMail();
                reply(['ok'=>true]);
            }
            if ($action==='appearance') reply($appearance->save('global',$body));
            if ($action==='crm') {
                $result=$commerce->review($body,$actor,$center,$now);
                if ($result['activation']) {
                    $result['mail']='disabled';
                    try {
                        if ($notifications->settings()['smtpEnabled']) {
                            $signature=$management->mailSettings();
                            $footer=implode("\n",array_filter([$signature['company'],$signature['email'],$signature['phone']]));
                            $notifications->send('smtp',$result['email'],'VetZimo demo başvurunuz onaylandı',
                                "Demo hesabınızı etkinleştirmek için aşağıdaki 15 dakika geçerli bağlantıyı açın.\n".$origin.$result['activation']."\n\n".$footer);
                            $result['mail']='accepted';
                        }
                    } catch (\Throwable $error) {
                        $result['mail']='failed';
                        error_log('VetZimo demo approval notification: '.get_class($error));
                    }
                }
                unset($result['email']);
                reply($result);
            }
            if ($action==='plans') {
                $commerce->savePackage($body);
                $center->audit($actor['account_id'],'package.updated',$body->id);
                reply(['ok'=>true]);
            }
            if ($action==='subscription') {
                $db->beginTransaction();
                $commerce->assign($body);
                $db->commit();
                reply(['ok'=>true]);
            }
            if ($action==='permissions') {
                $center->savePermissions($actor,$body);
                reply(['ok'=>true]);
            }
            if($action==='partners') reply($center->create($actor,$body,$now));
            if($action==='status'){ $center->toggle($actor,$body,$now);reply(['ok'=>true]); }
        }
    }
    if (in_array($method, ['GET','POST'], true) && preg_match('~^/api/support(?:/([a-f0-9]{32})(?:/attachment/([a-f0-9]{32}))?)?$~D', $path, $route)) {
        $post = $method === 'POST';
        $owner = ((new SessionRepository($db))->resolve($_COOKIE,$now)['kind'] ?? '') === 'center';
        if ($post) $db->beginTransaction();
        $actor = $owner ? (new Center($db,$config))->requireOwner($_COOKIE,$now,$post) : $workspaces->actor($_COOKIE,$now,$post);
        $scope = $owner ? $actor['account_id'] : $actor['membership_id'];
        if (($post || isset($_SERVER['HTTP_X_VETNET_SCOPE'])) && ($_SERVER['HTTP_X_VETNET_SCOPE'] ?? '') !== $scope) {
            throw new RuntimeException('Destek oturumu değişti.',409);
        }
        $branches = [];
        if (!$owner) {
            $grant=ClinicAccess::modules($actor)->support ?? 'none';
            if (isset($actor['packageModules']) && ($post ? $grant!=='write' : !in_array($grant,['read','write'],true))) {
                throw new RuntimeException('Abonelik paketi destek erişimine izin vermiyor.',403);
            }
            $branches = $workspaces->visibleBranches($actor);
        }
        if ($post && isset($route[2])) throw new RuntimeException('Bu dosya yolu yalnızca indirme içindir.',405);
        $multipart=$post && str_starts_with(strtolower($_SERVER['CONTENT_TYPE']??''),'multipart/form-data;');
        $files=$multipart ? VetNet\Cpanel\SupportAttachments::uploaded() : [];
        $supportInput=$post ? ($multipart?(object)$_POST:input(490000)) : null;
        $native=($_GET['native']??'')==='1';
        $limit=($_GET['limit']??'')==='4'?4:($native?60:200);
        $result = (new VetNet\Cpanel\Support($db))->handle($actor,$branches,$owner,$route[1]??null,$supportInput,$limit,$files,$route[2]??null,$native);
        if ($post) $db->commit();
        if ($post && $owner && isset($route[1]) && ($supportInput->action ?? '')!=='close') {
            try {
                (new VetNet\Cpanel\ClinicContact($db,new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? ''),$origin))->notifyReply($route[1]);
            } catch (\Throwable $error) { error_log('VetZimo support notification: '.get_class($error)); }
        }
        reply($result);
    }
    if ($path === '/api/identity/phone/login' && $method === 'POST') {
        $body = input(4096);
        $phone = is_string($body->phone ?? null) ? $body->phone : '';
        $password = is_string($body->password ?? null) ? $body->password : '';
        $login = new DealerLogin($db, $config['rateSecret']);
        $return=VetNet\Cpanel\WebBooking::returnPath($body->returnTo??null);
        $bookingSite=null;
        if ($return!==null) {
            try {
                $bookingSite=(new VetNet\Cpanel\WebBuilder($db,$config))->publicSite(explode('/',$return)[2]);
            } catch (PDOException $error) {
                if ($error->getCode()!=='42S02') throw $error;
            }
        }
        $result = $login->signIn($phone, $password, $_SERVER['REMOTE_ADDR'] ?? '', $now,$bookingSite['partner_id']??null);
        if ($result === null) throw new RuntimeException('Giriş bilgileri doğrulanamadı.', 401);
        $oldToken = $_COOKIE[SessionRepository::SESSION_COOKIE] ?? '';
        $oldDevice = $_COOKIE[SessionRepository::DEVICE_COOKIE] ?? '';
        if (is_string($oldToken) && is_string($oldDevice) && $oldToken !== '' && $oldDevice !== '') {
            $login->signOut($oldToken, $oldDevice);
        }
        sessionCookie(SessionRepository::SESSION_COOKIE, $result['token'], $now + $result['age']);
        sessionCookie(SessionRepository::DEVICE_COOKIE, $result['device'], $now + $result['age']);
        $destination=$result['destination'];
        if ($destination==='/hasta-sahibi' && $bookingSite && $result['partner_id']===$bookingSite['partner_id']) {
            $destination=$return;
        }
        reply(['ok'=>true,'kind'=>'phone','destination'=>$destination]);
    }
    if ($path === '/api/identity/logout' && $method === 'POST') {
        $token = $_COOKIE[SessionRepository::SESSION_COOKIE] ?? null;
        $device = $_COOKIE[SessionRepository::DEVICE_COOKIE] ?? null;
        if (is_string($token) && is_string($device)) {
            (new DealerLogin($db, $config['rateSecret']))->signOut($token, $device);
        }
        sessionCookie(SessionRepository::SESSION_COOKIE, '', $now - 3600);
        sessionCookie(SessionRepository::DEVICE_COOKIE, '', $now - 3600);
        reply(['ok'=>true]);
    }
    if ($path === '/api/identity/password/change' && $method === 'POST') {
        $body = input(4096);
        if (!is_string($body->currentPassword ?? null) || !is_string($body->password ?? null)) throw new RuntimeException('Şifre alanları geçersiz.',422);
        (new DealerLogin($db,$config['rateSecret']))->changePassword($_COOKIE,$body->currentPassword,$body->password,$_SERVER['REMOTE_ADDR'] ?? '',$now);
        sessionCookie(SessionRepository::SESSION_COOKIE,'',$now-3600);
        sessionCookie(SessionRepository::DEVICE_COOKIE,'',$now-3600);
        reply(['ok'=>true]);
    }
    if(in_array($path,['/api/identity/session','/api/identity/profile'],true)&&$method==='GET') {
        $actor=$sessions->resolve($_COOKIE,$now);
        if(($actor['kind'] ?? '')==='center') reply(['kind'=>'center','name'=>$actor['identifier'],'identifier'=>$actor['identifier'],'scopeId'=>$actor['account_id'],'members'=>[],'active'=>null,'reauthRequired'=>$now-(int)$actor['reauth_at']>300]);
    }
    $identity=new IdentityApi($db);
    if ($path==='/api/identity/notifications' && in_array($method,['GET','POST'],true)) {
        $actor=$identity->actor($_COOKIE,$now);
        if ($actor['role']!=='customer') throw new RuntimeException('Hasta sahibi hesabı gerekli.',403);
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $state=(new VetNet\Cpanel\WorkspaceRepository($db))->ownerMembershipState('partner:'.$actor['partner_id'],(string)$actor['customer_id']);
        if (!ClinicAccess::valid($actor,$state)) throw new RuntimeException('Hasta sahibi ilişkisi doğrulanamadı.',403);
        $read=$method==='POST'?(input(4096)->id??null):null;
        if ($method==='POST'&&!is_string($read)) throw new RuntimeException('Bildirim kimliği geçersiz.',422);
        reply(['items'=>(new VetNet\Cpanel\DeliveryNotice($db))->owner($actor,$state,$read)]);
    }
    if ($path==='/api/homecare' && in_array($method,['GET','POST'],true)) {
        $actor=$identity->actor($_COOKIE,$now);
        if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) {
            throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        }
        if ($actor['role']!=='customer') $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
        if ($method==='POST' && $actor['role']==='customer') {
            (new DealerLogin($db,$config['rateSecret']))->throttle('homecare:'.$actor['account_id'],$now);
        }
        $homeCare=new VetNet\Cpanel\HomeCare($db);
        $patient=$_GET['patient'] ?? '';
        $branch=$_GET['branch'] ?? '';
        try {
            if ($method==='GET' && $patient==='' && is_string($branch) && $branch!=='') reply($homeCare->queue($actor,$branch));
            if (!is_string($patient) || !preg_match('~\A[A-Za-z0-9_-]{1,80}\z~',$patient)) {
                throw new RuntimeException('Hasta bilgisi geçersiz.',422);
            }
            reply($homeCare->patient($actor,$patient,$method==='POST'?input(10000):null));
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Evde bakım tabloları henüz kurulmadı.',503);
            throw $error;
        }
    }
    if ($path === '/api/identity/phone/redeem' && $method === 'POST') {
        (new DealerLogin($db,$config['rateSecret']))->throttle('redeem:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        $identity->redeem(input(4096),$now);
        reply(['ok'=>true]);
    }
    if (preg_match('~^/api/customers/([A-Za-z0-9_-]{1,80})$~D',$path,$customerRoute) && in_array($method,['GET','POST'],true)) {
        $identity=new IdentityApi($db);
        $actor=$identity->actor($_COOKIE,$now);
        if ($method==='POST' && !hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) {
            throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        }
        if (in_array($actor['role'],['dealer','branch','staff'],true)) {
            $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
            if (isset($actor['packageModules']) && !ClinicAccess::allowed($actor,'clients',$method==='POST')) {
                throw new RuntimeException('Abonelik paketi bu işleme izin vermiyor.',403);
            }
        }
        reply($identity->customerPassword($actor,$customerRoute[1],$method==='POST'?input(4096):null,$now,$config));
    }
    if (preg_match('~^/api/lab-files/([A-Za-z0-9_-]{1,80})$~D',$path,$labRoute) && in_array($method,['GET','POST'],true)) {
        $actor=$identity->actor($_COOKIE,$now);
        if ($method==='POST' && !hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) {
            throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        }
        if (in_array($actor['role'],['dealer','branch','staff'],true)) {
            $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
            if (isset($actor['packageModules']) && !ClinicAccess::allowed($actor,'labs',$method==='POST')) {
                throw new RuntimeException('Abonelik paketi bu işleme izin vermiyor.',403);
            }
        }
        reply($identity->labPhoto($actor,$labRoute[1],$method==='POST'?input(490000):null));
    }
    if (preg_match('~^/api/exam-photos/([A-Za-z0-9_-]{1,80})$~D',$path,$examRoute)&&in_array($method,['GET','POST'],true)) {
        $actor=$identity->actor($_COOKIE,$now);
        if (!$actor || ($method==='POST'&&!hash_equals($actor['membership_id']??'',$_SERVER['HTTP_X_VETNET_SCOPE']??''))) {
            throw new RuntimeException('Çalışma alanı oturumu değişti.',403);
        }
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
        reply($identity->examPhotos($actor,$examRoute[1],$method==='POST'?input(2800000):null));
    }
    if (str_starts_with($path,'/api/identity/')) {
        $actor=$identity->actor($_COOKIE,$now);
        $action=substr($path,strlen('/api/identity/'));
        if ($method==='GET') {
            if($action==='profile') reply(['name'=>$actor['name'],'identifier'=>$actor['identifier'],'kind'=>'phone']);
            if($action==='session') reply($identity->session($actor,$now));
            if($action==='portal') {
                $portal=$identity->portal($actor);
                if ($portal['sections']['appointments']) {
                    $web=new VetNet\Cpanel\WebBuilder($db,$config);
                    try {
                        $site=$web->site($actor['partner_id']);
                        $site=$site?$web->publicSite($site['slug']):null;
                        if ($site && $web->query('SELECT COALESCE(NULLIF(phone_verified_at,0),verified_at) FROM identity_account WHERE id=?',[$actor['account_id']])->fetchColumn()) {
                            $bookingUrl='/web/'.$site['slug'].'/randevu';
                            $rules=VetNet\Cpanel\WebBuilder::decode($site['snapshot'])['booking']??[];
                            if (!empty($rules['enabled'])) $portal['bookingUrl']=$bookingUrl;
                            foreach ($portal['appointments'] as &$appointment) {
                                if (preg_match('/\Aweb-[a-f0-9]{32}\z/D',$appointment['id']) &&
                                    VetNet\Cpanel\WebBooking::changeable((object)$appointment)) {
                                    $appointment['manageUrl']=$bookingUrl.'?duzenle='.$appointment['id'];
                                }
                            }
                            unset($appointment);
                        }
                    } catch (PDOException $error) {
                        if ($error->getCode()!=='42S02') throw $error;
                    }
                }
                reply($portal);
            }
            if($action==='directory') reply($identity->directory($actor));
        }
        if($method==='POST') {
            $body=input($action==='share'?550000:18000);
            $scope=$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '';
            if($action==='select') {
                if(!is_string($body->membershipId ?? null)) throw new RuntimeException('Üyelik geçersiz.',422);
                $identity->select($_COOKIE,$actor,$body->membershipId,$now); reply(['ok'=>true]);
            }
            if($action==='reauth') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('reauth:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
                if(!is_string($body->password ?? null)) throw new RuntimeException('Şifre geçersiz.',422);
                $identity->reauth($_COOKIE,$actor,$body->password,$now); reply(['ok'=>true]);
            }
            if (in_array($action,['share','unshare'],true)) {
                $identity->share($actor,$scope,$action,$body,$now);
                reply(['ok'=>true]);
            }
            if($action==='invite') reply($identity->invite($actor,$scope,$body,$now,$config));
            if(in_array($action,['permissions','revoke','edit','delete'],true)) { $identity->manage($actor,$scope,$action,$body,$now); reply(['ok'=>true]); }
        }
    }
    if ($path === '/api/clinic/esmm' && in_array($method,['GET','POST'],true)) {
        $write = $method === 'POST';
        $actor = $workspaces->actor($_COOKIE,$now);
        if ($actor['role'] !== 'dealer' && ($write || $actor['role'] !== 'branch' ||
            !in_array(ClinicAccess::modules($actor)->esmm ?? '',['read','write'],true))) {
            throw new RuntimeException('e-SMM erişiminiz yok.',403);
        }
        $grant=ClinicAccess::modules($actor)->esmm ?? 'none';
        if (isset($actor['packageModules']) && ($write ? $grant!=='write' : !in_array($grant,['read','write'],true))) {
            throw new RuntimeException('Abonelik paketi e-SMM erişimine izin vermiyor.',403);
        }
        $scope = $_SERVER['HTTP_X_VETNET_SCOPE'] ?? ($write ? '' : $actor['membership_id']);
        if ($scope !== $actor['membership_id']) throw new RuntimeException('Klinik oturumu değişti.',409);
        $data = $write ? input(4096) : (object)$_GET;
        $branches = $workspaces->visibleBranches($actor);
        $branchId = $data->branch ?? null;
        $branch = null;
        foreach ($branches as $candidate) {
            if ($candidate->id === $branchId && ($candidate->status ?? '') !== 'Pasif') $branch = $candidate;
        }
        if (!$branch) throw new RuntimeException('Bu şubeye erişiminiz yok.',403);
        $portals = [''=>'','gib'=>'https://earsivportal.efatura.gov.tr/','isnet'=>'https://nettefatura.isnet.net.tr/account/login?ReturnUrl=%2F'];
        if ($write) {
            $provider = $data->provider ?? null;
            $label = $data->label ?? '';
            if (!is_string($provider) || !isset($portals[$provider]) || !is_string($label) ||
                !preg_match('/\A.{0,100}\z/u',$label)) throw new RuntimeException('Portal ayarlarını kontrol edin.',422);
            $db->prepare('INSERT INTO clinic_esmm_portal(partner_id,branch_id,provider,label) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),label=VALUES(label)')
                ->execute([$actor['partner_id'],$branchId,$provider,trim($label)]);
        }
        $query = $db->prepare('SELECT provider,label FROM clinic_esmm_portal WHERE partner_id=? AND branch_id=?');
        $query->execute([$actor['partner_id'],$branchId]);
        $portal = $query->fetch(PDO::FETCH_ASSOC) ?: ['provider'=>'','label'=>''];
        reply($portal + ['url'=>$portals[$portal['provider']] ?? '']);
    }
    if ($method === 'GET' && $path === '/api/ops/templates') {
        $actor = $workspaces->actor($_COOKIE, $now);
        $scope = $_SERVER['HTTP_X_VETNET_SCOPE'] ?? $actor['membership_id'];
        if ($scope !== $actor['membership_id']) throw new RuntimeException('Klinik oturumu değişti.', 409);
        $workspace = (new VetNet\Cpanel\WorkspaceRepository($db))->load('partner:'.$actor['partner_id']);
        reply((new VetNet\Cpanel\PrintTemplates($db))->listing($actor, ClinicAccess::visible($workspace['state'], $actor)));
    }
    if ($method === 'POST' && in_array($path, ['/api/ops/templates/save', '/api/ops/templates/delete'], true)) {
        $body = input(100000);
        $db->beginTransaction();
        $actor = $workspaces->actor($_COOKIE, $now, true);
        $result = (new VetNet\Cpanel\PrintTemplates($db))->change($actor, basename($path), $body, $_SERVER['HTTP_X_VETNET_SCOPE'] ?? '', $now);
        $db->commit();
        reply($result);
    }
    if ($path === '/api/staff/plan' && in_array($method,['GET','POST'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Klinik oturumu değişti.',409);
        $plan=new VetNet\Cpanel\StaffPlan($db);
        if ($method==='POST') reply($plan->change($actor,input(2048)));
        $week=$plan->week($actor,$_GET['day']??null,$_GET['after']??'');
        $branches=array_column($workspaces->visibleBranches($actor),'name','id');
        foreach (['rows','members'] as $group) foreach ($week[$group] as $i=>$item) $week[$group][$i]['branch_name']=$branches[$item['branch_id']]??'';
        reply($week);
    }
    if ($path === '/api/staff/clinic-names' && $method === 'GET') {
        $actor = $sessions->resolve($_COOKIE,$now);
        if (!in_array($actor['role'] ?? '',['dealer','branch','staff'],true)) throw new RuntimeException('Oturum doğrulanamadı.',403);
        $branch = $_GET['branch'] ?? '';
        if (!is_string($branch)) throw new RuntimeException('Şube geçersiz.',422);
        $branches = $workspaces->visibleBranches($actor);
        $found = false;
        foreach ($branches as $row) if ($row->id === $branch && ($row->status ?? '') !== 'Pasif') $found = true;
        if (!$found) throw new RuntimeException('Şube bulunamadı.',404);
        $query = $db->prepare("SELECT DISTINCT name FROM identity_membership WHERE partner_id=? AND status='active' AND (role='dealer' OR (role IN ('branch','staff') AND branch_id=?)) ORDER BY name");
        $query->execute([$actor['partner_id'],$branch]);
        reply(['names'=>$query->fetchAll(PDO::FETCH_COLUMN)]);
    }
    if ($method==='GET' && in_array($path,['/api/dealer/session','/api/dealer/account'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        $bulk=new VetNet\Cpanel\BulkClinicMessages($db,$config);
        reply($path==='/api/dealer/session' ? $bulk->session($actor) : $bulk->account($actor));
    }
    if (in_array($path,['/api/dealer/messages/history','/api/dealer/messages/bulk-preview','/api/dealer/messages/bulk'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        $bulk=new VetNet\Cpanel\BulkClinicMessages($db,$config);
        if ($method==='GET' && $path==='/api/dealer/messages/history') {
            $channel=$_GET['channel']??'';
            if (!is_string($channel)) throw new RuntimeException('Geçersiz kanal.',422);
            reply($bulk->history($actor,$channel));
        }
        if ($method==='POST' && $path!=='/api/dealer/messages/history') {
            if (($actor['membership_id']??'')!==($_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Gönderim oturumu değişti.',409);
            reply($bulk->bulk($actor,input(30000),$path==='/api/dealer/messages/bulk-preview'));
        }
        throw new RuntimeException('İşlem geçersiz.',405);
    }
    if ($path==='/api/migration' && in_array($method,['GET','POST'],true)) {
        $actor=$workspaces->actor($_COOKIE,$now);
        if ($method==='POST' && ($actor['membership_id']??'')!==($_SERVER['HTTP_X_VETNET_SCOPE']??'')) {
            throw new RuntimeException('Aktarım oturumu değişti.',409);
        }
        $branch=$_GET['branch']??'';
        if (!is_string($branch)) throw new RuntimeException('Şube geçersiz.',422);
        $export=($_GET['export']??'')==='json';
        $result=(new VetNet\Cpanel\ClinicTransfer($db))->handle($actor,$method==='POST'?input(VetNet\Cpanel\WorkspaceRepository::WRITE_REQUEST_BYTES):null,$branch,$export);
        if ($export) header('Content-Disposition: attachment; filename="vetzimo-sube-yedegi.json"');
        reply($result);
    }
    if ($path === '/api/workspace' && $method === 'GET') {
        $actor=$workspaces->actor($_COOKIE,$now);
        $session=static function(?object $visible) use($actor,$db,$appearance): array {
            $branches=$actor['role']==='dealer' ? ($visible->branches??[]) :
                (new VetNet\Cpanel\WorkspaceRepository($db))->branches('partner:'.$actor['partner_id']);
            $multipleBranches=count(array_filter($branches,static fn($row)=>($row->status??'')!=='Pasif'))>1;
            return [
            'php'=>true,'workspacePatch'=>true,'recordDeletion'=>$actor['role']==='dealer','packageRestricted'=>isset($actor['packageModules']),'personalPalette'=>$appearance->read('account:'.$actor['account_id'])['palette'],'role'=>$actor['role']==='dealer'?'dealer':'staff','central'=>true,'memberRole'=>$actor['role'],'member'=>['role'=>$actor['role']],'modules'=>ClinicAccess::modules($actor),'branches'=>[$actor['branch_id']],'scopeId'=>$actor['membership_id'],
            'partnerId'=>$actor['partner_id'],'partnerName'=>$actor['partner_name'],'multipleBranches'=>$multipleBranches,'name'=>$actor['name'],'author'=>$actor['name'],
        ];
        };
        // Büyük kliniklerde kayıtlar veritabanından doğrudan akıtılır (bellek kullanımı sabit).
        if ((new VetNet\Cpanel\WorkspaceStream($db))->send($actor,$session)) exit;
        $data=$workspaces->visibleFor($actor);
        reply($data + ['session'=>$session($data['state'])]);
    }
    if ($path === '/api/workspace/delete-record' && $method === 'POST') {
        $body = input(4096);
        reply($workspaces->deleteRecord($_COOKIE, $_SERVER['HTTP_X_VETNET_SCOPE'] ?? '', $now, $body));
    }
    if ($path === '/api/workspace' && $method === 'PUT') {
        $body = input(VetNet\Cpanel\WorkspaceRepository::WRITE_REQUEST_BYTES);
        $clinicUpdates = [];
        $revision = (new ClinicApi($workspaces))->save($_COOKIE, $_SERVER['HTTP_X_VETNET_SCOPE'] ?? '', $now, $body, $clinicUpdates);
        reply(['revision'=>$revision, 'clinicUpdates'=>$clinicUpdates]);
    }
    $unavailable=[
        '/api/migration'=>'Klinik veri aktarımı için merkez yönetimindeki Klinik Verisi İçe Aktar ekranını kullanın.',
        '/api/okc/'=>'Klinik ÖKC işlemleri için cihaz entegrasyonu etkin değil.',
        '/api/saas/demo-checkout'=>'Aboneliği etkinleştirmek için destek talebi açın.',
    ];
    foreach ($unavailable as $prefix=>$message) {
        if (str_starts_with($path,$prefix)) reply(['error'=>$message],503);
    }
    reply(['error'=>'İstenen işlem bulunamadı.'],404);
} catch (RuntimeException $error) {
    $code = $error->getCode();
    if (is_int($code) && $code >= 400 && $code <= 599 && !$error instanceof PDOException) {
        reply(['error'=>$error->getMessage()], $code);
    }
    error_log(get_class($error));
    reply(['error'=>'Sunucu isteği tamamlayamadı.'], 500);
} catch (Throwable $error) {
    error_log(get_class($error));
    reply(['error'=>'Sunucu isteği tamamlayamadı.'], 500);
}
