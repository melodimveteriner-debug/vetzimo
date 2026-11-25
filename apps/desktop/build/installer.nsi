; VetZimo Windows kurulumu (NSIS). Kullanıcı başına kurulum: yönetici izni gerekmez.
; Derleme: makensis -DVERSION=1.0.0 -DSRC=../dist/win-unpacked -DOUT=../dist/VetZimo-Kurulum-1.0.0.exe installer.nsi
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"
!include "FileFunc.nsh"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APP "VetZimo"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VetZimo"
Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\VetZimo"
InstallDirRegKey HKCU "Software\VetZimo" "InstallDir"
RequestExecutionLevel user
BrandingText "VetZimo ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1055 "ProductName" "VetZimo"
VIAddVersionKey /LANG=1055 "FileDescription" "VetZimo Kurulumu"
VIAddVersionKey /LANG=1055 "CompanyName" "VetZimo"
VIAddVersionKey /LANG=1055 "LegalCopyright" "© VetZimo"
VIAddVersionKey /LANG=1055 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${VERSION}"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\VetZimo.exe"
!define MUI_FINISHPAGE_RUN_TEXT "VetZimo'yu başlat"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"
!insertmacro MUI_LANGUAGE "English"

Section "VetZimo" SecMain
  ; Çalışan uygulama varsa kapatılır (güncelleme kurulumunda dosya kilitlenmesin)
  nsExec::Exec 'taskkill /IM VetZimo.exe /F'
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Kaldir.exe"
  CreateDirectory "$SMPROGRAMS\VetZimo"
  CreateShortcut "$SMPROGRAMS\VetZimo\VetZimo.lnk" "$INSTDIR\VetZimo.exe"
  CreateShortcut "$SMPROGRAMS\VetZimo\VetZimo'yu kaldır.lnk" "$INSTDIR\Kaldir.exe"
  CreateShortcut "$DESKTOP\VetZimo.lnk" "$INSTDIR\VetZimo.exe"
  ; vetzimo:// bağlantıları (bildirim ve e-postalardan uygulamayı açar)
  WriteRegStr HKCU "Software\Classes\vetzimo" "" "URL:VetZimo"
  WriteRegStr HKCU "Software\Classes\vetzimo" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\vetzimo\DefaultIcon" "" "$INSTDIR\VetZimo.exe,0"
  WriteRegStr HKCU "Software\Classes\vetzimo\shell\open\command" "" '"$INSTDIR\VetZimo.exe" "%1"'
  WriteRegStr HKCU "Software\VetZimo" "InstallDir" "$INSTDIR"
  ; Programlar ve Özellikler kaydı
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "VetZimo"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "VetZimo"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\VetZimo.exe,0"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "URLInfoAbout" "https://vetzimo.com"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Kaldir.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Kaldir.exe" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM VetZimo.exe /F'
  Delete "$DESKTOP\VetZimo.lnk"
  RMDir /r "$SMPROGRAMS\VetZimo"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Classes\vetzimo"
  DeleteRegKey HKCU "Software\VetZimo"
  DeleteRegKey HKCU "${REGKEY}"
SectionEnd
