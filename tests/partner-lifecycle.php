<?php
declare(strict_types=1);
// Bayi yaşam döngüsü: kalan gün uyarısı, 30 gün saklama sonrası girişin kapanması ve yöneticinin bayiyi tamamen silmesi
// (başka bayinin verisine ve başka kurumda da üyeliği olan hesaba dokunmadan, veritabanında hiçbir iz kalmadan).
use VetNet\Cpanel\{Database,Installer,DealerLogin,SessionRepository,DealerWorkspace,ClinicApi,IdentityApi,ClientPermit,ClinicLegal,PartnerLifecycle,Commerce};
require __DIR__.'/bootstrap.php';
function ok(bool $v,string $m): void { if(!$v) throw new RuntimeException($m); }
$db=Database::connect(getenv('VETNET_TEST_DSN'),'root','');
(new Installer($db,dirname(__DIR__)))->install('Silinecek Klinik','05551000177','sil@example.test','Silme-test-secret-42');
$now=time(); $login=new DealerLogin($db,str_repeat('q',32)); $identity=new IdentityApi($db); $work=new DealerWorkspace($db); $api=new ClinicApi($work);
$l=$login->signIn('05551000177','Silme-test-secret-42','192.0.2.170',$now);
$cookies=[SessionRepository::SESSION_COOKIE=>$l['token'],SessionRepository::DEVICE_COOKIE=>$l['device']];
$actor=(new Commerce($db))->packageActor($identity->actor($cookies,$now)); $actor['name']='Dr. Silinecek';
$A=$actor['partner_id'];
$data=$work->read($cookies,$now); $state=$data['state'];
$state->clients=[(object)['id'=>'c1','branch'=>'merkez','name'=>'Hasta Sahibi','phone'=>'0532 444 55 66','sms'=>'Var']];
$api->save($cookies,$actor['membership_id'],$now,(object)['revision'=>$data['revision'],'state'=>$state]);
(new ClientPermit($db,'https://x.example'))->create($actor,(object)['client'=>'c1','method'=>'link'],$now);
(new ClinicLegal($db,'https://x.example'))->saveProfile($actor,(object)['company'=>(object)['klinik'=>'Silinecek Klinik','adres'=>'Adres','telefon'=>'0222 000 00 00']],$now);
// ikinci bayi ve iki kurumda üyeliği olan ortak hesap
$B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
$db->prepare("INSERT INTO partner_account(id,code,name,email,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)")->execute([$B,'BBBB','Kalacak Klinik','kal@example.test','05551000188',gmdate('c'),gmdate('c')]);
$shared=(string)$db->query("SELECT account_id FROM identity_membership WHERE partner_id='$A' AND role='dealer'")->fetchColumn();
$db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES (?,?,?,'dealer','Ortak','{}','active')")->execute([bin2hex(random_bytes(16)),$shared,$B]);
$db->prepare("INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,?,?,?)")->execute([$B,'pro','Pro','paid',date('Y-m-d',strtotime('-100 days')),date('Y-m-d',strtotime('+10 days'))]);
(new ClinicLegal($db,'https://x.example'))->key($B);
$life=new PartnerLifecycle($db);
// ── kalan gün uyarısı
$r=$life->renewal($B);
ok($r!==null && $r['state']==='ending' && $r['days']>=9 && $r['days']<=10,'30 günden az kalan abonelik uyarısı yok: '.json_encode($r));
// ── yönetici ataması çakışan dönemi değiştirir; süreli deneme paketi bitince eski pakete döner
$com=new Commerce($db); $d=fn(int $n)=>date('Y-m-d',strtotime(($n>=0?'+':'').$n.' days'));
$db->beginTransaction(); $com->assign((object)['partnerId'=>$B,'plan'=>'pro','kind'=>'assigned','starts_on'=>$d(0),'ends_on'=>$d(40)],true); $db->commit();
$t=$db->query("SELECT starts_on,ends_on FROM clinic_subscription WHERE partner_id='$B' ORDER BY starts_on")->fetchAll(PDO::FETCH_ASSOC);
ok(count($t)===2 && $t[0]['ends_on']===$d(-1) && $t[1]['ends_on']===$d(40),'Çakışan dönem değiştirilmedi: '.json_encode($t));
$threw=false; try { $com->assign((object)['partnerId'=>$B,'plan'=>'pro','kind'=>'trial','starts_on'=>$d(1),'ends_on'=>$d(5)]); } catch (RuntimeException) { $threw=true; }
ok($threw,'Otomatik atamada çakışma denetimi kalktı');
$plans=$com->catalog(); $upper=null; foreach ($plans as $id=>$pl) if (\VetNet\Cpanel\SaasPayment::rank($pl)>\VetNet\Cpanel\SaasPayment::rank($plans['pro'] ?? null)) { $upper=$id; break; }
ok($upper!==null,'Üst paket bulunamadı');
$threw=false; try { $com->upgradeTrial((object)['partnerId'=>$B,'plan'=>'ucretsiz','days'=>5]); } catch (RuntimeException) { $threw=true; }
ok($threw,'Alt pakete süreli deneme açıldı');
$u=$com->upgradeTrial((object)['partnerId'=>$B,'plan'=>$upper,'days'=>500 > 365 ? 365 : 5]);
ok($u['ends']===$d(40),'Deneme temel dönemi aştı: '.json_encode($u));
$u=$com->upgradeTrial((object)['partnerId'=>$B,'plan'=>$upper,'days'=>7]);
ok($u['ends']===$d(6) && $u['returnsTo']==='Pro','Süreli deneme bitişi yanlış');
ok((int)$db->query("SELECT COUNT(*) FROM clinic_subscription WHERE partner_id='$B' AND kind='upgrade' AND ends_on>='".$d(0)."'")->fetchColumn()===1,'Önceki deneme bitirilmedi');
ok($com->subscription($B)['current']['plan_id']===$upper,'Deneme süresinde geçerli paket deneme paketi değil');
$rn=$life->renewal($B); ok(($rn['upgrade']['plan'] ?? '')!=='' && ($rn['upgrade']['base'] ?? '')==='Pro','Deneme uyarısı yok: '.json_encode($rn));
$db->exec("UPDATE clinic_subscription SET starts_on='".$d(-8)."',ends_on='".$d(-1)."' WHERE partner_id='$B' AND kind='upgrade'");
ok($com->subscription($B)['current']['plan_id']==='pro','Deneme bitince eski pakete dönülmedi');
$db->exec("DELETE FROM clinic_subscription WHERE partner_id='$B'");
$db->prepare("INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,?,?,?)")->execute([$B,'pro','Pro','paid',$d(-100),$d(10)]);
$db->exec("DELETE FROM clinic_subscription WHERE partner_id='$A'");
$db->prepare("INSERT INTO clinic_subscription(partner_id,plan_id,plan_name,kind,starts_on,ends_on) VALUES (?,?,?,?,?,?)")->execute([$A,'pro','Demo','trial',date('Y-m-d',strtotime('-3 days')),date('Y-m-d',strtotime('+11 days'))]);
ok($life->renewal($A)['state']==='trial','Demo uyarısı yok');
// ── süresi dolan: giriş hemen kapanır, veriler 30 gün saklanır, yenilenirse yeniden açılır, 30 gün sonra otomatik silinir
$db->exec("UPDATE clinic_subscription SET starts_on='".date('Y-m-d',strtotime('-80 days'))."',ends_on='".date('Y-m-d',strtotime('-20 days'))."' WHERE partner_id='$A'");
$r=$life->sweep($now);
ok($r['closed']===[$A] && $r['purged']===[],'Süresi biten bayinin girişi kapanmadı ya da erken silindi: '.json_encode($r));
ok($life->retention($A)['state']==='retention','Saklama durumu yanlış');
$other=$login->signIn('05551000177','Silme-test-secret-42','192.0.2.170',$now);
ok(($other['partner_id'] ?? '')===$B,'Ortak hesap açık olan diğer kliniğe giremedi');
$db->exec("UPDATE identity_membership SET status='pending' WHERE partner_id='$B' AND account_id='$shared'");
$msg=''; try { $login->signIn('05551000177','Silme-test-secret-42','192.0.2.171',$now); } catch (RuntimeException $e) { $msg=$e->getMessage(); }
ok(str_contains($msg,'saklanıyor'),'Kapanan bayiye açıklayıcı mesaj gösterilmedi: '.$msg);
$wrong=null; try { $wrong=$login->signIn('05551000177','yanlis-sifre-0000','192.0.2.172',$now); } catch (RuntimeException $e) { $wrong='hata:'.$e->getMessage(); }
ok($wrong===null,'Yanlış şifrede kapanış bilgisi sızdı');
$db->exec("UPDATE identity_membership SET status='active' WHERE partner_id='$B' AND account_id='$shared'");
ok((int)$db->query("SELECT COUNT(*) FROM identity_session s JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id='$A'")->fetchColumn()===0,'Oturumlar sonlanmadı');
$db->beginTransaction(); $com->assign((object)['partnerId'=>$A,'plan'=>'pro','kind'=>'assigned','starts_on'=>date('Y-m-d'),'ends_on'=>date('Y-m-d',strtotime('+5 days'))],true); $db->commit();
ok((int)$db->query("SELECT active FROM partner_account WHERE id='$A'")->fetchColumn()===1,'Yenilenen bayi yeniden açılmadı');
$db->exec("DELETE FROM clinic_subscription WHERE partner_id='$A' AND ends_on>='".date('Y-m-d')."'");
ok($life->sweep($now)['closed']===[$A],'İkinci kapanış olmadı');
$db->exec("UPDATE clinic_subscription SET ends_on='".date('Y-m-d',strtotime('-31 days'))."' WHERE partner_id='$A'");
$db->exec("UPDATE partner_closure SET ends_on='".date('Y-m-d',strtotime('-31 days'))."' WHERE partner_id='$A'");
ok($life->retention($A)['state']==='retention-over','30 gün dolmuş görünmüyor');
// ── tamamen silme
$sum=$life->summary($A);
ok($sum['counts']['Üyelik (bayi, şube, personel, hasta sahibi)']>=1,'Özet boş');
$r=$life->sweep($now);
ok($r['purged']===[$A],'30 gün sonunda otomatik silinmedi: '.json_encode($r));
ok((int)$db->query("SELECT COUNT(*) FROM partner_account WHERE id='$A'")->fetchColumn()===0,'Bayi kaydı silinmedi');
$left=[];
foreach ($db->query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('varchar','char','text','mediumtext')")->fetchAll(PDO::FETCH_NUM) as [$t,$c]) {
  $q=$db->prepare("SELECT COUNT(*) FROM `$t` WHERE `$c`=? OR `$c`=? OR `$c` LIKE ?"); $q->execute([$A,'partner:'.$A,'partner:'.$A.':%']);
  if ((int)$q->fetchColumn()>0 && !($t==='center_audit')) $left[]="$t.$c";
}
ok(!$left,'Silinen bayiden iz kaldı: '.implode(', ',$left));
ok((int)$db->query("SELECT COUNT(*) FROM partner_account WHERE id='$B'")->fetchColumn()===1 && (int)$db->query("SELECT COUNT(*) FROM clinic_subscription WHERE partner_id='$B'")->fetchColumn()===1
  && (int)$db->query("SELECT COUNT(*) FROM clinic_legal_profile WHERE partner_id='$B'")->fetchColumn()===1,'Diğer bayinin verisi silindi');
ok((int)$db->query("SELECT COUNT(*) FROM identity_account WHERE id='$shared'")->fetchColumn()===1,'Başka kurumda üyeliği olan hesap silindi');
ok((int)$db->query("SELECT COUNT(*) FROM identity_account a WHERE a.kind='phone' AND NOT EXISTS (SELECT 1 FROM identity_membership m WHERE m.account_id=a.id)")->fetchColumn()===0,'Sahipsiz hesap kaldı');
echo "Bayi yaşam döngüsü doğru\n";
