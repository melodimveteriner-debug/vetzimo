<?php
declare(strict_types=1);
// Yasal metinler: varsayılan metin okunur, kayıt yeni sürüm açar, eşzamanlı düzenleme reddedilir,
// HTML enjeksiyonu kaçışlanır, boş şirket alanı içeren satır gizlenir, düzenlenme tarihi en üstte gösterilir.
use VetNet\Cpanel\{Database,Installer,SiteLegal};
require __DIR__.'/bootstrap.php';
require_once dirname(__DIR__).'/src/SiteLegal.php';
function ok(bool $value,string $message): void { if(!$value) throw new RuntimeException($message); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Legal Test','05551000116','legal@example.test','Legal-test-secret-42');
$legal=new SiteLegal($db); $now=strtotime('2026-11-24 12:00:00 UTC');
foreach (array_keys(SiteLegal::DOCS) as $slug) { $d=$legal->doc($slug); ok($d['version']>=1 && strlen($d['body'])>1500 && $d['title']!=='','Varsayılan metin eksik: '.$slug); }
$page=$legal->mainHtml('kvkk-aydinlatma')['main'];
ok(strpos($page,'Düzenlenme tarihi:')!==false && strpos($page,'Düzenlenme tarihi:')<strpos($page,'<h1>'),'Düzenlenme tarihi başlığın üstünde değil');
ok(str_contains($page,'26 Kasım 2026') && str_contains($page,'Zimo Soft Yazılım Tasarım İthalat İhracat A.Ş.') && str_contains($page,'Odunpazarı / Eskişehir'),'Şirket veya tarih bilgisi yok');
ok(!str_contains($page,'MERSİS numarası:'),'Boş MERSİS satırı gösterildi');
ok(!preg_match('/\{[a-z_]+\}/',$page),'Doldurulmamış alan kaldı');
$saved=$legal->save((object)['slug'=>'cerez-politikasi','title'=>'Çerez Politikası','summary'=>'Özet','body'=>"## Başlık\n<script>alert(1)</script> **kalın**\n- {unvan}\n- KEP: {kep}",'note'=>'Test','effectiveOn'=>'2026-12-01','version'=>1],'Test Yönetici',$now);
ok($saved['version']===2 && $saved['effective_on']==='2026-12-01','Sürüm artmadı');
ok(count($legal->revisions('cerez-politikasi'))===2,'Varsayılan metin geçmişe yazılmadı');
$html=$legal->mainHtml('cerez-politikasi')['main'];
ok(!str_contains($html,'<script>alert') && str_contains($html,'&lt;script&gt;') && str_contains($html,'<strong>kalın</strong>'),'HTML kaçışlanmadı');
ok(!str_contains($html,'KEP:'),'Boş KEP satırı gösterildi');
ok(str_contains($html,'1 Aralık 2026') && str_contains($html,'Sürüm 2'),'Yeni tarih/sürüm gösterilmedi');
try { $legal->save((object)['slug'=>'cerez-politikasi','title'=>'X','body'=>'Y','version'=>1],'Diğer',$now); $accepted=true; } catch (RuntimeException $e) { $accepted=$e->getCode()!==409; }
ok(!$accepted,'Eski sürüm üzerine yazma engellenmedi');
foreach ([['slug'=>'yok','title'=>'X','body'=>'Y'],['slug'=>'kullanim-sartlari','title'=>'','body'=>'Y'],['slug'=>'kullanim-sartlari','title'=>'X','body'=>'Y','effectiveOn'=>'2026-02-30']] as $bad) {
  try { $legal->save((object)$bad,'x',$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
  ok(!$accepted,'Geçersiz kayıt kabul edildi: '.json_encode($bad,JSON_UNESCAPED_UNICODE));
}
$company=$legal->saveCompany((object)array_merge(SiteLegal::COMPANY_DEFAULTS,['kep'=>'zimosoft@hs01.kep.tr','mersis'=>'0123456789000015']),$now);
ok($company['kep']==='zimosoft@hs01.kep.tr','Şirket bilgisi kaydedilmedi');
ok(str_contains($legal->mainHtml('kvkk-aydinlatma')['main'],'0123456789000015'),'MERSİS gösterilmedi');
try { $legal->saveCompany((object)array_merge(SiteLegal::COMPANY_DEFAULTS,['unvan'=>'']),$now); $accepted=true; } catch (RuntimeException) { $accepted=false; }
ok(!$accepted,'Boş unvan kabul edildi');
ok(str_contains($legal->applyFooter('<p><!-- vz-legal-foot -->eski<!-- /vz-legal-foot --></p>',$now),'Zimo Soft'),'Alt alan satırı güncellenmedi');
echo "legal ok\n";
