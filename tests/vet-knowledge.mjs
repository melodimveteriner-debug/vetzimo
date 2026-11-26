// Hekim başvuru bilgisi: doz hesabı, türe özgü uyarılar, aşı, referans, zehirlenme hesapları, ayırıcı tanı, sıvı/enerji.
import {vetAnswer} from "../public/vet-knowledge.js";
import {clinicalAnswer} from "../public/vet-clinical.js";
import {suggestCases, extractSymptoms} from "../public/vet-symptoms.js";
let fails = 0;
const ok = (cond, name, extra) => { if (!cond) { fails++; console.error("KALDI", name, extra ? JSON.stringify(extra) : ""); } };
const stat = (a, label) => (a?.stats || []).find(([k]) => k.includes(label))?.[1] || "";
const items = a => (a?.items || []).map(([k, v]) => k + " " + v).join(" | ");

let a = vetAnswer("4 kg kedi meloksikam dozu");
ok(a && stat(a, "Kedi doz aralığı") === "0,05–0,1 mg/kg", "meloksikam kedi aralığı", a);
ok(stat(a, "4 kg toplam") === "0,2–0,4 mg", "meloksikam toplam", a);
ok(items(a).includes("Metacam kedi oral 0,5 mg/mL 0,4–0,8 mL") && !items(a).includes("köpek oral"), "kedi ürün hacmi, köpek ürünü yok", a);

a = vetAnswer("kedi karprofen dozu");
ok(stat(a, "Kedi") === "Kedide kullanılmaz", "karprofen kedide kullanılmaz", a);

a = vetAnswer("10 kg köpek amoksisilin klavulanik 50 mg tablet");
ok(stat(a, "10 kg toplam") === "125–250 mg" && stat(a, "Tablet (50 mg)") === "2,5–5 tablet", "tablet hesabı", a);

a = vetAnswer("kedi enrofloksasin");
ok(items(a).includes("retina"), "enrofloksasin kedi retina uyarısı", a);

a = vetAnswer("collie ivermektin dozu");
ok(items(a).includes("MDR1"), "ivermektin MDR1 uyarısı", a);

a = vetAnswer("Pamuk meloksikam dozu", {species: "dog", weight: "12", name: "Pamuk"});
ok(a.text.startsWith("Pamuk · Meloksikam · 12 kg") && stat(a, "12 kg toplam") === "1,2–2,4 mg", "hasta kaydından tür ve kilo", a);

a = vetAnswer("kedi aşı takvimi");
ok(a && a.text.includes("Kedi aşı takvimi") && items(a).includes("Kuduz"), "kedi aşı takvimi", a);

a = vetAnswer("köpek normal nabız ve ateş kaç olmalı");
ok(stat(a, "Vücut sıcaklığı") === "37,5–39,2 °C", "köpek normal değer", a);

a = vetAnswer("kedi ALT referans aralığı");
ok(items(a).includes("Kedi: 12–130 U/L"), "kedi ALT", a);

a = vetAnswer("20 kg köpek 100 g bitter çikolata yedi");
ok(stat(a, "Teobromin") === "27,5 mg/kg" && stat(a, "Değerlendirme").startsWith("Hafif"), "çikolata hesabı", a);

a = vetAnswer("10 kg köpek 2 g ksilitol yedi");
ok(stat(a, "Değerlendirme").startsWith("Hipoglisemi"), "ksilitol hesabı", a);

a = vetAnswer("kusma ayırıcı tanı");
ok(items(a).includes("Pankreatit") && stat(a, "Önerilen tetkikler").includes("lipaz"), "kusma ayırıcı tanı", a);

a = vetAnswer("5 kg kedi %8 dehidrasyon sıvı tedavisi");
ok(stat(a, "İdame").startsWith("267 mL/gün") && stat(a, "Dehidrasyon açığı").startsWith("400 mL"), "sıvı hesabı", a);

a = vetAnswer("10 kg köpek kalori ihtiyacı");
ok(stat(a, "RER") === "394 kcal/gün", "RER", a);

a = vetAnswer("kedi gebelik süresi 1.11.2026");
ok(items(a).includes("tahmini doğum 05.01.2027"), "gebelik tarihi", a);

ok(vetAnswer("bugünkü ciro ne kadar") === null, "klinik veri sorusu başvuru bilgisine düşmez");
ok(vetAnswer("yarınki randevular") === null, "randevu sorusu başvuru bilgisine düşmez");

// Belirti → olası hastalık (birden çok belirti, tür, grup ipucu) ve yazım hatası önerisi
const names = a => (a?.items || []).map(([k]) => k);
let c = clinicalAnswer("köpekte öksürük, ateş, burun akıntısı");
ok(c && c.text.startsWith("Bu belirtiler") && names(c).slice(0, 3).some(n => n.includes("distemper")), "çoklu belirti: distemper ilk üçte", names(c));
c = clinicalAnswer("erkek kedi idrar yapamıyor, kusma");
ok(names(c)[0]?.startsWith("Üretral tıkanıklık"), "erkek kedi idrar yapamıyor → üretral tıkanıklık", names(c));
c = clinicalAnswer("büyük ırk köpek karnı şişti kusmaya çalışıyor salya");
ok(names(c)[0]?.includes("GDV"), "GDV ilk sırada", names(c));
c = clinicalAnswer("kanlı ishal köpek yavru");
ok(names(c).slice(0, 2).some(n => n.startsWith("Parvovirüs")), "yavru + kanlı ishal → parvovirüs ilk ikide", names(c));
c = clinicalAnswer("köpekte bel ağrısı ateş");
ok(names(c).slice(0, 3).some(n => n.startsWith("Diskospondilit")), "bel ağrısı + ateş → diskospondilit", names(c));
ok(!names(clinicalAnswer("kedide kusma ishal") || {}).some(n => /parvovir|distemper/i.test(n) && !/panl/i.test(n)), "kedi sorusunda köpeğe özgü hastalık yok");
ok(extractSymptoms("ishal yok, kusma var").join() === "Kusma", "olumsuz belirti sayılmaz");
ok(suggestCases("parvovros tedavsi")[0] === "Parvovirüs enteriti" && suggestCases("qwerty asdf").length === 0, "yazım hatası önerisi");
ok(clinicalAnswer("bugünkü ciro") === null && clinicalAnswer("kritik stok") === null, "klinik veri sorusu belirti motoruna düşmez");

if (fails) { console.error(fails + " test kaldı"); process.exit(1); }
console.log("PASS hekim başvuru bilgisi: doz ve ürün hacmi, türe özgü uyarılar, aşı, referans, zehirlenme, ayırıcı tanı, sıvı/enerji, gebelik");
