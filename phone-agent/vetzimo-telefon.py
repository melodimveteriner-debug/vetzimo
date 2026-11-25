#!/usr/bin/env python3
# VetZimo Telefon Ajanı (Android · Termux)
# Kliniğin kendi SIM kartından SMS gönderir, gelen SMS'leri VetZimo gelen kutusuna iletir ve
# yarı otomatik WhatsApp mesajlarını bildirim olarak gösterir. Ücretli SMS sağlayıcısı gerekmez.
# İsteğe bağlı: WhatsApp, Instagram, Facebook Messenger ve Telegram'a gelen mesajları telefonun bildirimlerinden okuyup
# VetZimo gelen kutusuna aktarır; gelen kutusundan yazılan yanıt telefonda "Kopyala ve aç" bildirimiyle gönderilir.
# Kullanım:  python vetzimo-telefon.py eslestir KOD [SUNUCU]   ·   python vetzimo-telefon.py   ·   python vetzimo-telefon.py durum
import hashlib, json, os, random, shutil, subprocess, sys, time, urllib.error, urllib.request

VERSION = "1.3.0"
HOME = os.environ.get("VZ_PHONE_HOME") or os.path.join(os.path.expanduser("~"), ".vetzimo-telefon")
CONFIG = os.path.join(HOME, "config.json")
STATE = os.path.join(HOME, "durum.json")
OPENED = os.path.join(HOME, "acilan.txt")
REPLIES = os.path.join(HOME, "yanitlar")
# Bildirimleri okunan uygulamalar (paket adı → kanal)
APPS = {"com.whatsapp": "whatsapp", "com.whatsapp.w4b": "whatsapp", "com.instagram.android": "instagram", "com.instagram.lite": "instagram",
        "com.facebook.orca": "messenger", "com.facebook.mlite": "messenger", "com.facebook.katana": "messenger",
        "org.telegram.messenger": "telegram", "org.telegram.messenger.web": "telegram", "org.thunderdog.challegram": "telegram"}
APP_NAMES = {"whatsapp": "WhatsApp", "instagram": "Instagram", "messenger": "Facebook", "telegram": "Telegram"}
# Özet bildirimleri ("5 yeni mesaj", "WhatsApp Web etkin" vb.) aktarılmaz.
SUMMARY = ("yeni mesaj", "new message", "messages from", "sohbetten", "chats", "whatsapp web", "arama", "calling", "missed call", "cevapsız",
           "yedekleniyor", "backup", "checking for new messages", "yeni mesajlar kontrol")
LOG = os.path.join(HOME, "gunluk.txt")
DEFAULT_SERVER = "__VETZIMO_SERVER__"
os.makedirs(HOME, exist_ok=True)


def log(message):
    line = time.strftime("%Y-%m-%d %H:%M:%S") + "  " + message
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        if os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + ".1")
    except OSError:
        pass


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def termux(name, *args, timeout=60, stdin=None):
    """Termux:API komutunu çalıştırır. Test için VZ_TERMUX_BIN ile sahte komut klasörü verilebilir."""
    folder = os.environ.get("VZ_TERMUX_BIN")
    command = os.path.join(folder, name) if folder else shutil.which(name)
    if not command or not os.path.exists(command):
        raise RuntimeError(name + " bulunamadı. Termux:API uygulamasını ve 'pkg install termux-api' paketini kurun.")
    done = subprocess.run([command, *args], capture_output=True, text=True, timeout=timeout, input=stdin)
    if done.returncode != 0:
        raise RuntimeError((done.stderr or done.stdout or name + " hata verdi").strip()[:300])
    return done.stdout


def api(config, op, body):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "VetZimoTelefon/" + VERSION}
    if config.get("token"):
        headers["Authorization"] = "Bearer " + config["token"]
        headers["X-Phone-Token"] = config["token"]
    req = urllib.request.Request(config["server"].rstrip("/") + "/api/phone/agent/" + op, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read().decode()).get("error", "")
        except ValueError:
            message = ""
        err = RuntimeError(message or "Sunucu hatası " + str(e.code))
        err.status = e.code
        raise err


def sms_key(item):
    raw = item.get("_id", item.get("id"))
    if isinstance(raw, int) or (isinstance(raw, str) and raw.isdigit()):
        return int(raw)
    digest = hashlib.sha1((str(item.get("number")) + "|" + str(item.get("received")) + "|" + str(item.get("body"))).encode()).hexdigest()
    return int(digest[:12], 16)


def read_inbox():
    out = termux("termux-sms-list", "-t", "inbox", "-l", "40")
    items = json.loads(out or "[]")
    result = []
    for item in items if isinstance(items, list) else []:
        try:
            at = int(time.mktime(time.strptime(str(item.get("received", ""))[:19], "%Y-%m-%d %H:%M:%S")))
        except ValueError:
            at = int(time.time())
        result.append({"id": sms_key(item), "number": str(item.get("number", "")), "body": str(item.get("body", "")), "at": at})
    return result


def read_apps():
    """WhatsApp, Instagram, Facebook ve Telegram bildirimlerinden gelen mesajları okur (Termux:API bildirim erişimi gerekir)."""
    items = json.loads(termux("termux-notification-list", timeout=30) or "[]")
    result = []
    for n in items if isinstance(items, list) else []:
        app = APPS.get(str(n.get("packageName", "")))
        if not app:
            continue
        title, text = str(n.get("title") or "").strip(), str(n.get("content") or "").strip()
        if not title or not text or title.lower() in ("whatsapp", "instagram", "messenger", "facebook", "telegram", "whatsapp business"):
            continue
        if any(w in (title + " " + text).lower() for w in SUMMARY) and len(text) < 60:
            continue
        # Grup bildirimlerinde başlık "Grup: Kişi" olabilir; kişi adı alınır.
        name = title.split(": ", 1)[-1] if app == "whatsapp" and ": " in title else title
        name = name.split(" (")[0].strip()[:120]
        key = hashlib.sha1((app + "|" + name + "|" + text).encode()).hexdigest()[:40]
        result.append({"key": "n" + key, "app": app, "name": name, "text": text[:4000], "at": int(int(n.get("when") or 0) / 1000) if str(n.get("when", "")).isdigit() else int(time.time())})
    return result


def sent_confirmed(phone, body):
    """SMS'in telefonun Gönderilenler kutusuna düşüp düşmediğine bakar (birkaç saniye bekleyerek)."""
    digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
    head = " ".join(body.split())[:20]
    for wait in (4, 6, 10):
        time.sleep(wait)
        for box in ("sent", "outbox"):
            try:
                items = json.loads(termux("termux-sms-list", "-t", box, "-l", "15", timeout=30) or "[]")
            except Exception:
                return True  # Gönderilenler okunamıyorsa (izin) doğrulama yapılamaz; gönderildi kabul edilir.
            for item in items if isinstance(items, list) else []:
                num = "".join(ch for ch in str(item.get("number", "")) if ch.isdigit())[-10:]
                if num == digits and " ".join(str(item.get("body", "")).split())[:20] == head:
                    if box == "sent":
                        return True
                    break
    return False


def battery():
    try:
        return int(json.loads(termux("termux-battery-status", timeout=20)).get("percentage"))
    except Exception:
        return None


def pair(code, server):
    config = load(CONFIG, {})
    config["server"] = (server or config.get("server") or DEFAULT_SERVER).rstrip("/")
    if not config["server"].startswith("https://") and "127.0.0.1" not in config["server"] and "localhost" not in config["server"]:
        sys.exit("Sunucu adresi https:// ile başlamalı.")
    config["token"] = ""
    model = ""
    try:
        model = subprocess.run(["getprop", "ro.product.model"], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        pass
    result = api(config, "pair", {"code": code, "name": model or "Android telefon", "version": VERSION, "info": model})
    config["token"] = result["token"]
    save(CONFIG, config)
    save(STATE, {"seen": [], "baseline": False, "notified": []})
    log("Eşleştirme tamamlandı. Telefon artık kliniğin SMS hattı olarak çalışabilir.")


def run():
    config = load(CONFIG, {})
    if not config.get("token"):
        sys.exit("Önce eşleştirin:  python vetzimo-telefon.py eslestir KOD")
    try:
        termux("termux-wake-lock", timeout=10)
    except Exception as e:
        log("Uyanık tutma açılamadı: " + str(e))
    state = load(STATE, {"seen": [], "baseline": False, "notified": []})
    # Açılışta bekleyen WhatsApp/uygulama yanıtı bildirimleri yeniden gösterilir (kapatılmış olsalar bile).
    state["notified"], state["replied"] = [], []
    results, last_battery, battery_at, wait, error = [], None, 0, 2, ""
    log("VetZimo Telefon Ajanı " + VERSION + " çalışıyor · sunucu: " + config["server"])
    apps_on, apps_seen = bool(state.get("apps")), set(state.get("appsSeen", []))
    while True:
        time.sleep(wait)
        inbound = []
        try:
            current = read_inbox()
            seen = set(state.get("seen", []))
            if not state.get("baseline"):
                # İlk çalıştırmada telefondaki eski SMS'ler aktarılmaz; yalnız bundan sonra gelenler.
                seen.update(m["id"] for m in current)
                state["baseline"] = True
            else:
                inbound = [m for m in current if m["id"] not in seen]
            error = ""
        except Exception as e:
            current, error = [], "Gelen SMS okunamadı: " + str(e)
        apps_in = []
        if apps_on:
            try:
                found = read_apps()
                if not state.get("appsBaseline"):
                    apps_seen.update(m["key"] for m in found)
                    state["appsBaseline"] = True
                else:
                    apps_in = [m for m in found if m["key"] not in apps_seen]
            except Exception as e:
                error = (error + " · " if error else "") + "Uygulama bildirimleri okunamadı (Termux:API bildirim erişimi açık mı?): " + str(e)[:120]
        if time.time() - battery_at > 300:
            last_battery, battery_at = battery(), time.time()
        opened = []
        try:
            with open(OPENED, encoding="utf-8") as f:
                opened = sorted({int(x) for x in f.read().split() if x.isdigit()})
        except OSError:
            pass
        try:
            reply = api(config, "sync", {"version": VERSION, "battery": last_battery, "info": "Termux", "error": error,
                                         "inbound": sorted(inbound, key=lambda m: m["id"]), "apps": apps_in, "results": results, "opened": opened})
        except Exception as e:
            if getattr(e, "status", 0) == 401:
                log(str(e))
                config["token"] = ""
                save(CONFIG, config)
                sys.exit(1)
            log("Sunucuya ulaşılamadı: " + str(e))
            wait = min(60, wait * 2 if wait >= 15 else 15)
            continue
        # Sunucu kabul ettiyse yerel kayıtlar temizlenir.
        results = []
        if opened:
            try:
                os.remove(OPENED)
            except OSError:
                pass
        seen = set(state.get("seen", [])) | {m["id"] for m in inbound} | {m["id"] for m in current}
        state["seen"] = sorted(seen)[-2000:]
        if inbound:
            log(str(len(inbound)) + " gelen SMS VetZimo'ya iletildi.")
        if apps_in:
            apps_seen.update(m["key"] for m in apps_in)
            log(str(len(apps_in)) + " uygulama mesajı VetZimo'ya iletildi.")
        state["appsSeen"] = list(apps_seen)[-3000:]
        if bool(reply.get("apps")) != apps_on:
            apps_on = bool(reply.get("apps"))
            state["apps"], state["appsBaseline"] = apps_on, False
            log("Uygulama mesajlarını aktarma " + ("açıldı." if apps_on else "kapatıldı."))
        slot = reply.get("simSlot") or ""
        for job in reply.get("jobs", []):
            args = ["-n", job["phone"]]
            if slot in ("0", "1"):
                args += ["-s", slot]
            try:
                termux("termux-sms-send", *args, job["body"], timeout=90)
                # Android hata vermese de SMS çıkmayabilir (SMS izni kısıtlı, SIM seçilmemiş, bakiye yok): Gönderilenler'de doğrula.
                if sent_confirmed(job["phone"], job["body"]):
                    results.append({"id": job["id"], "status": "sent"})
                    log("SMS gönderildi → " + job["phone"][:-4] + "••••")
                else:
                    msg = ("Telefon SMS'i göndermedi (Gönderilenler'de yok). Telefonda Ayarlar › Uygulamalar › Termux:API › İzinler › SMS iznini açın "
                           "(Android 13+: önce ⋮ › Kısıtlanmış ayarlara izin ver); çift SIM'de VetZimo'da SIM 1/SIM 2 seçin; hattın SMS hakkını kontrol edin.")
                    results.append({"id": job["id"], "status": "failed", "error": msg})
                    log("SMS doğrulanamadı → " + job["phone"][:-4] + "•••• · " + msg)
            except Exception as e:
                results.append({"id": job["id"], "status": "failed", "error": str(e)[:300]})
                log("SMS gönderilemedi: " + str(e))
            time.sleep(random.uniform(3, 7))
        maybe_update(config, reply.get("agentVersion") or "", state)
        notify(reply.get("assist", []), state)
        notify_replies(reply.get("replies", []), state)
        save(STATE, state)
        wait = 1 if results else int(reply.get("interval") or 15)


def maybe_update(config, latest, state):
    """Sunucudaki telefon uygulaması daha yeniyse indirir, sözdizimini denetler, dosyayı değiştirir ve kendini yeniden başlatır."""
    ver = lambda v: tuple(int(x) for x in v.split(".") if x.isdigit())
    if not latest or ver(latest) <= ver(VERSION):
        return
    try:
        code = api(config, "script", {}).get("script", "")
        compile(code, "vetzimo-telefon.py", "exec")
        if 'VERSION = "' + latest + '"' not in code:
            return
        path = os.path.abspath(__file__)
        with open(path + ".new", "w", encoding="utf-8") as f:
            f.write(code)
        os.replace(path + ".new", path)
        save(STATE, state)
        log("Telefon uygulaması " + VERSION + " → " + latest + " güncellendi, yeniden başlatılıyor.")
        os.execv(sys.executable, [sys.executable, path])
    except Exception as e:
        log("Güncelleme yapılamadı: " + str(e)[:200])


def notify(items, state):
    """Yarı otomatik WhatsApp: her mesaj için bildirim; dokununca WhatsApp hazır metinle açılır."""
    notified = set(state.get("notified", []))
    script = os.path.abspath(__file__)
    active = {i["id"] for i in items}
    for item in items:
        if item["id"] in notified:
            continue
        action = "termux-open-url '" + item["link"].replace("'", "%27") + "'; python '" + script + "' acildi " + str(item["id"])
        try:
            termux("termux-notification", "--id", "vzwa" + str(item["id"]), "--title", "WhatsApp mesajı bekliyor · " + item["phone"],
                   "--content", item["preview"], "--action", action, "--button1", "Aç ve gönder", "--button1-action", action, "--priority", "high", "--ongoing", "--alert-once", timeout=20)
            notified.add(item["id"])
        except Exception as e:
            log("Bildirim gösterilemedi: " + str(e))
    state["notified"] = sorted(n for n in notified if n in active)[-200:]


def notify_replies(items, state):
    """Gelen kutusundan yazılan Instagram/Facebook/Telegram/WhatsApp yanıtı: dokununca metin kopyalanır ve uygulama açılır."""
    os.makedirs(REPLIES, exist_ok=True)
    done = set(state.get("replied", []))
    script = os.path.abspath(__file__)
    active = {i["id"] for i in items}
    for item in items:
        if item["id"] in done:
            continue
        save(os.path.join(REPLIES, str(int(item["id"])) + ".json"), {"body": item["body"], "link": item["link"]})
        action = "python '" + script + "' yanit " + str(int(item["id"]))
        try:
            termux("termux-notification", "--id", "vzap" + str(item["id"]), "--title", APP_NAMES.get(item["app"], "Mesaj") + " yanıtı · " + (item.get("name") or ""),
                   "--content", item["body"][:120], "--action", action, "--button1", "Kopyala ve aç", "--button1-action", action, "--priority", "high", "--ongoing", "--alert-once", timeout=20)
            done.add(item["id"])
        except Exception as e:
            log("Bildirim gösterilemedi: " + str(e))
    state["replied"] = sorted(n for n in done if n in active)[-200:]


def reply_open(job_id):
    """Yanıt metnini panoya kopyalar, ilgili uygulamayı açar ve yanıtı gönderildi olarak işaretler."""
    path = os.path.join(REPLIES, str(int(job_id)) + ".json")
    data = load(path, {})
    if data.get("body"):
        termux("termux-clipboard-set", stdin=data["body"], timeout=10)
        try:
            termux("termux-toast", "Yanıt kopyalandı · sohbete yapıştırıp gönderin", timeout=10)
        except Exception:
            pass
        if str(data.get("link", "")).split("://")[0] in ("whatsapp", "instagram", "fb-messenger", "tg"):
            termux("termux-open-url", data["link"], timeout=10)
    try:
        os.remove(path)
    except OSError:
        pass
    with open(OPENED, "a", encoding="utf-8") as f:
        f.write(str(int(job_id)) + "\n")
    try:
        termux("termux-notification-remove", "vzap" + str(int(job_id)), timeout=10)
    except Exception:
        pass


def opened(job_id):
    with open(OPENED, "a", encoding="utf-8") as f:
        f.write(str(int(job_id)) + "\n")
    try:
        termux("termux-notification-remove", "vzwa" + str(int(job_id)), timeout=10)
    except Exception:
        pass


def status():
    config = load(CONFIG, {})
    print("Sunucu:", config.get("server") or "-")
    print("Eşleşme:", "var" if config.get("token") else "yok")
    try:
        with open(LOG, encoding="utf-8") as f:
            print("".join(f.readlines()[-15:]))
    except OSError:
        pass


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["eslestir"] and len(args) >= 2:
        pair(args[1], args[2] if len(args) > 2 else "")
    elif args[:1] == ["acildi"] and len(args) == 2 and args[1].isdigit():
        opened(args[1])
    elif args[:1] == ["yanit"] and len(args) == 2 and args[1].isdigit():
        reply_open(args[1])
    elif args[:1] == ["durum"]:
        status()
    elif not args:
        run()
    else:
        print(__doc__ or "Kullanım: eslestir KOD | durum | (boş: çalıştır)")
