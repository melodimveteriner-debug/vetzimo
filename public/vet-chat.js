// VetZimo · VeBot günlük sohbet (Türkçe, kural tabanlı, tamamen cihazda; API'siz ve ücretsiz).
// Selamlaşma, hal hatır, teşekkür, vedalaşma, kimlik, mola/yorgunluk, espri, tarih-saat gibi en sık konuşulan konularda
// giriş yapan kullanıcıya adıyla hitap ederek yanıt verir. Sağlık sorusu belirsizse ek bilgi ister.

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const pick = list => list[Math.floor(Math.random() * list.length)];

/** Hitap için ad: "Dr. Ayşe Yılmaz" → "Ayşe"; klinik/işletme adı ise boş. */
export function firstName(full) {
  const raw = String(full ?? "").trim();
  if (!raw || /@|\d{4,}/.test(raw)) return "";
  if (/\b(klini\w*|veteriner\w*|vet\b|pet\b|hastane\w*|poliklini\w*|merkez\w*|ltd|a\.?ş\.?|şti|shop|center|clinic)\b/i.test(raw)) return "";
  const parts = raw.replace(/^(dr|vet\.? hek|uzm|prof|doç|op)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  const first = parts[0] || "";
  return first.length >= 2 && first.length <= 20 ? first.charAt(0).toLocaleUpperCase("tr-TR") + first.slice(1) : "";
}

export function dayPart(hour = new Date().getHours()) {
  return hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
}

// [kalıp (katlanmış metnin tamamı ya da başı), yanıt üretici(ad, saat)]
const TOPICS = [
  [/^(merhaba|merhabalar|selam|selamlar|slm|mrb|hey|hi|hello|selamun aleykum|sa|as|aleykum selam|iyi gunler|gunaydin|iyi aksamlar|tunaydin)$/, (n, h) => pick([
    `${dayPart(h)}${n ? " " + n : ""}! Size nasıl yardımcı olabilirim?`,
    `Merhaba${n ? " " + n : ""}, hoş geldiniz. Bugün neye bakalım: bir hasta, bir ilaç dozu ya da kliniğin günlük durumu mu?`,
    `${dayPart(h)}${n ? " " + n : ""}! Hazırım; hasta, ilaç, belirti ya da kliniğinizle ilgili ne isterseniz sorabilirsiniz.`])],
  [/^(nasilsin|naber|ne haber|nasil gidiyor|iyi misin|keyifler nasil|napiyorsun|ne yapiyorsun|nasilsiniz|ne var ne yok)\b/, n => pick([
    `Teşekkür ederim${n ? " " + n : ""}, gayet iyiyim ve çalışmaya hazırım. Siz nasılsınız, klinikte yoğun bir gün mü?`,
    `İyiyim, sorduğunuz için teşekkürler${n ? " " + n : ""}! Kayıtlarınız elimin altında. Size nasıl yardımcı olabilirim?`,
    `Her zamanki gibi buradayım${n ? " " + n : ""}. Sizin gününüz nasıl geçiyor?`])],
  [/^(iyiyim|ben de iyiyim|cok iyiyim|fena degil|idare eder|sukur|iyi sayilir|super|harika|mukemmel)\b/, n => pick([
    `Buna sevindim${n ? " " + n : ""}! Bugün size nasıl yardımcı olabilirim?`, `Ne güzel! Hasta, ilaç ya da klinik verisi… ne lazımsa buradayım.`])],
  [/^(yorgunum|cok yorgunum|yoruldum|bittim|cok yogunum|yogunuz|cok yogun|stresliyim|stres|bunaldim|sikildim)\b/, n => pick([
    `Kolay gelsin${n ? " " + n : ""}. Hekimlik yorucu bir iş; kısa bir mola ve bir bardak su iyi gelebilir. İsterseniz günün özetini çıkarayım, işleri birlikte toparlayalım.`,
    `Anlıyorum${n ? " " + n : ""}, yoğun günler zor geçiyor. Yükünüzü hafifletmek için buradayım: “günün özeti”, “yarınki randevular” ya da “geciken aşılar” diyebilirsiniz.`])],
  [/^(tesekkur\w*|tesekkurler|sag ol\w*|sagol\w*|eyvallah|cok sag ol|thanks|thank you|mersi|eline saglik|harikasin|cok yardimci oldun|super oldu|aferin)\b/, n => pick([
    `Rica ederim${n ? " " + n : ""}! Başka bir şey olursa buradayım.`, `Ne demek${n ? " " + n : ""}, her zaman. Kolay gelsin!`, `Yardımcı olabildiysem ne mutlu bana. Başka sorunuz var mı?`])],
  [/^(kolay gelsin|hayirli isler|bereketli olsun|rast gelsin|hayirli gunler)\b/, n => pick([`Sağ olun${n ? " " + n : ""}, size de kolay gelsin!`, `Teşekkürler${n ? " " + n : ""}! Sizin için ne yapabilirim?`])],
  [/^(gorusuruz|hoscakal|hosca kal|bay bay|bye|iyi geceler|iyi calismalar|kendine iyi bak|sonra gorusuruz|allaha emanet)\b/, (n, h) => pick([
    `Görüşmek üzere${n ? " " + n : ""}! ${h >= 18 ? "İyi akşamlar, iyi dinlenmeler." : "İyi çalışmalar."}`, `Hoşça kalın${n ? " " + n : ""}. İhtiyacınız olunca buradayım.`])],
  [/^(kimsin|sen kimsin|adin ne|ismin ne|kendini tanit|neysin|robot musun|yapay zeka misin|bot musun|insan misin)\b/, n => `Ben VeBot, VetZimo'nun klinik asistanıyım${n ? ", " + n : ""}. Tamamen cihazınızda çalışırım; internete veya ücretli bir servise soru göndermem. Kliniğinizin kayıtlarını özetleyebilir, kedi-köpek ve egzotik hayvan hastalıkları, belirtiler, ilaç dozları, zehirlenmeler ve laboratuvar değerleri hakkında bilgi verebilirim. Bilgi tabanımla çalışan bir yardımcıyım; kesin tanı ve tedavi kararı her zaman hekimindir.`],
  [/^(beni taniyor musun|ben kimim|adimi biliyor musun|adim ne)\b/, n => n ? `Elbette, siz ${n}! Size ${n} diye hitap ediyorum; farklı bir ad isterseniz “Adım …” yazmanız yeterli.` : `Hesabınızda kişi adı göremedim (yalnız klinik adı kayıtlı). “Adım Ayşe” gibi yazarsanız bundan sonra size adınızla hitap ederim.`],
  [/^(seni kim yapti|kim yapti|yapimcin kim|nereden geldin)\b/, () => `Beni VetZimo ekibi, veteriner klinikleri için geliştirdi. Bilgilerim veteriner hekimlik başvuru kaynaklarına dayanır ve düzenli güncellemelerle genişler.`],
  [/^(kac yasindasin|yasin kac|evli misin|sevgilin var mi|ne yersin|uyur musun)\b/, () => pick([`Benim yaşım yok ama her güncellemeyle biraz daha deneyim kazanıyorum 🙂 Size nasıl yardımcı olabilirim?`, `Ben bir yazılımım; yemek yemem ve uyumam ama kliniğiniz için 7/24 hazırım!`])],
  [/^(saka yap|fikra anlat|espri yap|guldur beni|bir saka|komik bir sey)\b/, () => pick([
    "Kedi neden bilgisayarın başından kalkmaz? Çünkü fareyi bırakamaz! 🐱🖱️",
    "Köpek veterinere ne demiş? “Doktor bey, son zamanlarda kendimi biraz… havlak hissediyorum.” 🐶",
    "Papağan muayenede neden sessizmiş? Çünkü avukatı gelmeden konuşmuyormuş! 🦜",
    "Kaplumbağa neden aceleyle randevu almış? Kontrolü “yavaş yavaş” geciktirmek istememiş! 🐢"])],
  [/^(saat kac|saat ne|bugun gunlerden ne|bugun ne|tarih ne|bugunun tarihi|hangi gundeyiz)\b/, () => {
    const d = new Date();
    return `Bugün ${d.toLocaleDateString("tr-TR", {weekday: "long", day: "numeric", month: "long", year: "numeric"})}, saat ${d.toLocaleTimeString("tr-TR", {hour: "2-digit", minute: "2-digit"})}.`; }],
  [/^(hava nasil|hava durumu|yagmur yagacak mi|bugun hava)\b/, () => `Güncel hava durumunu Genel Bakış ekranındaki hava kartında görebilirsiniz (konum izniyle). Sıcak havalarda brakisefal ırklar ve şinşillalar için sıcak çarpması riskini hatırlatırım!`],
  [/^(tamam|peki|anladim|olur|tamamdir|ok|okay|evet|aynen|hmm|hm)$/, n => pick([`Tamam${n ? " " + n : ""}. Başka bir konuda yardımcı olabilir miyim?`, `Anlaştık! Bir sonraki sorunuzu bekliyorum.`])],
  [/^(hayir|yok|gerek yok|istemiyorum|vazgec)$/, n => `Peki${n ? " " + n : ""}. İhtiyacınız olursa buradayım.`],
  [/^(ozur dilerim|pardon|kusura bakma|yanlis yazdim)\b/, () => `Hiç sorun değil! Sorunuzu yeniden yazabilirsiniz.`],
  [/^(seni seviyorum|cok tatlisin|harika bir botsun|en iyisisin)\b/, n => `Çok naziksiniz${n ? " " + n : ""}, teşekkür ederim! Sizinle çalışmak benim için de keyif 😊`],
  [/^(bayraminiz kutlu olsun|iyi bayramlar|bayramin kutlu|hayirli kandiller|iyi yillar|mutlu yillar|yeni yiliniz kutlu)\b/, n => `Teşekkür ederim${n ? " " + n : ""}, sizin de! Sevdiklerinizle sağlıklı ve mutlu günler dilerim.`],
  [/^(cay|kahve|mola|acim|acktim|yemek yiyecegim)\b/, n => pick([`Afiyet olsun${n ? " " + n : ""}! Mola sonrası günün özetini hazırlayabilirim.`, `Kısa bir mola herkese iyi gelir. Döndüğünüzde buradayım ☕`])],
  [/^(motivasyon|moralim bozuk|uzgunum|kotu bir gun|zor bir gun|hasta kaybettik|hastayi kaybettik)\b/, n => `Çok üzüldüm${n ? " " + n : ""}. Bu meslekte bazı günler gerçekten ağır geçiyor; elinizden gelenin en iyisini yaptığınızı unutmayın. Her gün nice canlının hayatına dokunuyorsunuz. Kendinize de iyi bakın 💜`],
];

/**
 * Günlük sohbet yanıtı ya da null.
 * Sağlık/klinik içeriği olan mesajlar burada yakalanmaz (yalnız selamı içeren "merhaba, kedim kusuyor" gibi mesajlar
 * için `stripGreeting` ile selam ayıklanır ve asıl soru diğer modüllere gider).
 */
export function chatAnswer(text, {name = "", hour = new Date().getHours()} = {}) {
  const t = fold(text);
  if (!t || t.split(" ").length > 9) return null;
  for (const [re, fn] of TOPICS) if (re.test(t)) return {text: fn(firstName(name), hour)};
  return null;
}

/** "Merhaba VeBot, kedim kusuyor" → "kedim kusuyor" (baştaki selam ve hitaplar ayıklanır) */
export function stripGreeting(text) {
  const words = String(text ?? "").trim().split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const w = fold(words[i]), next = fold(words[i + 1] || "");
    if (/^(merhaba\w*|selam\w*|slm|mrb|hey|gunaydin|hocam|vebot|tunaydin)$/.test(w)) { i++; continue; }
    if ((w === "iyi" && /^(gunler|aksamlar|calismalar)$/.test(next)) || (w === "kolay" && next === "gelsin") || (w === "doktor" && /^(bey|hanim)$/.test(next))) { i += 2; continue; }
    break;
  }
  return words.slice(i).join(" ").replace(/^[,.!\s]+/, "");
}

// Sağlık sorusu niyeti (belirti dışında genel ifadeler)
export const HEALTH = /\b(hasta(land\w*|lik\w*|m|si|yim)?|iyi degil|keyifsiz|bir sorun|bir terslik|rahatsiz\w*|tuhaf davran\w*|garip davran\w*|ne yapmaliyim|ne yapayim|ne yapabilirim|yardim edin|acil|kotu gorunuyor|sorunu var|bir seyi var|tedavi|teshis|tani)\b/;
