<?php
declare(strict_types=1);
require __DIR__.'/../src/DailyNote.php';
use VetNet\Cpanel\DailyNote;
function ok(bool $c,string $m){if(!$c){fwrite(STDERR,"HATA: $m\n");exit(1);}}
$t=DailyNote::normalize("Bugün yapıldı mı? Aranacak var mı?  Siparişler girildi mi?\r\n\r\nTeşekkürler.\n{klinik}");
ok($t==="Bugün yapıldı mı?\nAranacak var mı?\nSiparişler girildi mi?\nTeşekkürler.\n{klinik}",'soru başına satır: '.$t);
ok(count(explode("\n",DailyNote::DEFAULT_TEXT))===10,'hazır şablon 10 satır');
ok(DailyNote::DEFAULT_TIME==='16:00','varsayılan saat');
echo "daily-note ok\n";
