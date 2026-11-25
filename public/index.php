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

foreach (['AppHub','AppDownloads','DemoAuto','CenterContact','SubscriptionReminders','OwnerPayment','ClinicRecords','AppPush','DeviceHub','VisitTracker','ReviewLink','UiLocale','Totp','AppointmentReminders','Center','CenterManagement','MarketText','SaasPayment','DealerAgreement','CenterAnalytics','ClinicAlerts','Notifications','ClinicContact','Weather','ExternalImport','ClinicTransfer','BulkClinicMessages','ClinicAccess','WebBuilder','WebBuilderAdmin','WebBuilderPublic','WebBooking','WebBuilderRoutes','HomeCare','HomeVisit','HomeVisitPages','DeliveryNotice','WorkspaceRepository','Database','DealerLogin','SessionRepository','DealerWorkspace','WorkspaceStream','Finance','ClinicApi','IdentityApi','ClinicConsent','TeamTotp','WebInbox','MinistryBridge','SiteLegal','OmniInbox','PhoneGateway','ClientPermit','PrintTemplates','Support','Commerce','Appearance'] as $class) {
    require_once dirname(__DIR__) . '/src/' . $class . '.php';
}

function reply(array $body, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

/** Paket veya rol bu özelliği kapatmışsa isteği reddeder. */
function requireFeature(array $actor,string $key,bool $write=false): void {
    if (in_array($actor['role'] ?? '',['dealer','branch','staff'],true) && !VetNet\Cpanel\ClinicAccess::feature($actor,$key,$write)) {
        throw new RuntimeException('Bu özellik paketinizde veya kullanıcı yetkinizde kapalı.',403);
    }
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
    $configPath = getenv('VETNET_CPANEL_CONFIG') ?: dirname(__DIR__) . '/config.php';
    $secure = in_array($_SERVER['HTTPS'] ?? '', ['on','1'], true);
    // Adres çubuğuna yalnız "vetzimo.com" yazıldığında (iPhone/iPad Safari http ile açar) ya da www ile gelindiğinde
    // boş hata yerine kalıcı olarak güvenli ana adrese yönlendir. Gövde gönderen istekler yönlendirilmez.
    $requestHost = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET','HEAD'], true) && preg_match('/\A[a-z0-9.-]{1,253}(?::\d{1,5})?\z/', $requestHost)) {
        $mainOrigin = is_file($configPath) ? (string)((require $configPath)['origin'] ?? '') : '';
        $mainHost = strtolower((string)parse_url($mainOrigin, PHP_URL_HOST));
        $bareHost = preg_replace('/:\d+\z/', '', $requestHost);
        $target = null;
        if ($mainHost !== '' && $bareHost === 'www.'.$mainHost) $target = rtrim($mainOrigin, '/');
        elseif (!$secure) $target = ($mainHost !== '' && $bareHost === $mainHost) ? rtrim($mainOrigin, '/') : 'https://'.$bareHost;
        if ($target !== null) {
            $uri = (string)($_SERVER['REQUEST_URI'] ?? '/');
            header('Location: '.$target.(str_starts_with($uri, '/') && !str_starts_with($uri, '//') ? $uri : '/'), true, 301);
            exit;
        }
    }
    if (!$secure) {
        throw new RuntimeException('HTTPS bağlantısı gerekli.', 400);
    }
    if (!is_file($configPath)) throw new RuntimeException('PHP yapılandırması eksik.', 503);
    $config = require $configPath;
    $origin = $config['origin'];
    $method = $_SERVER['REQUEST_METHOD'];
    // REQUEST_URI is a request target. Leading // is part of its path.
    [$rawPath,$queryString] = array_pad(explode('?',$_SERVER['REQUEST_URI'],2),2,'');
    $path = '/'.ltrim($rawPath,'/');
    if ($method==='GET' && $rawPath!==$path && in_array(rtrim($path,'/'),['/clinic','/yonetim','/app','/giris','/hasta-sahibi'],true)) {
        header('Location: '.rtrim($path,'/').($queryString!=='' ? '?'.$queryString : ''),true,308);
        exit;
    }
    if (in_array($path, ['/app/','/giris/','/hasta-sahibi/','/yonetim/','/clinic/'], true)) {
        header('Location: '.rtrim($path,'/'),true,308);
        exit;
    }
    // Giriş adresi /app oldu. Eski /giris bağlantıları (e-postalardaki etkinleştirme bağlantıları dahil)
    // kalıcı olarak yönlenir; tarayıcı # sonrasını korur.
    // Klinik paneli /clinic oldu. Eski /klinik bağlantıları (bildirim ve e-posta bağlantıları dahil) kalıcı yönlenir.
    if ($path === '/klinik' || str_starts_with($path,'/klinik/')) {
        header('Location: /clinic'.substr($path,7).($queryString!=='' ? '?'.$queryString : ''),true,$method==='GET'||$method==='HEAD'?301:308);
        exit;
    }
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
    // Gelen kutusu webhook'ları (Meta, Telegram, SMS ve e-posta sağlayıcıları): imza veya gizli anahtarla doğrulanır, çerez kullanmaz.
    if (!$externalWeb && preg_match('~\A/api/inbox/hook/([a-f0-9]{40})\z~',$path,$hookMatch) && in_array($method,['GET','POST'],true)) {
        $raw=(string)file_get_contents('php://input',false,null,0,524289);
        if (strlen($raw)>524288) { http_response_code(413); exit; }
        $headers=[];
        foreach ($_SERVER as $name=>$value) if (str_starts_with($name,'HTTP_') && is_string($value)) $headers[strtolower(str_replace('_','-',substr($name,5)))]=$value;
        $hookDb=Database::connect($config['dsn'],$config['username'],$config['password']);
        [$hookCode,$hookType,$hookBody]=(new VetNet\Cpanel\OmniInbox($hookDb,(string)($config['encryptionKey'] ?? ''),$origin,$config['inboxEndpoints'] ?? []))
            ->hook($hookMatch[1],$method,$_GET,$headers,$raw,time());
        http_response_code($hookCode);
        header('Content-Type: '.$hookType.'; charset=utf-8');
        header('Cache-Control: no-store');
        echo $hookBody;
        exit;
    }
    // Bakanlık köprüsü ajanı tarayıcı değildir (Origin göndermez) ve çerezle değil kendi anahtarıyla doğrulanır.
    $bridgeAgent=!$externalWeb && (str_starts_with($path,'/api/bridge/agent/') || str_starts_with($path,'/api/phone/agent/') || $path==='/api/saas/paytr/callback' || $path==='/api/owner-pay/paytr') && !isset($_SERVER['HTTP_ORIGIN']);
    if ($method !== 'GET' && !$bridgeAgent && !hash_equals($externalWeb ? 'https://'.$host : $origin, $_SERVER['HTTP_ORIGIN'] ?? '')) {
        if (!$externalWeb && $path==='/clinic/evde-hizmet' && ($_GET['gorunum']??'')==='ayarlar') {
            VetNet\Cpanel\HomeVisitPages::settingsError('İstek kaynağı doğrulanamadı. Ayarları VetZimo üzerinden yeniden açıp kaydetmeyi deneyin.',403);
        }
        if (!$externalWeb && $path==='/web-sitem') {
            VetNet\Cpanel\WebBuilderRoutes::editorError('Formun kaynağı doğrulanamadı. Web Sitem bölümünü VetZimo panelinden yeniden açın ve tekrar deneyin.',403);
        }
        throw new RuntimeException('İstek kaynağı doğrulanamadı.', 403);
    }
    // Satış sitesi "Satın Alın": giriş yapmış bayi doğrudan ödeme ekranına (seçilen paket ve dönemle) gider;
    // giriş yapılmamışsa seçim 30 dakikalık çerezde tutulur, girişten sonra ödeme ekranı açılır.
    if (!$externalWeb && $method === 'GET' && rtrim($path,'/') === '/platform/satin-al') {
        $buyPlan=(string)($_GET['plan'] ?? '');
        $buyPeriod=($_GET['donem'] ?? '')==='monthly' ? 'monthly' : 'yearly';
        if (!preg_match('/\A[a-z0-9][a-z0-9-]{0,31}\z/',$buyPlan)) { header('Location: /platform/paketler',true,302); exit; }
        $buyDb=Database::connect($config['dsn'],$config['username'],$config['password']);
        $buyActor=(new SessionRepository($buyDb))->resolve($_COOKIE,time());
        $buyHash='#kredi-magazasi/paket-'.$buyPlan.'-'.$buyPeriod;
        if (($buyActor['role'] ?? '')==='dealer') { header('Location: /clinic'.$buyHash,true,302); exit; }
        // Hesabı olmayan: telefon doğrulama + sözleşme + şifre ile hesap açılır; girişten sonra seçilen paketin ödeme adımı açılır.
        setcookie('vz_buy',$buyPlan.'-'.$buyPeriod,['expires'=>time()+7*86400,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Lax']);
        header('Location: /platform/deneme?plan='.rawurlencode($buyPlan).'&donem='.$buyPeriod.'&satin-al=1',true,302);
        exit;
    }
    if (!$externalWeb && $method === 'GET' && ($path === '/' || $path === '/platform' || str_starts_with($path,'/platform/'))) {
        $marketPath=$path==='/' ? '/platform' : rtrim($path,'/');
        if (preg_match('~\A/platform/yasal(?:/([a-z-]+))?\z~',$marketPath,$legalMatch)) {
            $legalSlug=$legalMatch[1] ?? null;
            if ($legalSlug!==null && !VetNet\Cpanel\SiteLegal::validSlug($legalSlug)) throw new RuntimeException('Sayfa bulunamadı.',404);
            $shellFile=rtrim($config['assets'],'/').'/market-pages/'.hash('sha256','/platform/hakkimizda').'.html';
            if (!is_file($shellFile)) throw new RuntimeException('Sayfa bulunamadı.',404);
            header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-cache');
            $marketDb = Database::connect($config['dsn'],$config['username'],$config['password']);
            $theme = (new VetNet\Cpanel\Appearance($marketDb))->read();
            $html=(new VetNet\Cpanel\SiteLegal($marketDb))->page($legalSlug,marketAndPanelFavicon(file_get_contents($shellFile),$config['assets']));
            $palette = htmlspecialchars($theme['palette'],ENT_QUOTES,'UTF-8');
            $html = preg_replace('~<html lang="tr"[^>]*>~', '<html lang="tr" data-site-palette="'.$palette.'" data-theme-lock="'.($theme['locked']?'true':'false').'" data-theme="'.($palette ?: 'classic').'">', $html, 1);
            echo VetNet\Cpanel\UiLocale::page($html,$config);
            exit;
        }
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
        $html=(new VetNet\Cpanel\SiteLegal($marketDb))->applyFooter($html,time());
        $palette = htmlspecialchars($theme['palette'],ENT_QUOTES,'UTF-8');
        $html = preg_replace('~<html lang="tr"[^>]*>~', '<html lang="tr" data-site-palette="'.$palette.'" data-theme-lock="'.($theme['locked']?'true':'false').'" data-theme="'.($palette ?: 'classic').'">', $html, 1);
        echo VetNet\Cpanel\UiLocale::page($html,$config);
        exit;
    }
    if (!$externalWeb && $method === 'GET' && in_array($path, ['/clinic', '/app','/hasta-sahibi','/yonetim'], true)) {
        if ($path === '/clinic') {
            $db = Database::connect($config['dsn'], $config['username'], $config['password']);
            $actor = (new SessionRepository($db))->resolve($_COOKIE, time());
            if (!in_array($actor['role'] ?? '',['dealer','branch','staff'],true)) {
                header('Location: /app', true, 303);
                exit;
            }
            // Satış sitesinden "Satın Alın" ile gelip giriş yapan bayi: seçtiği paketin ödeme adımına geçer.
            $buyIntent=(string)($_COOKIE['vz_buy'] ?? '');
            if ($buyIntent!=='') {
                setcookie('vz_buy','',['expires'=>1,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Lax']);
                if (($actor['role'] ?? '')==='dealer' && preg_match('/\A[a-z0-9][a-z0-9-]{0,31}-(?:monthly|yearly)\z/',$buyIntent)) {
                    header('Location: /clinic#kredi-magazasi/paket-'.$buyIntent, true, 303);
                    exit;
                }
            }
        }
        $file = rtrim($config['assets'], '/') . (match ($path) {
            '/clinic' => '/index.html',
            '/yonetim' => '/identity-merkez-20261123-r65.html',
            default => '/identity.html',
        });
        if (!is_readable($file)) throw new RuntimeException('VetZimo arayüz dosyaları eksik.', 503);
        header("Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; frame-src 'self' https://www.paytr.com; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
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
    // Oluşturulan klinik siteleri (kendi alan adındakiler dahil) ve yönetim ekranları seçilen dilde açılır.
    if ($externalWeb || preg_match('~\A/(?:web|siteler)/~',$path) || !$externalWeb && preg_match('~\A/(?:web-sitem(?:/.*)?|yonetim/web-siteleri|(?:clinic/|klinik/|yonetim/|hasta-sahibi/)?evde-hizmet(?:/takip)?)\z~D',$path)) {
        ob_start(static fn(string $html): string => stripos($html,'<!doctype html')===0
            ? VetNet\Cpanel\UiLocale::page($html,$config) : $html);
    }
    $db = Database::connect($config['dsn'], $config['username'], $config['password']);
    $now = time();
    $sessions = new SessionRepository($db);
    $workspaces = new DealerWorkspace($db);
    if (!$externalWeb && in_array($path,['/.well-known/assetlinks.json','/.well-known/apple-app-site-association'],true) && $method==='GET') {
        $doc=(new VetNet\Cpanel\AppPush($db,$config))->wellKnown(basename($path));
        header('Content-Type: application/json'); header('Cache-Control: public, max-age=3600');
        echo json_encode($doc,JSON_UNESCAPED_SLASHES); exit;
    }
    if (!$externalWeb && ($path==='/download' || str_starts_with($path,'/download/') || $path==='/indir' || str_starts_with($path,'/indir/')) && in_array($method,['GET','HEAD'],true)) {
        // İndirme merkezi: her indirme sayılır; dosyalara doğrudan erişim kapalıdır. Ajanlar yalnız ücretli bayilere.
        $downloads=new VetNet\Cpanel\AppDownloads($db,dirname(__DIR__),(string)$config['rateSecret']);
        $key=substr($path,strlen(str_starts_with($path,'/indir')?'/indir':'/download'));
        $key=trim($key,'/');
        if ($key==='manifest.json') {
            header('Cache-Control: no-cache');
            reply(['files'=>$downloads->publicCatalog()]);
        }
        if ($key==='' || str_starts_with($path,'/indir')) {
            if ($key==='' && ($_GET['src'] ?? '')==='qr' && $method==='GET') {
                try { $downloads->count(VetNet\Cpanel\AppDownloads::PAGE,'qr',(string)($_SERVER['REMOTE_ADDR'] ?? ''),(string)($_SERVER['HTTP_USER_AGENT'] ?? ''),$now); }
                catch (\Throwable $error) { error_log('VetZimo download page count: '.get_class($error)); }
            }
            header('Cache-Control: no-store');
            header('Location: /platform/uygulama-indir',true,302);
            exit;
        }
        if (!preg_match('~\A[a-z0-9-]{2,24}\z~',$key)) throw new RuntimeException('İndirme bulunamadı.',404);
        $actor=null;
        if ((VetNet\Cpanel\AppDownloads::APPS[$key][2] ?? '')==='paid') {
            try { $actor=(new VetNet\Cpanel\IdentityApi($db))->actor($_COOKIE,$now); } catch (RuntimeException) { $actor=null; }
        }
        $downloads->serve($key,$_SERVER,$actor,$now);
    }
    if (!$externalWeb && $path==='/api/clinic/agents' && $method==='GET') {
        try { $agentActor=(new VetNet\Cpanel\IdentityApi($db))->actor($_COOKIE,$now); } catch (RuntimeException) { $agentActor=null; }
        if (!$agentActor) throw new RuntimeException('Oturum doğrulanamadı.',401);
        header('Cache-Control: private, no-store');
        reply((new VetNet\Cpanel\AppDownloads($db,dirname(__DIR__),(string)$config['rateSecret']))->agents($agentActor));
    }
    if (!$externalWeb && str_starts_with($path,'/api/app/')) {
        // Uygulama merkezi: Android, iOS, masaüstü ve web aynı oturumla çalışır (çerez, aynı köken).
        $hub=new VetNet\Cpanel\AppHub($db,$config);
        $sessionDevice=base64_encode(hash('sha256',(string)($_COOKIE[SessionRepository::DEVICE_COOKIE]??''),true));
        if ($path==='/api/app/release' && $method==='GET') {
            reply($hub->release((string)($_GET['platform']??''),(int)($_GET['build']??0)));
        }
        $actor=$sessions->resolve($_COOKIE,$now);
        if ($path==='/api/app/error' && $method==='POST') {
            (new DealerLogin($db,$config['rateSecret']))->throttle('app-error:'.($_SERVER['REMOTE_ADDR']??''),$now);
            $hub->error($actor,input(9000),$sessionDevice,$now);
            reply(['ok'=>true]);
        }
        if (!$actor) throw new RuntimeException('Oturum doğrulanamadı.',401);
        if (($actor['kind']??'')==='phone') $actor=(new IdentityApi($db))->actor($_COOKIE,$now);
        if ($method==='POST' && ($actor['kind']??'')==='phone' && !hash_equals((string)$actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??''))
            throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        if ($method==='POST' && ($actor['kind']??'')==='center' && !hash_equals((string)$actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??''))
            throw new RuntimeException('Merkez oturumu değişti.',409);
        if ($path==='/api/app/config' && $method==='GET') reply($hub->settings($actor));
        if ($path==='/api/app/device' && $method==='POST') {
            $body=input(6000);
            if (($body->action??'')==='revoke') { $hub->revokeDevice($actor,(string)($body->id??'')); reply($hub->settings($actor)); }
            reply($hub->register($actor,$sessionDevice,$body,$now));
        }
        if ($path==='/api/app/preferences' && $method==='POST') reply($hub->preferences($actor,$sessionDevice,input(4096)));
        if ($path==='/api/app/notifications' && $method==='GET')
            reply($hub->inbox($actor,isset($_GET['before'])?(string)$_GET['before']:null,isset($_GET['category'])?(string)$_GET['category']:null,($_GET['unread']??'')==='1'));
        if ($path==='/api/app/notifications' && $method==='POST') reply($hub->mark($actor,input(8192),$now));
        if ($path==='/api/app/deletion' && in_array($method,['GET','POST'],true)) {
            if (($actor['kind']??'')!=='phone') throw new RuntimeException('Bu hesap uygulama üzerinden silinemez.',422);
            if ($method==='POST') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('app-deletion:'.($_SERVER['REMOTE_ADDR']??''),$now);
                $body=input(2048);
                if (($body->confirm??false)!==true || !is_string($body->password??null)) throw new RuntimeException('Onay ve şifre gerekli.',422);
                (new IdentityApi($db))->reauth($_COOKIE,$actor,$body->password,$now);
                $actor=$sessions->resolve($_COOKIE,$now);
                reply($hub->deletion($actor,$now,true));
            }
            reply($hub->deletion($actor,$now,false));
        }
        throw new RuntimeException('İşlem bulunamadı.',404);
    }
    if (!$externalWeb && $path==='/api/center/app-management' && in_array($method,['GET','POST'],true)) {
        $actor=$sessions->resolve($_COOKIE,$now);
        if (!$actor || $actor['kind']!=='center' || !(int)$actor['is_owner'] || !hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Merkez yetkisi gerekli.',403);
        $hub=new VetNet\Cpanel\AppHub($db,$config);
        if ($method==='GET') reply($hub->management($now));
        if ($now-(int)$actor['reauth_at']>VetNet\Cpanel\Center::REAUTH_WINDOW) throw new RuntimeException('Merkez oturumunu yeniden doğrulayın.',403);
        reply($hub->manage(input(40000),$now));
    }
    if (!$externalWeb && $path==='/hesap-silme' && in_array($method,['GET','POST'],true)) {
        // Mağaza kuralı: hesap silme talebi uygulama dışından da yapılabilmeli.
        $actor=$sessions->resolve($_COOKIE,$now);
        $form='';
        if (($actor['kind']??'')==='phone') {
            $hub=new VetNet\Cpanel\AppHub($db,$config);
            if ($method==='POST') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('app-deletion:'.($_SERVER['REMOTE_ADDR']??''),$now);
                $password=$_POST['password']??null;
                if (!is_string($password) || ($_POST['confirm']??'')!=='yes') throw new RuntimeException('Onay gerekli.',422);
                (new IdentityApi($db))->reauth($_COOKIE,$actor,$password,$now);
                $actor=$sessions->resolve($_COOKIE,$now);
                if (!$actor) throw new RuntimeException('Oturum doğrulanamadı.',401);
                $hub->deletion($actor,$now,true);
                header('Location: /hesap-silme',true,303); exit;
            }
            $state=$hub->deletion($actor,$now,false);
            $form=$state['status']==='pending' ? '<p class="ok">Hesap silme talebiniz alındı. En geç 30 gün içinde tamamlanır ve size bildirilir.</p>'
                : ($state['status']==='done' ? '<p class="ok">Hesabınız silindi.</p>'
                : '<form method="post"><label>Şifreniz <input name="password" type="password" autocomplete="current-password" required></label><label class="c"><input type="checkbox" name="confirm" value="yes" required> Hesabımın ve giriş bilgilerimin silinmesini istiyorum.</label><button>Silme talebi gönder</button></form>');
        } elseif ($method==='POST') throw new RuntimeException('Oturum doğrulanamadı.',401);
        else $form='<p>Talep oluşturmak için <a href="/app">VetZimo hesabınızla giriş yapın</a> ve bu sayfaya dönün. Uygulamada: Ayarlar › Hesap › Hesabımı sil.</p>';
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>VetZimo · Hesap silme</title><style>body{font:1rem/1.6 system-ui;margin:0;background:linear-gradient(160deg,#f3efff,#e9f7ff);color:#1d1638;min-height:100vh}main{max-width:38rem;margin:0 auto;padding:3rem 1.2rem}h1{font-size:1.6rem;margin:0 0 .6rem}.card{background:#fff;border-radius:18px;padding:1.4rem;box-shadow:0 18px 40px rgba(60,30,140,.12)}label{display:grid;gap:.3rem;margin:.8rem 0}label.c{display:flex;gap:.5rem;align-items:flex-start}input,button{font:inherit}input[type=password]{padding:.7rem;border:1px solid #cfc6ef;border-radius:10px}button{background:#6a3df0;color:#fff;border:0;border-radius:12px;padding:.75rem 1.2rem;font-weight:700;cursor:pointer}.ok{background:#e6f7ee;color:#11633a;padding:.8rem;border-radius:10px}a{color:#5b2fd6}@media (prefers-color-scheme:dark){body{background:#120d24;color:#ece8ff}.card{background:#1d1638}input[type=password]{background:#120d24;color:#fff;border-color:#4b3d86}a{color:#b8a4ff}}</style><main><h1>Hesap silme talebi</h1><div class="card"><p>Talep, VetZimo giriş hesabınız için kaydedilir. Tamamlandığında giriş bilgileriniz, cihaz kayıtlarınız ve bildirimleriniz silinir. Kliniğinizin tuttuğu tıbbi kayıtlar yasal saklama yükümlülüğü nedeniyle klinikte kalır; bunlar için kliniğinize başvurabilirsiniz.</p>'.$form.'</div><p><a href="/platform/gizlilik">Gizlilik bilgilendirmesi</a></p></main></html>';
        exit;
    }
    if (!$externalWeb && preg_match('~\A/(api/)?evde-hizmet/canli(?:/([a-f0-9]{32}))?\z~D',$path,$liveRoute)) {
        // Evde hizmet canlı rota: personel konumu yalnız aktif ziyaret süresince; hasta sahibi kalan süreyi görür.
        $tracker=new VetNet\Cpanel\VisitTracker($db,new VetNet\Cpanel\HomeVisit($db,$config),$origin);
        $token=$liveRoute[2]??'';
        if ($token!=='') {
            $state=$tracker->publicState($token);
            if ($liveRoute[1]==='api/') { if(!$state) throw new RuntimeException('Takip bağlantısı süresi doldu.',404); header('Cache-Control: no-store'); reply($state); }
            header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store'); header('Referrer-Policy: no-referrer');
            header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'");
            http_response_code($state?200:404);
            echo VetNet\Cpanel\VisitTracker::publicPage($state); exit;
        }
        if ($liveRoute[1]!=='api/') throw new RuntimeException('Sayfa bulunamadı.',404);
        $actor=$sessions->resolve($_COOKIE,$now);
        if (!$actor) throw new RuntimeException('Oturum doğrulanamadı.',401);
        $actor=(new IdentityApi($db))->actor($_COOKIE,$now);
        if ($actor['role']!=='customer') $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
        $visit=(string)($_GET['visit']??'');
        if ($method==='GET') reply($actor['role']==='customer'?$tracker->ownerState($actor,$visit):$tracker->state($tracker->staffVisit($actor,$visit),true));
        if ($method!=='POST' || $actor['role']==='customer') throw new RuntimeException('Yöntem desteklenmiyor.',405);
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        requireFeature($actor,'homeVisit',true);
        $body=input(4096); $visit=(string)($body->visit??'');
        reply(match($body->action??''){
            'start'=>$tracker->start($actor,$visit,$body,$now),'update'=>$tracker->update($actor,$visit,$body,$now),
            'arrive'=>$tracker->arrive($actor,$visit,$now),'stop'=>$tracker->stop($actor,$visit,$now),'review'=>$tracker->askReview($actor,$visit,$now),
            default=>throw new RuntimeException('İşlem geçersiz.',422)});
    }
    if (!$externalWeb && $path==='/api/clinic/review-link' && in_array($method,['GET','POST'],true)) {
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor((new IdentityApi($db))->actor($_COOKIE,$now));
        if (!in_array($actor['role'],['dealer','branch'],true)) throw new RuntimeException('Bu ayarı yalnız yöneticiler değiştirebilir.',403);
        $links=new VetNet\Cpanel\ReviewLink($db);
        if ($method==='GET') reply($links->get($actor['partner_id']));
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE']??'')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        reply($links->save($actor['partner_id'],input(4096)));
    }
    if ($path==='/api/evde-hizmet/konum'||(!$externalWeb && in_array($path,['/clinic/evde-hizmet','/hasta-sahibi/evde-hizmet','/yonetim/evde-hizmet',
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
    if ($path === '/api/saas/appearance' && $method === 'GET') reply($appearance->read()+['chartBlur'=>$appearance->chartBlur()]);
    if ($path === '/api/identity/appearance' && $method === 'POST') {
        $actor = $workspaces->actor($_COOKIE,$now);
        if (($_SERVER['HTTP_X_VETNET_SCOPE'] ?? '') !== $actor['membership_id']) throw new RuntimeException('Klinik oturumu değişti.',409);
        if ($appearance->read()['locked']) throw new RuntimeException('Tema merkez yönetiminden kilitli.',403);
        reply($appearance->save('account:'.$actor['account_id'],input(4096)));
    }


    if ($path === '/api/saas/applications' && $method === 'POST') {
        (new DealerLogin($db,$config['rateSecret']))->throttle('sales:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        $application=(new VetNet\Cpanel\Commerce($db))->submit(input(16000),$config['rateSecret'],new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? ''));
        // Yöneticiye ücretsiz SMS/WhatsApp: merkez telefon hattından (Merkez Bildirimleri); aynı başvuru ikinci kez gönderilmez.
        try {
            $contact=new VetNet\Cpanel\CenterContact($db,(string)($config['encryptionKey'] ?? ''));
            $cs=$contact->settings();
            $lead=$db->prepare('SELECT kind,name,clinic,phone FROM clinic_lead WHERE id=?');$lead->execute([$application['reference']]);
            if (($l=$lead->fetch(PDO::FETCH_ASSOC)) && $cs['phone']!=='') {
                $channels=array_values(array_filter(['sms','whatsapp'],static fn($c)=>$cs[$c]));
                if ($channels) $contact->send($cs['phone'],'VetZimo · Yeni '.($l['kind']==='contact'?'iletişim mesajı':'demo başvurusu')."\n".$l['clinic'].' · '.$l['name'].($l['phone']!==''?' · '.$l['phone']:''),'lead:'.$application['reference'],$now,$channels);
            }
        } catch (\Throwable $error) { error_log('VetZimo lead alert: '.get_class($error)); }
        // Otomatik demo: telefona kod gider; kod + telefondan imzalanan sözleşme ile demo kendiliğinden açılır.
        try { $application+=(new VetNet\Cpanel\DemoAuto($db,(string)$config['rateSecret']))->start($application['reference'],new VetNet\Cpanel\PhoneGateway($db),$now); }
        catch (\Throwable $error) { error_log('VetZimo demo auto start: '.get_class($error).' '.$error->getMessage()); $application['verify']=false; }
        reply($application);
    }
    if ($path === '/api/saas/demo-agreement' && $method === 'GET') {
        header('Cache-Control: no-cache');
        reply((new VetNet\Cpanel\DealerAgreement($db))->current());
    }
    if (in_array($path,['/api/saas/demo-verify','/api/saas/demo-resend'],true) && $method === 'POST') {
        $auto=new VetNet\Cpanel\DemoAuto($db,(string)$config['rateSecret']);
        $body=input(420000);
        (new DealerLogin($db,$config['rateSecret']))->throttle('demo-verify:'.($_SERVER['REMOTE_ADDR'] ?? '').':'.(is_string($body->reference ?? null)?substr($body->reference,0,36):''),$now);
        if ($path==='/api/saas/demo-resend') {
            $reference=is_string($body->reference ?? null) ? $body->reference : '';
            if (!preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/',$reference)) throw new RuntimeException('Başvuru bulunamadı.',404);
            reply($auto->start($reference,new VetNet\Cpanel\PhoneGateway($db),$now,true));
        }
        $result=$auto->verify($body,new Center($db,$config),new VetNet\Cpanel\Commerce($db),(string)($_SERVER['REMOTE_ADDR'] ?? ''),(string)($_SERVER['HTTP_USER_AGENT'] ?? ''),$now);
        try {
            $notifications=new VetNet\Cpanel\Notifications($db,$config['encryptionKey'] ?? '');
            if ($notifications->settings()['smtpEnabled']) {
                $notifications->send('smtp',null,'Otomatik demo açıldı','Telefonu doğrulanan ve sözleşmeyi imzalayan '.$result['clinic'].' için '.$result['days'].' günlük demo açıldı.');
                $notifications->send('smtp',$result['email'],'VetZimo demonuz açıldı','VetZimo '.$result['days'].' günlük demonuz açıldı. Şifrenizi belirlemek için: '.$origin.$result['activation']);
            }
        } catch (\Throwable $error) { error_log('VetZimo demo auto mail: '.get_class($error)); }
        unset($result['email']);
        reply($result);
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
    if ($path==='/api/owner-pay/paytr' && $method==='POST') {
        // Hasta sahibi kart ödemesi: bayinin kendi PayTR mağazasının bildirimi (imza o bayinin anahtarıyla doğrulanır).
        $result=(new VetNet\Cpanel\OwnerPayment($db,(string)($config['encryptionKey'] ?? ''),$config))->callback($_POST,$now);
        header('Content-Type: text/plain; charset=utf-8');
        echo $result;
        exit;
    }
    if ($path==='/api/owner-pay' && in_array($method,['GET','POST'],true)) {
        $ownerActor=(new IdentityApi($db))->actor($_COOKIE,$now);
        $pay=new VetNet\Cpanel\OwnerPayment($db,(string)($config['encryptionKey'] ?? ''),$config);
        if ($method==='GET') reply($pay->owner($ownerActor));
        if (!hash_equals((string)($ownerActor['membership_id'] ?? ''),$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Oturum değişti. Sayfayı yenileyin.',409);
        (new DealerLogin($db,$config['rateSecret']))->throttle('owner-pay:'.$ownerActor['membership_id'],$now);
        $body=input(4096);
        if (($body->op ?? '')==='notify') reply($pay->notifyBank($ownerActor,$body));
        reply($pay->start($ownerActor,$body,(string)($_SERVER['REMOTE_ADDR'] ?? ''),$origin,$now));
    }
    if ($path==='/api/clinic/owner-payments' && in_array($method,['GET','POST'],true)) {
        $clinicActor=$workspaces->actor($_COOKIE,$now,$method==='POST');
        $pay=new VetNet\Cpanel\OwnerPayment($db,(string)($config['encryptionKey'] ?? ''),$config);
        if ($method==='GET') reply($pay->dealer($clinicActor)+['callback'=>$origin.'/api/owner-pay/paytr']);
        if (!hash_equals((string)($clinicActor['membership_id'] ?? ''),$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $body=input(4096);
        if (($body->op ?? '')==='settings') reply($pay->saveSettings($clinicActor,$body)+['callback'=>$origin.'/api/owner-pay/paytr']);
        reply($pay->decide($clinicActor,$body,$now)+['callback'=>$origin.'/api/owner-pay/paytr']);
    }
    if ($path==='/api/saas/paytr/callback' && $method==='POST') {
        // PayTR sunucu bildirimi: imza doğrulanır, ödeme başarılıysa abonelik açılır. PayTR "OK" yanıtı bekler.
        $result=(new VetNet\Cpanel\SaasPayment($db,(string)($config['encryptionKey'] ?? ''),$config))->callback($_POST,$now);
        header('Content-Type: text/plain; charset=utf-8');
        echo $result;
        exit;
    }
    if (in_array($path,['/api/saas/store','/api/saas/store/order','/api/saas/store/reference'],true)) {
        // Abonelik mağazası: demo/denemeden pakete geçiş ve yenileme (kart: PayTR, havale: yönetici onayı).
        $actor=$workspaces->actor($_COOKIE,$now);
        if ($actor['role']!=='dealer') throw new RuntimeException('Bayi yöneticisi yetkisi gerekli.',403);
        $payment=new VetNet\Cpanel\SaasPayment($db,(string)($config['encryptionKey'] ?? ''),$config);
        $methods=$payment->methods();
        if ($method==='GET' && $path==='/api/saas/store') reply([
            'scopeId'=>$actor['membership_id'],'card'=>$methods['card'],'bank'=>$methods['bank'],'orders'=>$payment->orders($actor['partner_id']),
            'subscription'=>(new VetNet\Cpanel\Commerce($db))->subscription($actor['partner_id']),
            'plans'=>array_map(static fn($plan)=>$plan+['amounts'=>['monthly'=>VetNet\Cpanel\SaasPayment::amount($plan,'monthly'),'yearly'=>VetNet\Cpanel\SaasPayment::amount($plan,'yearly')],
                'purchasable'=>($methods['card']||$methods['bank']) && (VetNet\Cpanel\SaasPayment::amount($plan,'monthly')!==null || VetNet\Cpanel\SaasPayment::amount($plan,'yearly')!==null)],
                array_values((new VetNet\Cpanel\Commerce($db))->publishedCatalog())),
        ]);
        if ($method==='POST') {
            if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            (new DealerLogin($db,$config['rateSecret']))->throttle('saas-order:'.$actor['account_id'],$now);
            $body=input(4096);
            if ($path==='/api/saas/store/order') reply($payment->order($actor,$body,(string)($_SERVER['REMOTE_ADDR'] ?? ''),$origin,$now));
            if ($path==='/api/saas/store/reference') { $payment->reference($actor,$body); reply(['ok'=>true]); }
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
        $center=new Center($db,$config);
        // Departmanlar yalnız kendi işlemlerini yapar (sunucuda zorunlu); diğer her şey merkez sahibine aittir.
        $departmentActions=[
            'dealer'=>['GET'=>['saas-orders','paytr','subscriptions','plans','partners','partner','appearance'],'POST'=>['saas-orders','subscription','reauth']],
            'support'=>['GET'=>['appearance'],'POST'=>['reauth']],
        ];
        $allowedDepartments=array_keys(array_filter($departmentActions,static fn(array $m): bool=>in_array($action,$m[$method] ?? [],true)));
        $actor=$center->requireCenter($_COOKIE,$now,$method==='POST' && $action!=='reauth',$allowedDepartments);
        $commerce = new VetNet\Cpanel\Commerce($db);
        $management=new VetNet\Cpanel\CenterManagement($db,$center);
        if ($action==='legal' || $action==='legal-save' || $action==='legal-company' || $action==='legal-revision') {
            $legal=new VetNet\Cpanel\SiteLegal($db);
            if ($method==='GET' && $action==='legal') reply($legal->admin());
            if ($method==='GET' && $action==='legal-revision') {
                $slug=$_GET['slug'] ?? '';
                if (!VetNet\Cpanel\SiteLegal::validSlug($slug)) throw new RuntimeException('Yasal metin seçin.',422);
                reply(['revisions'=>$legal->revisions($slug,true)]);
            }
            if ($method==='POST') {
                if (!hash_equals($actor['account_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Yönetici oturumu değişti.',409);
                $body=input(300000);
                if ($action==='legal-save') reply(['doc'=>$legal->save($body,(string)($actor['identifier'] ?? $actor['name'] ?? 'Merkez yöneticisi'),$now)]);
                if ($action==='legal-company') reply(['company'=>$legal->saveCompany($body->company ?? null,$now)]);
            }
            throw new RuntimeException('İşlem yöntemi desteklenmiyor.',405);
        }
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
        if ($method==='GET' && $action==='analytics') reply((new VetNet\Cpanel\CenterAnalytics($db))->get(($_GET['refresh'] ?? '')==='1',$now));
        if ($method==='GET' && in_array($action,['saas-orders','paytr'],true)) {
            $saas=new VetNet\Cpanel\SaasPayment($db,(string)($config['encryptionKey'] ?? ''),$config);
            reply($action==='paytr'?$saas->settings()+['callback'=>$origin.'/api/saas/paytr/callback']:['rows'=>$saas->adminOrders()]);
        }
        if ($method==='GET' && $action==='plans') reply(['plans'=>array_values($commerce->catalog()),'termFields'=>VetNet\Cpanel\Commerce::TERMS,'featureFields'=>ClinicAccess::FEATURES]);
        if ($method==='GET' && $action==='subscriptions') reply(['terms'=>$db->query(
            'SELECT p.name,s.partner_id,s.plan_name,s.kind,s.starts_on,s.ends_on FROM clinic_subscription s JOIN partner_account p ON p.id=s.partner_id ORDER BY s.ends_on DESC,s.id DESC LIMIT 300'
        )->fetchAll()]);
        if ($method==='GET' && $action==='overview') reply($center->overview());
        if ($method==='GET' && $action==='downloads') {
            $days=filter_var($_GET['days'] ?? 30,FILTER_VALIDATE_INT,['options'=>['min_range'=>7,'max_range'=>365]]) ?: 30;
            reply((new VetNet\Cpanel\AppDownloads($db,dirname(__DIR__),(string)$config['rateSecret']))->stats($days,$now)+['origin'=>$origin]);
        }
        if ($method==='GET' && $action==='chart-blur') reply((new VetNet\Cpanel\Appearance($db))->chartBlur());
        if ($method==='GET' && $action==='center-contact') reply((new VetNet\Cpanel\CenterContact($db,(string)($config['encryptionKey'] ?? '')))->overview());
        if ($method==='GET' && $action==='team') reply(['team'=>$center->team(),'departments'=>Center::DEPARTMENTS]);
        if ($method==='GET' && $action==='market-status') reply(['pages'=>$management->marketStatus()]);
        if ($method==='GET' && $action==='demo-auto') reply((new VetNet\Cpanel\DemoAuto($db,(string)$config['rateSecret']))->overview()+['plans'=>array_values(array_map(static fn($p)=>['id'=>$p['id'],'name'=>$p['name']],$commerce->catalog()))]);
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
            reply($center->details($id)+['agreements'=>(new VetNet\Cpanel\DealerAgreement($db))->records($id)]);
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
            if ($action==='chart-blur') {
                $result=(new VetNet\Cpanel\Appearance($db))->saveChartBlur($body);
                $center->audit($actor['account_id'],'chart.blur.updated');
                reply($result);
            }
            if ($action==='center-contact') {
                $result=(new VetNet\Cpanel\CenterContact($db,(string)($config['encryptionKey'] ?? '')))->save($body);
                $center->audit($actor['account_id'],'center.contact.updated');
                reply($result);
            }
            if ($action==='center-contact-test') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('center-contact-test:'.$actor['account_id'],$now);
                (new VetNet\Cpanel\CenterContact($db,(string)($config['encryptionKey'] ?? '')))->alert('Deneme bildirimi','Merkez bildirim ayarları çalışıyor.','/yonetim','test:'.$now,$now,[]);
                reply(['ok'=>true]);
            }
            if ($action==='team') reply($center->teamAction($actor,$body,$now)+['departments'=>Center::DEPARTMENTS]);
            if ($action==='demo-auto') {
                $result=(new VetNet\Cpanel\DemoAuto($db,(string)$config['rateSecret']))->saveSettings($body,$commerce);
                $center->audit($actor['account_id'],'demo.auto.updated');
                reply($result+['plans'=>array_values(array_map(static fn($p)=>['id'=>$p['id'],'name'=>$p['name']],$commerce->catalog()))]);
            }
            if ($action==='crm') {
                $result=$commerce->review($body,$actor,$center,$now);
                if ($result['activation']) {
                    $result['mail']='disabled';
                    try {
                        if ($notifications->settings()['smtpEnabled']) {
                            $signature=$management->mailSettings();
                            $footer=implode("\n",array_filter([$signature['company'],$signature['email'],$signature['phone']]));
                            $notifications->send('smtp',$result['email'],'VetZimo demo başvurunuz onaylandı',
                                Center::welcomeText((string)($result['name'] ?? 'Değerli bayimiz'),(string)($result['phone'] ?? ''),$origin.$result['activation'])."\n\n".$footer);
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
            if (in_array($action,['saas-orders','paytr'],true)) {
                $saas=new VetNet\Cpanel\SaasPayment($db,(string)($config['encryptionKey'] ?? ''),$config);
                if ($action==='paytr') reply($saas->saveSettings($body));
                $saas->review($body,$now);
                reply(['ok'=>true]);
            }
            if ($action==='plans' && ($body->delete ?? false)===true) {
                $name=$commerce->deletePackage($body);
                $center->audit($actor['account_id'],'package.deleted',(string)$body->id);
                reply(['ok'=>true,'deleted'=>$name]);
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
            if($action==='partners') {
                $created=$center->create($actor,$body,$now);
                $created['welcome']=Center::welcomeText($created['name'],$created['phone'],$origin.$created['link']);
                $created['mail']='disabled';
                try {
                    if ($notifications->settings()['smtpEnabled']) {
                        $signature=$management->mailSettings();
                        $notifications->send('smtp',$created['email'],"VetZimo'ya hoş geldiniz · hesabınızı etkinleştirin",$created['welcome']."\n\n".implode("\n",array_filter([$signature['company'],$signature['email'],$signature['phone']])));
                        $created['mail']='accepted';
                    }
                } catch (\Throwable $error) { $created['mail']='failed'; error_log('VetZimo dealer welcome mail: '.get_class($error)); }
                reply($created);
            }
            if($action==='status'){ $center->toggle($actor,$body,$now);reply(['ok'=>true]); }
        }
    }
    if (in_array($method, ['GET','POST'], true) && preg_match('~^/api/support(?:/([a-f0-9]{32})(?:/attachment/([a-f0-9]{32}))?)?$~D', $path, $route)) {
        $post = $method === 'POST';
        $owner = ((new SessionRepository($db))->resolve($_COOKIE,$now)['kind'] ?? '') === 'center';
        if ($post) $db->beginTransaction();
        $actor = $owner ? (new Center($db,$config))->requireCenter($_COOKIE,$now,$post,['support']) : $workspaces->actor($_COOKIE,$now,$post);
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
        $otp = is_string($body->otp ?? null) ? substr($body->otp,0,20) : '';
        $result = $login->signIn($phone, $password, $_SERVER['REMOTE_ADDR'] ?? '', $now,$bookingSite['partner_id']??null,
            new VetNet\Cpanel\TeamTotp($db,(string)($config['encryptionKey'] ?? '')),$otp);
        if ($result === null) throw new RuntimeException('Giriş bilgileri doğrulanamadı.', 401);
        if (!empty($result['otpRequired'])) reply(['error'=>$result['otpInvalid']?'Doğrulama kodu geçersiz veya süresi doldu.':'Doğrulama uygulamanızdaki 6 haneli kodu girin.','otpRequired'=>true],401);
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
        if(($actor['kind'] ?? '')==='center') reply(['kind'=>'center','name'=>$actor['identifier'],'identifier'=>$actor['identifier'],'scopeId'=>$actor['account_id'],'members'=>[],'active'=>null,'reauthRequired'=>$now-(int)$actor['reauth_at']>VetNet\Cpanel\Center::REAUTH_WINDOW,'department'=>(int)$actor['is_owner']?'owner':(string)($actor['department'] ?? '')]);
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
        requireFeature($actor,'homeCare',$method==='POST');
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
    if (preg_match('~\A/api/clinic/devices(?:/(inbox|patient|file|upload))?(?:/([A-Za-z0-9_-]{1,80}))?\z~D',$path,$deviceRoute)) {
        // Cihaz entegrasyonu: cihaz listesi, gelen sonuçlar, eşleştirme, tetkik olarak ekleme, dosya.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        if (!in_array($actor['role'],['dealer','branch','staff'],true) || !VetNet\Cpanel\ClinicAccess::allowed($actor,'labs')) throw new RuntimeException('Tetkik yetkiniz yok.',403);
        requireFeature($actor,'devices',$method==='POST');
        $hub=new VetNet\Cpanel\DeviceHub($db);
        $sub=$deviceRoute[1]??'';
        if ($method==='GET') {
            if ($sub==='inbox') reply($hub->inbox($actor,(string)($_GET['state']??'pending')));
            if ($sub==='patient') reply($hub->forPatient($actor,(string)($deviceRoute[2]??'')));
            if ($sub==='file') {
                $file=$hub->file($actor,(string)($deviceRoute[2]??''));
                header('Content-Type: '.$file['type']); header('Content-Length: '.$file['size']);
                header('Content-Disposition: inline; filename*=UTF-8\'\''.rawurlencode($file['name']));
                header('Cache-Control: private, max-age=3600'); header('X-Content-Type-Options: nosniff');
                header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
                $hub->streamFile($file['id']); exit;
            }
            reply(['devices'=>$hub->devices($actor['partner_id']),'agent'=>$hub->agentState($actor['partner_id'],$now)]+$hub->inbox($actor,'pending',1));
        }
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        if ($sub==='upload') {
            // Elle yüklenen DICOM, PDF veya görüntü 4 MB'lık parçalarla gelir (ajanla aynı depolama).
            if ((int)($_SERVER['CONTENT_LENGTH']??0)>VetNet\Cpanel\DeviceHub::CHUNK) throw new RuntimeException('Parça çok büyük.',413);
            $bytes=(string)file_get_contents('php://input',false,null,0,VetNet\Cpanel\DeviceHub::CHUNK+1);
            reply($hub->agentChunk(['partner_id'=>$actor['partner_id']],(string)($_SERVER['HTTP_X_UPLOAD_ID']??''),(int)($_SERVER['HTTP_X_CHUNK_INDEX']??-1),
                (int)($_SERVER['HTTP_X_CHUNK_TOTAL']??0),rawurldecode((string)($_SERVER['HTTP_X_FILE_NAME']??'sonuc')),(string)($_SERVER['HTTP_X_FILE_TYPE']??''),$bytes,$now));
        }
        $body=input(900000);
        $action=$body->action??'';
        if (in_array($action,['save','remove'],true) && !in_array($actor['role'],['dealer','branch'],true)) throw new RuntimeException('Cihaz ayarlarını yalnız yöneticiler değiştirebilir.',403);
        reply(match($action){
            'save'=>['devices'=>$hub->save($actor,$body,$now)],
            'remove'=>['devices'=>$hub->remove($actor,(string)($body->id??''))],
            'resolve'=>$hub->resolve($actor,$body,$now),
            'claim'=>$hub->claimMatched($actor),
            'imported'=>$hub->imported($actor,$body,$now),
            'manual'=>$hub->manualUpload($actor,$body,$now),
            default=>throw new RuntimeException('İşlem geçersiz.',422),
        });
    }
    if ($path==='/api/clinic/alerts' && in_array($method,['GET','POST'],true)) {
        // Sağ üst bildirimler ve zil paneli: mesajlar, onaylar, sorunlu işler; tamamlananlar kişi bazında gizlenir.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        if (!in_array($actor['role'],['dealer','branch','staff'],true)) throw new RuntimeException('Klinik hesabı gerekli.',403);
        $alerts=new VetNet\Cpanel\ClinicAlerts($db);
        if ($method==='GET') reply($alerts->list($actor,$now));
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        $alerts->ack($actor,input(20000)->keys ?? [],$now);
        reply($alerts->list($actor,$now));
    }
    if ($path==='/api/agreement' && in_array($method,['GET','POST'],true)) {
        // VetZimo Kullanım Sözleşmesi: mevcut bayiler ilk girişte imzalar; imza kayıtları bayi yöneticisine gösterilir.
        $actor=$identity->actor($_COOKIE,$now);
        if (!in_array($actor['role'],['dealer','branch','staff'],true)) throw new RuntimeException('Klinik hesabı gerekli.',403);
        $agreement=new VetNet\Cpanel\DealerAgreement($db);
        if ($method==='GET') reply(['agreement'=>$agreement->current(),'signed'=>$agreement->signed($actor['partner_id']),
            'records'=>$actor['role']==='dealer'?$agreement->records($actor['partner_id']):[]]);
        if ($actor['role']!=='dealer') throw new RuntimeException('Sözleşmeyi yalnızca bayi yöneticisi imzalayabilir.',403);
        if (!hash_equals($actor['membership_id'],$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        if ($agreement->signed($actor['partner_id'])) reply(['ok'=>true]);
        reply($agreement->sign($actor['partner_id'],$actor['account_id'],input(420000),(string)($_SERVER['REMOTE_ADDR'] ?? ''),(string)($_SERVER['HTTP_USER_AGENT'] ?? ''),$now));
    }
    if ($path === '/api/identity/phone/activation' && $method === 'GET') {
        (new DealerLogin($db,$config['rateSecret']))->throttle('activation-info:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        reply($identity->activationInfo(is_string($_GET['token'] ?? null)?$_GET['token']:'',$now));
    }
    if ($path === '/api/identity/phone/redeem' && $method === 'POST') {
        (new DealerLogin($db,$config['rateSecret']))->throttle('redeem:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        $identity->redeem(input(420000),$now);
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
    if ($path==='/api/bridge/agent/device-file' && $method==='POST') {
        // Cihaz dosyası (DICOM, PDF, görüntü) ajanından 4 MB'lık parçalar halinde gelir.
        $auth=(string)($_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'');
        if ($auth==='' && is_string($_SERVER['HTTP_X_BRIDGE_TOKEN']??null)) $auth='Bearer '.$_SERVER['HTTP_X_BRIDGE_TOKEN'];
        $agent=(new VetNet\Cpanel\MinistryBridge($db))->agentAuth($auth);
        if ((int)($_SERVER['CONTENT_LENGTH']??0)>VetNet\Cpanel\DeviceHub::CHUNK) throw new RuntimeException('Parça çok büyük.',413);
        $bytes=(string)file_get_contents('php://input',false,null,0,VetNet\Cpanel\DeviceHub::CHUNK+1);
        reply((new VetNet\Cpanel\DeviceHub($db))->agentChunk($agent,(string)($_SERVER['HTTP_X_UPLOAD_ID']??''),(int)($_SERVER['HTTP_X_CHUNK_INDEX']??-1),
            (int)($_SERVER['HTTP_X_CHUNK_TOTAL']??0),rawurldecode((string)($_SERVER['HTTP_X_FILE_NAME']??'sonuc')),(string)($_SERVER['HTTP_X_FILE_TYPE']??''),$bytes,$now));
    }
    if (str_starts_with($path,'/api/bridge/agent/') && $method==='POST') {
        // Bakanlık köprüsü ajanı: çerez değil, eşleştirmede verilen anahtarla (Bearer) konuşur.
        $bridge=new VetNet\Cpanel\MinistryBridge($db);
        $op=substr($path,strlen('/api/bridge/agent/'));
        $body=input(420000);
        try {
            if ($op==='pair') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('bridge-pair:'.($_SERVER['REMOTE_ADDR']??''),$now);
                reply($bridge->agentPair((string)($body->code??''),(string)($body->name??''),(string)($body->version??''),$now));
            }
            // Bazı paylaşımlı sunucular Authorization başlığını PHP'ye iletmez; ajan aynı anahtarı X-Bridge-Token ile de yollar.
            $auth=(string)($_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'');
            if ($auth==='' && is_string($_SERVER['HTTP_X_BRIDGE_TOKEN']??null)) $auth='Bearer '.$_SERVER['HTTP_X_BRIDGE_TOKEN'];
            $agent=$bridge->agentAuth($auth);
            reply(match($op){
                'heartbeat'=>$bridge->heartbeat($agent,$body,$now),
                'claim'=>$bridge->claim($agent,$now,is_array($body->portals??null)?array_values(array_filter($body->portals,static fn($p)=>in_array($p,['ministry','gib','efatura','esmm'],true))):null),
                'progress'=>$bridge->progress($agent,$body,$now),
                'result'=>$bridge->result($agent,$body,$now),
                'recipe'=>$bridge->saveRecipe($agent,$body,$now),
                'recipes'=>$bridge->recipes($agent),
                // Aynı ajan, klinik izin verdiyse WhatsApp Web üzerinden kliniğin kendi numarasıyla mesaj gönderir.
                'devices'=>(new VetNet\Cpanel\DeviceHub($db))->agentDevices($agent,$now),
                'device-result'=>(new VetNet\Cpanel\DeviceHub($db))->agentResult($agent,$body,$now),
                'device-error'=>(new VetNet\Cpanel\DeviceHub($db))->agentError($agent,$body),
                'wa-sync'=>(new VetNet\Cpanel\PhoneGateway($db))->waSync($agent,$body,$now,new VetNet\Cpanel\OmniInbox($db,(string)($config['encryptionKey'] ?? ''),$origin)),
                default=>throw new RuntimeException('İşlem bulunamadı.',404),
            });
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Köprü tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if (str_starts_with($path,'/api/phone/agent/') && $method==='POST') {
        // Android telefon ajanı (Termux): kliniğin kendi SIM kartından SMS gönderir, gelen SMS'leri iletir.
        $gateway=new VetNet\Cpanel\PhoneGateway($db);
        $op=substr($path,strlen('/api/phone/agent/'));
        $body=input(400000);
        try {
            if ($op==='pair') {
                (new DealerLogin($db,$config['rateSecret']))->throttle('phone-pair:'.($_SERVER['REMOTE_ADDR']??''),$now);
                reply($gateway->agentPair($body->code??null,$body->name??null,$body->version??null,$body->info??null,$now));
            }
            $auth=(string)($_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'');
            if ($auth==='' && is_string($_SERVER['HTTP_X_PHONE_TOKEN']??null)) $auth='Bearer '.$_SERVER['HTTP_X_PHONE_TOKEN'];
            $device=$gateway->agentAuth($auth);
            $agentFile=dirname(__DIR__).'/phone-agent/vetzimo-telefon.py';
            if ($op==='sync') {
                // Telefon uygulaması kendini günceller: sunucudaki sürüm daha yeniyse "script" ile yeni dosyayı alır.
                preg_match('/^VERSION = "([0-9.]+)"/m',(string)@file_get_contents($agentFile),$agentVersion);
                reply($gateway->sync($device,$body,$now,new VetNet\Cpanel\OmniInbox($db,(string)($config['encryptionKey'] ?? ''),$origin))+['agentVersion'=>$agentVersion[1] ?? '']);
            }
            if ($op==='script') reply(['script'=>str_replace('__VETZIMO_SERVER__',$origin,(string)file_get_contents($agentFile))]);
            throw new RuntimeException('İşlem bulunamadı.',404);
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Telefon bağlantısı tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if (preg_match('~\A/(?:onay/([A-Za-z0-9_-]{32})|o/([A-Za-z0-9]{10}))\z~',$path,$permitMatch) && in_array($method,['GET','POST'],true)) {
        $permitMatch[1]=($permitMatch[1] ?? '')!=='' ? $permitMatch[1] : $permitMatch[2];
        // Hayvan sahibinin tek kullanımlık onay bağlantısı (giriş gerekmez; bağlantı imzadan sonra geçersizleşir).
        $permits=new VetNet\Cpanel\ClientPermit($db,$origin);
        header('Cache-Control: no-store');
        header('Referrer-Policy: no-referrer');
        if ($method==='POST') {
            (new DealerLogin($db,$config['rateSecret']))->throttle('permit:'.($_SERVER['REMOTE_ADDR']??''),$now);
            reply($permits->decide($permitMatch[1],input(500000),$now,$_SERVER));
        }
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        header('Content-Type: text/html; charset=utf-8');
        try {
            $open=$permits->open($permitMatch[1],$now);
            echo VetNet\Cpanel\UiLocale::page(VetNet\Cpanel\ClientPermit::html($open['doc'],$open['hash'],'sign'),$config);
        } catch (RuntimeException $error) {
            // Kısa bağlantılar tahminle denenmesin: geçersiz denemeler IP başına sınırlanır.
            (new DealerLogin($db,$config['rateSecret']))->throttle('permit-miss:'.($_SERVER['REMOTE_ADDR']??''),$now);
            http_response_code($error->getCode()===410?410:404);
            echo '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onay formu</title><link rel="stylesheet" href="/permit-sign.css?v=2"><main class="pm"><section class="pm-card"><h1>Bağlantı geçersiz</h1><p>'.htmlspecialchars($error->getMessage(),ENT_QUOTES,'UTF-8').'</p></section></main></html>';
        }
        exit;
    }
    if (preg_match('~\A/api/permit/belge/([a-f0-9]{32})\z~',$path,$docMatch) && $method==='GET') {
        // Klinik: imzalı onay formunun kayıt görünümü (yazdırılabilir delil).
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        $record=(new VetNet\Cpanel\ClientPermit($db,$origin))->signedDocument($actor,$docMatch[1]);
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        echo VetNet\Cpanel\ClientPermit::html($record['doc'],$record['hash'],'record',$record);
        exit;
    }
    if ($path==='/api/permit' && in_array($method,['GET','POST'],true)) {
        // Klinik: müşteri KVKK ve iletişim izni onay formları.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        requireFeature($actor,'permits',$method==='POST');
        $permits=new VetNet\Cpanel\ClientPermit($db,$origin);
        try {
            if ($method==='GET') {
                if (is_string($_GET['client']??null)) reply($permits->forClient($actor,$_GET['client'],$now));
                if (isset($_GET['notice'])) reply($permits->notice($actor['partner_id']));
                reply($permits->list($actor,is_string($_GET['status']??null)?$_GET['status']:'',$now));
            }
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            reply($permits->act($actor,input(80000),$now));
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Onay formu tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if ($path==='/api/phone' && in_array($method,['GET','POST'],true)) {
        // Klinik: Telefon Bağlantısı durumu, ayarlar, cihaz eşleştirme, gönderim kuyruğu.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        requireFeature($actor,'phoneGateway',$method==='POST');
        $gateway=new VetNet\Cpanel\PhoneGateway($db);
        try {
            if ($method==='GET') reply($gateway->status($actor,$now)+['server'=>$origin]);
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            $phoneBody=input(20000);
            if (($phoneBody->action ?? '')==='pair' && !(new VetNet\Cpanel\AppDownloads($db,dirname(__DIR__),(string)$config['rateSecret']))->paid((string)$actor['partner_id'])) throw new RuntimeException('Ücretli versiyona entegre edilmiştir.',403);
            reply($gateway->act($actor,$phoneBody,$now)+['server'=>$origin]);
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Telefon bağlantısı tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if (in_array($path,['/telefon-ajani.sh','/telefon-ajani.py'],true) && $method==='GET') {
        // Android (Termux) telefon ajanı: yalnız ücretli bayinin klinik panelinde ürettiği geçerli eşleştirme koduyla indirilir.
        (new DealerLogin($db,$config['rateSecret']))->throttle('phone-agent:'.($_SERVER['REMOTE_ADDR'] ?? ''),$now);
        if (!(new VetNet\Cpanel\PhoneGateway($db))->pendingCode($_GET['kod'] ?? null,$now)) throw new RuntimeException('Geçerli bir eşleştirme kodu gerekli. Kodu klinik panelinde Telefon Bağlantısı bölümünden alın.',403);
        $file=dirname(__DIR__).'/phone-agent/'.($path==='/telefon-ajani.sh'?'kur.sh':'vetzimo-telefon.py');
        if (!is_file($file)) throw new RuntimeException('Dosya bulunamadı.',404);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-cache');
        header('X-Content-Type-Options: nosniff');
        echo str_replace('__VETZIMO_SERVER__',$origin,(string)file_get_contents($file));
        exit;
    }
    if ($path==='/bakanlik-koprusu-ajani.zip' && $method==='GET') {
        // Eski adres: klinik ajanı artık indirme merkezinden (yalnız ücretli bayi, sayılarak) verilir.
        header('Location: /download/agent?src=panel',true,302);
        exit;
    }
    if ($path==='/api/bridge' && in_array($method,['GET','POST'],true)) {
        // Klinik: köprü durumu, ajan eşleştirme, Bakanlığa gönderim kuyruğu ve kararlar.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        if (!VetNet\Cpanel\ClinicAccess::feature($actor,'bridge') && !VetNet\Cpanel\ClinicAccess::feature($actor,'edocs')) requireFeature($actor,'bridge');
        $bridge=new VetNet\Cpanel\MinistryBridge($db);
        try {
            if ($method==='GET') reply($bridge->status($actor,$now));
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            $body=input(20000);
            $op=$body->action ?? '';
            if ($op==='pair' && !(new VetNet\Cpanel\AppDownloads($db,dirname(__DIR__),(string)$config['rateSecret']))->paid((string)$actor['partner_id'])) throw new RuntimeException('Ücretli versiyona entegre edilmiştir.',403);
            reply(match($op){
                'pair'=>$bridge->pair($actor,$now),
                'revoke'=>$bridge->revoke($actor,$now),
                'check-session','login'=>$bridge->command($actor,is_string($body->portal??null)&&in_array($body->portal,['gib','efatura','esmm'],true)&&$op==='login'?'login:'.$body->portal:$op),
                'enqueue'=>(function() use ($actor,$body,$now,$bridge){requireFeature($actor,in_array($body->kind ?? '',['earsiv','efatura','esmm'],true)?'edocs':'bridge',true);return $bridge->enqueue($actor,$body,$now);})(),
                'cancel','link','resend'=>$bridge->resolve($actor,$body,$now),
                default=>throw new RuntimeException('İşlem geçersiz.',422),
            });
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Köprü tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if ($path==='/api/inbox' && in_array($method,['GET','POST'],true)) {
        // Klinik: çok kanallı gelen kutusu (WhatsApp, Facebook, Instagram, Telegram, SMS, e-posta, web formu).
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        requireFeature($actor,'inbox',$method==='POST');
        $inbox=new VetNet\Cpanel\OmniInbox($db,(string)($config['encryptionKey'] ?? ''),$origin,$config['inboxEndpoints'] ?? []);
        try {
            if ($method==='GET') {
                $op=$_GET['op'] ?? 'list';
                $str=static fn(string $k)=>is_string($_GET[$k] ?? null) ? $_GET[$k] : '';
                reply(match($op){
                    'list'=>$inbox->list($actor,['box'=>$str('box'),'channel'=>$str('channel'),'q'=>$str('q'),'before'=>(int)$str('before')],$now),
                    'thread'=>$inbox->thread($actor,(int)$str('id'),$now),
                    'cursor'=>['cursor'=>$inbox->cursor($actor)],
                    'channels'=>$inbox->channels($actor),
                    // Genel bakış kartı ve menü rozeti: okunmamış sayısı, kanal başına açık konuşma ve son 4 konuşma
                    'summary'=>(static function() use($inbox,$actor,$now){$l=$inbox->list($actor,['box'=>'open'],$now);return ['boxes'=>$l['boxes'],'channels'=>$l['channels'],'items'=>array_slice($l['items'],0,4)];})(),
                    'team'=>$inbox->team($actor)+['me'=>(string)($actor['membership_id'] ?? ''),'settings'=>$inbox->settings($actor['partner_id'])]+$inbox->quick($actor),
                    default=>throw new RuntimeException('İşlem geçersiz.',422),
                });
            }
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            $body=input(40000);
            $op=$body->action ?? '';
            reply(match($op){
                'channel-save'=>$inbox->saveChannel($actor,$body,$now),
                'channel-delete'=>$inbox->deleteChannel($actor,$body),
                'channel-test'=>$inbox->testChannel($actor,$body),
                default=>$inbox->act($actor,$body,$now),
            });
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Gelen kutusu tabloları henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if ($path==='/api/team-2fa' && in_array($method,['GET','POST'],true)) {
        // Ekip hesabı iki adımlı doğrulama: durum, kurulum başlat, kodla onayla, kapat.
        $actor=$identity->actor($_COOKIE,$now);
        $totp=new VetNet\Cpanel\TeamTotp($db,(string)($config['encryptionKey'] ?? ''));
        try {
            if ($method==='GET') reply($totp->status($actor));
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            (new DealerLogin($db,$config['rateSecret']))->throttle('team2fa:'.$actor['account_id'],$now);
            $body=input(4096);
            $op=$body->action ?? '';
            $code=is_string($body->code ?? null)?$body->code:'';
            if ($op==='start') reply($totp->start($actor,'VetZimo'));
            if ($op==='confirm') reply($totp->confirm($actor,$code,$now));
            if ($op==='disable') reply($totp->disable($actor,is_string($body->password ?? null)?$body->password:'',$code,$now));
            throw new RuntimeException('İşlem geçersiz.',422);
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('İki adımlı doğrulama tablosu henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
    }
    if ($path==='/api/web-inbox' && in_array($method,['GET','POST'],true)) {
        // Web sitesi iletişim mesajları: liste, işlendi işareti, müşteri kartı bağlantısı.
        $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($identity->actor($_COOKIE,$now));
        requireFeature($actor,'webSite');
        $inbox=new VetNet\Cpanel\WebInbox($db);
        try {
            if ($method==='GET') reply($inbox->list($actor,is_string($_GET['durum']??null)?$_GET['durum']:'open'));
            if (!hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
            reply($inbox->update($actor,input(2048),$now));
        } catch (PDOException $error) {
            if (in_array($error->getCode(),['42S02','42S22'],true)) reply(['items'=>[],'open'=>0,'unavailable'=>true]);
            throw $error;
        }
    }
    if ($path==='/api/consents' && in_array($method,['GET','POST'],true)) {
        // Dijital onam: klinik hazırlar/iptal eder/klinikte imzalatır; hasta sahibi kendi formunu imzalar veya reddeder.
        $actor=$identity->actor($_COOKIE,$now);
        if ($method==='POST' && !hash_equals($actor['membership_id'] ?? '',$_SERVER['HTTP_X_VETNET_SCOPE'] ?? '')) {
            throw new RuntimeException('Çalışma alanı oturumu değişti.',409);
        }
        if ($actor['role']!=='customer') $actor=(new VetNet\Cpanel\Commerce($db))->packageActor($actor);
        else if ($method==='POST') (new DealerLogin($db,$config['rateSecret']))->throttle('consent:'.$actor['account_id'],$now);
        requireFeature($actor,'consents',$method==='POST');
        $consents=new VetNet\Cpanel\ClinicConsent($db);
        try {
            if ($method==='GET') {
                $id=$_GET['id'] ?? '';
                if (is_string($id) && $id!=='') reply($consents->get($actor,$id));
                if ($actor['role']==='customer') reply(['items'=>$consents->ownerList($actor)]);
                reply($consents->list($actor,array_map(static fn($v)=>is_string($v)?$v:'',array_intersect_key($_GET,array_flip(['patient','customer','record','status'])))));
            }
            $body=input(450000);
            $op=$body->action ?? '';
            $id=is_string($body->id ?? null)?$body->id:'';
            if ($actor['role']==='customer') {
                if ($op!=='decide') throw new RuntimeException('İşlem geçersiz.',422);
                reply($consents->ownerDecide($actor,$id,$body,$now,$_SERVER));
            }
            if ($op==='create') reply($consents->create($actor,$body,$now));
            if ($op==='cancel') reply($consents->cancel($actor,$id,$now));
            if ($op==='decide') reply($consents->signInClinic($actor,$id,$body,$now,$_SERVER));
            throw new RuntimeException('İşlem geçersiz.',422);
        } catch (PDOException $error) {
            if ($error->getCode()==='42S02') throw new RuntimeException('Onam tablosu henüz kurulmadı; güncellemeyi tamamlayın.',503);
            throw $error;
        }
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
        // Yalnız açılan kayıt ve ilgili hasta/sahip satırları okunur; eski biçimdeki alanda tüm klinik yüklenir.
        $ref = [];
        foreach (['client','patient','vaccine','exam','stay','surgery','sale','purchase'] as $key) {
            if (is_string($_GET[$key] ?? null) && preg_match('/\A[A-Za-z0-9_.:-]{1,80}\z/D', $_GET[$key])) $ref[$key] = $_GET[$key];
        }
        $state = (new VetNet\Cpanel\ClinicRecords($db))->printSlice('partner:'.$actor['partner_id'], $ref)
            ?? (new VetNet\Cpanel\WorkspaceRepository($db))->load('partner:'.$actor['partner_id'])['state'];
        reply((new VetNet\Cpanel\PrintTemplates($db))->listing($actor, ClinicAccess::visible($state, $actor)));
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
            if (!ClinicAccess::feature($actor,'bulkMessages',true)) throw new RuntimeException('Toplu mesaj paketinizde kapalı.',403);
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
            'php'=>true,'workspacePatch'=>true,'recordDeletion'=>$actor['role']==='dealer','packageRestricted'=>isset($actor['packageModules']),'agreementRequired'=>!(new VetNet\Cpanel\DealerAgreement($db))->signed($actor['partner_id']),'personalPalette'=>$appearance->read('account:'.$actor['account_id'])['palette'],'role'=>$actor['role']==='dealer'?'dealer':'staff','central'=>true,'memberRole'=>$actor['role'],'member'=>['role'=>$actor['role']],'modules'=>ClinicAccess::modules($actor),'branches'=>[$actor['branch_id']],'scopeId'=>$actor['membership_id'],
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
