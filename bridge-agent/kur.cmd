@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VetZimo Bakanlik Koprusu kuruluyor...
set NODE="%ProgramFiles%\nodejs\node.exe"
set NPM="%ProgramFiles%\nodejs\npm.cmd"
if not exist %NODE% (
  echo Node.js bulunamadi, kuruluyor. Yonetici izni istenirse Evet deyin.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
)
if not exist %NODE% (echo Node.js kurulamadi. https://nodejs.org adresinden LTS surumunu kurup tekrar deneyin. & pause & exit /b 1)
call %NPM% install --omit=dev --no-audit --no-fund
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kur.ps1"
start "" wscript.exe "%~dp0baslat.vbs"
timeout /t 4 >nul
start http://127.0.0.1:5199
echo Kurulum tamamlandi. Panel tarayicida acildi.
pause
