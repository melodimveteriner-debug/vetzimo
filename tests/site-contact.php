<?php
declare(strict_types=1);
// Satış sitesi iletişim formu: güvenlik sorusu (yanlış/eski/tekrar kullanılan reddedilir), tuzak alan, saatlik sınır,
// yönetim listesi/ayrıntı/durum/silme, e-posta imzası (şirket bilgileri + telefon), alt bölüm ve iletişim sayfası.
use VetNet\Cpanel\{Database,Installer,SiteContact,SiteLegal,MarketFooter,MarketContactPage};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
function fails(callable $f,string $m): void { try { $f(); } catch (RuntimeException) { return; } throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('İletişim Test','05551000199','ilt@example.test','Iletisim-test-secret-42');
(new SiteLegal($db))->saveCompany((object)(['telefon'=>'0222 333 44 55']+SiteLegal::COMPANY_DEFAULTS),time());
$sc=new SiteContact($db,str_repeat('s',32)); $now=time();
$solve=function(array $c): string { preg_match('/(\d+) (.) (\d+)/u',$c['question'],$m); return (string)($m[2]==='+'?$m[1]+$m[3]:$m[1]-$m[3]); };
$form=fn(array $c,$answer,array $extra=[])=>(object)($extra+['name'=>'Ayşe Yılmaz','email'=>'ayse@example.test','subject'=>'Paketler ve fiyatlar','message'=>'Merhaba, fiyat bilgisi alabilir miyim?','consent'=>true,'token'=>$c['token'],'answer'=>$answer]);
$c=$sc->challenge($now);
ok(!str_contains($c['token'],$solve($c).'|'),'Cevap jetona açık yazılmış');
fails(fn()=>$sc->submit($form($c,'999'),'192.0.2.1',$now),'Yanlış cevap kabul edildi');
fails(fn()=>$sc->submit($form($c,$solve($c)),'192.0.2.1',$now+1300),'Süresi dolan soru kabul edildi');
fails(fn()=>$sc->submit($form($c,$solve($c),['consent'=>false]),'192.0.2.1',$now),'Onaysız form kabul edildi');
$r=$sc->submit($form($c,$solve($c)),'192.0.2.1',$now);
ok(($r['reference'] ?? 0)>0,'Mesaj kaydedilmedi');
fails(fn()=>$sc->submit($form($c,$solve($c)),'192.0.2.1',$now),'Aynı soru ikinci kez kullanıldı');
ok($sc->submit($form($sc->challenge($now),'0',['website'=>'http://spam.example']),'192.0.2.9',$now)===['ok'=>true],'Tuzak alan sessizce geçilmedi');
ok((int)$db->query('SELECT COUNT(*) FROM site_contact_message')->fetchColumn()===1,'Bot mesajı kaydedildi');
for($i=0;$i<4;$i++){ $x=$sc->challenge($now); $sc->submit($form($x,$solve($x)),'192.0.2.1',$now); }
$x=$sc->challenge($now); fails(fn()=>$sc->submit($form($x,$solve($x)),'192.0.2.1',$now),'Saatlik sınır çalışmıyor');
$list=$sc->list('new','',$now); ok(count($list['messages'])===5 && $list['counts']['new']===5,'Liste/sayaç yanlış');
ok(str_contains($list['signature'],'0222 333 44 55') && str_contains($list['signature'],'Zimo Soft'),'İmzada şirket bilgisi/telefon yok');
$id=$list['messages'][0]['id'];
ok($sc->get($id)['message']['status']==='read','Açılan mesaj okundu olmadı');
ok(count($sc->list('','ayse@',$now)['messages'])===5,'Arama çalışmıyor');
$sc->setStatus($id,'archived'); ok(count($sc->list('','',$now)['messages'])===4,'Arşiv listede görünüyor');
fails(fn()=>$sc->reply($id,(object)['body'=>'Yanıt'],'merkez',$now),'SMTP kapalıyken yanıt gönderildi sayıldı');
$sc->delete($id); fails(fn()=>$sc->get($id),'Silinen mesaj açıldı');
// alt bölüm ve iletişim sayfası
$shell='<html><head></head><body><main><div class="split"><div><header class="intro"><h1>İletişim</h1></header></div><form class="card application" method="post" data-application><input name="x"></form></div></main><footer><div>eski</div><!-- vz-legal-foot -->x<!-- /vz-legal-foot --></footer></body></html>';
$company=(new SiteLegal($db))->company();
$html=MarketFooter::apply(MarketContactPage::apply($shell,$company),$company,$now);
ok(str_contains($html,'class="mk-footer"') && !str_contains($html,'eski') && str_contains($html,'tel:02223334455'),'Alt bölüm yenilenmedi');
ok(str_contains($html,'data-site-contact') && !str_contains($html,'data-application') && str_contains($html,'site-contact.js'),'İletişim formu yenilenmedi');
ok(str_contains($html,'/platform/yasal/kvkk-aydinlatma') && str_contains($html,'market-footer.css'),'Yasal bağlantı/CSS eksik');
echo "site-contact ok\n";
