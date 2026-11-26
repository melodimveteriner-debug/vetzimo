<?php
declare(strict_types=1);
// Klinik yasal metinleri: ortak şablon + şirket bilgileri (boş alanlı satır gizlenir), yalnız bayi yöneticisi değiştirir,
// değişiklikte "son değişiklik" ilerler, düzenlenmeyen metin ayrıca saklanmaz, herkese açık sayfa sorumluluğu kliniğe verir.
use VetNet\Cpanel\{Database,Installer,ClinicLegal,SiteLegal};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Yasal Test','05551000188','yasal@example.test','Yasal-test-secret-42');
$partner=(string)$db->query('SELECT id FROM partner_account LIMIT 1')->fetchColumn();
$legal=new ClinicLegal($db,'https://www.vetzimo.com');
$dealer=['role'=>'dealer','partner_id'=>$partner,'name'=>'Dr. Yönetici'];
$staff=['role'=>'staff','partner_id'=>$partner,'name'=>'Personel'];
$o=$legal->overview($staff);
ok(count($o['docs'])===5 && !$o['canEdit'] && !$o['filled'] && preg_match('~/yasal/[a-z0-9]{12}$~',$o['url'])===1,'Genel görünüm yanlış');
ok((int)$db->query('SELECT COUNT(*) FROM clinic_legal_doc')->fetchColumn()===0,'Düzenlenmeyen metin ayrıca saklandı');
try { $legal->saveProfile($staff,(object)['company'=>(object)['klinik'=>'X','adres'=>'Y','telefon'=>'1']],100); $leak=true; } catch (RuntimeException $e) { $leak=$e->getCode()!==403; }
ok(!$leak,'Personel şirket bilgisini değiştirebildi');
$key=$legal->key($partner);
$page=$legal->page($key,'kvkk-aydinlatma');
ok(!str_contains($page,'{') && !str_contains($page,'MERSİS numarası:'),'Boş alanlı satırlar gizlenmedi');
$t0=$legal->doc($partner,'kvkk-aydinlatma')['changedAt'];
$o=$legal->saveProfile($dealer,(object)['company'=>(object)['klinik'=>'Pati Veteriner Kliniği','unvan'=>'Pati Vet Ltd. Şti.','adres'=>'Odunpazarı / Eskişehir','telefon'=>'0222 111 22 33','eposta'=>'info@pati.example','mersis'=>'0123456789012345']],2000000000);
ok($o['filled'] && $o['docs'][0]['changedAt']===2000000000 && $o['docs'][0]['changedAt']>$t0,'Son değişiklik tarihi ilerlemedi');
$page=$legal->page($key,'kvkk-aydinlatma');
ok(str_contains($page,'Pati Veteriner Kliniği') && str_contains($page,'0123456789012345') && str_contains($page,'Son değişiklik') && str_contains($page,'veri işleyen'),'Sayfa klinik bilgileriyle dolmadı veya sorumluluk notu yok');
ok(str_contains($legal->noticeText($partner),'Pati Veteriner Kliniği') && !preg_match('/\{[a-z_]+\}/',$legal->noticeText($partner)),'Onay formu metni doldurulmadı');
try { $legal->saveProfile($dealer,(object)['company'=>(object)['klinik'=>'A','adres'=>'B','telefon'=>'1','eposta'=>'gecersiz']],1); $bad=true; } catch (RuntimeException) { $bad=false; }
ok(!$bad,'Geçersiz e-posta kabul edildi');
$body=$legal->doc($partner,'acik-riza')['body']."\n## Kliniğe özel\nBu klinik kampanya iletilerini yalnız yılda dört kez gönderir.";
$o=$legal->saveDoc($dealer,(object)['slug'=>'acik-riza','title'=>'Açık Rıza Metni','body'=>$body],2000000500);
$d=array_values(array_filter($o['docs'],fn($x)=>$x['slug']==='acik-riza'))[0];
ok($d['custom'] && $d['changedAt']===2000000500 && str_contains($legal->page($key,'acik-riza'),'yılda dört kez'),'Kliniğe özel metin yayınlanmadı');
$o=$legal->saveDoc($dealer,(object)['slug'=>'acik-riza','reset'=>true],2000000600);
ok(!array_values(array_filter($o['docs'],fn($x)=>$x['slug']==='acik-riza'))[0]['custom'] && (int)$db->query('SELECT COUNT(*) FROM clinic_legal_doc')->fetchColumn()===0,'Ortak şablona dönülmedi');
// yönetici şablonu değiştirince düzenlememiş klinik yeni şablonu görür
$tpl=(new SiteLegal($db))->doc('klinik-cerez-politikasi');
(new SiteLegal($db))->save((object)['slug'=>'klinik-cerez-politikasi','title'=>$tpl['title'],'summary'=>$tpl['summary'],'body'=>$tpl['body']."\n## Yeni bölüm\nŞablona eklenen yeni bölüm.",'version'=>$tpl['version']],'Merkez',time());
ok(str_contains($legal->page($key,'cerez-politikasi'),'Şablona eklenen yeni bölüm'),'Ortak şablon değişikliği kliniğe yansımadı');
ok(!SiteLegal::siteSlug('klinik-kvkk-aydinlatma') && SiteLegal::validSlug('klinik-kvkk-aydinlatma'),'Klinik şablonu satış sitesinde yayınlanabilir durumda');
try { $legal->page('yokboylebiranahtar','kvkk-aydinlatma'); $found=true; } catch (RuntimeException) { $found=false; }
ok(!$found,'Geçersiz anahtar sayfa açtı');
echo "Klinik yasal metinleri doğru\n";
