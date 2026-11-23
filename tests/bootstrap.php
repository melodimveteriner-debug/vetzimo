<?php
declare(strict_types=1);
// Testler için tüm sunucu sınıflarını yükler (index.php ile aynı sınıf kümesi).
foreach (glob(__DIR__.'/../src/*.php') as $file) require_once $file;
