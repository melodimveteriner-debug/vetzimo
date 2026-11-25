#!/data/data/com.termux/files/usr/bin/bash
# VetZimo Telefon Ajanı kurulumu (Android · Termux). Kullanım: curl -fsSL "__VETZIMO_SERVER__/telefon-ajani.sh?kod=KOD" | bash -s KOD
set -e
SERVER="__VETZIMO_SERVER__"
CODE="$1"
if [ -z "$CODE" ]; then echo "Eşleştirme kodu gerekli: ... | bash -s ABCDE-12345"; exit 1; fi
echo "1/4 Gerekli paketler kuruluyor (python, termux-api)…"
pkg install -y python termux-api >/dev/null 2>&1 || { yes | pkg update >/dev/null 2>&1; pkg install -y python termux-api >/dev/null; }
echo "2/4 Ajan indiriliyor…"
mkdir -p "$HOME/.vetzimo-telefon" "$HOME/.termux/boot"
curl -fsSL "$SERVER/telefon-ajani.py?kod=$CODE" -o "$HOME/vetzimo-telefon.py"
echo "3/4 Telefon kliniğe bağlanıyor…"
python "$HOME/vetzimo-telefon.py" eslestir "$CODE" "$SERVER"
cat > "$HOME/.termux/boot/vetzimo-telefon.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
pgrep -f vetzimo-telefon.py >/dev/null || nohup python "$HOME/vetzimo-telefon.py" >/dev/null 2>&1 &
BOOT
chmod +x "$HOME/.termux/boot/vetzimo-telefon.sh"
echo "4/4 Ajan başlatılıyor. Android SMS izni sorarsa İZİN VERİN."
termux-sms-list -l 1 >/dev/null 2>&1 || true
pkill -f vetzimo-telefon.py 2>/dev/null || true
nohup python "$HOME/vetzimo-telefon.py" >/dev/null 2>&1 &
echo
echo "Tamam. Telefon yeniden başladığında ajanın kendiliğinden açılması için F-Droid'den Termux:Boot uygulamasını kurup bir kez açın."
echo "Ayarlar › Pil bölümünden Termux ve Termux:API için pil optimizasyonunu kapatın."
