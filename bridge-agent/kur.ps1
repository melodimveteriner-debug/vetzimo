# Windows açılışında ajanı görünmeden başlatan kısayol (kullanıcının Başlangıç klasörü).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $startup 'VetZimo Bakanlik Koprusu.lnk'))
$link.TargetPath = 'wscript.exe'
$link.Arguments = '"' + (Join-Path $dir 'baslat.vbs') + '"'
$link.WorkingDirectory = $dir
$link.Description = 'VetZimo Bakanlik Koprusu ajani'
$link.Save()
Write-Host 'Otomatik baslatma eklendi.'
