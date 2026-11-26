<?php
declare(strict_types=1);
require __DIR__.'/../src/DealerLogin.php';
require __DIR__.'/../src/Pregnancy.php';
require __DIR__.'/../src/AppointmentReminders.php';
use VetNet\Cpanel\{Pregnancy,AppointmentReminders};
function ok(bool $c,string $m){if(!$c){fwrite(STDERR,"HATA: $m\n");exit(1);}}
$p=Pregnancy::plan('2026-01-01','Köpek');
ok($p['us']==='2026-01-31' && $p['xray']==='2026-02-15' && $p['birth']==='2026-03-05','köpek planı');
$c=Pregnancy::plan('2026-01-01','Kedi');
ok($c['birth']==='2026-03-07' && $c['birthMin']==='2026-03-03' && $c['birthMax']==='2026-03-11','kedi planı');
ok(count($c['parasite'])===2,'aylık parazit');
// US günü saat 10:00'da (İstanbul) hatırlatma üretilir
$now=(new DateTimeImmutable('2026-01-31 10:00',new DateTimeZone('Europe/Istanbul')))->getTimestamp();
$state=(object)['preferences'=>(object)[],'branches'=>[(object)['id'=>'b1','name'=>'Merkez','status'=>'Aktif']],
 'patients'=>[(object)['id'=>'p1','name'=>'Bal','branch'=>'b1','owner'=>'c1','species'=>'Köpek']],
 'clients'=>[(object)['id'=>'c1','name'=>'Ayşe','branch'=>'b1','phone'=>'05551112233','sms'=>'Var','whatsapp'=>'Yok']],
 'appointments'=>[],'followups'=>[],'_pregnancies'=>['p1'=>['patient'=>'p1','ended'=>null]+$p]];
$jobs=AppointmentReminders::jobs($state,'Klinik',$now);
$ch=array_column($jobs,'channel');
ok(in_array('app',$ch,true) && in_array('sms',$ch,true) && !in_array('whatsapp',$ch,true),'kanallar: '.implode(',',$ch));
ok(str_contains($jobs[0]['message'],'Bal') && str_contains($jobs[0]['message'],'ultrason'),'ultrason mesajı');
$state->preferences->customerReminder_pregnancy_mode='off';
ok(AppointmentReminders::jobs($state,'Klinik',$now)===[],'kapalıyken gönderilmez');
echo "pregnancy ok\n";
