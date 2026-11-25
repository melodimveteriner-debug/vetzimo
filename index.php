<?php
// Yalnız belge kökü "public" yapılamayan sunucular için: istekleri public/index.php'ye devreder.
// Önerilen kurulumda (belge kökü = public) bu dosyaya hiç ulaşılmaz.
require __DIR__ . '/public/index.php';
