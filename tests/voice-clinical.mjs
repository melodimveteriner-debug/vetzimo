// Sesli klinik dikte: sayı sözcükleri, yaşamsal bulgular, semptomlar, bölümler, dolgu süzme, komut ayırma.
import {parseDictation, splitExamCommand, wordsToNumbers} from "../public/voice-clinical.js";
const now = new Date("2026-11-25T10:00:00+03:00");
let fails = 0;
const eq = (got, want, name) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error("KALDI", name, "\n  beklenen", w, "\n  gelen   ", g); }
};
const f = t => parseDictation(t, now).fields;

eq(wordsToNumbers("kirk bir virgul uc"), "41.3", "ondalık sözcük");
eq(wordsToNumbers("dort bucuk"), "4.5", "buçuk");
eq(wordsToNumbers("yuz yirmi"), "120", "yüzler");
eq(wordsToNumbers("sifir nokta sekiz"), "0.8", "sıfır nokta");
eq(wordsToNumbers("otuz sekiz nokta bes"), "38.5", "nokta");

eq(f("kilo 4 kg ateş 41.3 kusma öksürük"), {weight: "4", temperature: "41.3", symptoms: "Kusma, öksürük"}, "temel örnek");
eq(f("kilosu dört kilo ateşi kırk bir virgül üç nabız yüz yirmi solunum otuz"), {weight: "4", temperature: "41.3", pulse: "120", respiratory: "30"}, "sözcükle sayılar");
eq(f("800 gram ateş 38,5"), {weight: "0.8", temperature: "38.5"}, "gram ve virgül");
eq(f("ateş 413"), {temperature: "41.3"}, "noktasız ateş");
eq(f("4,2 kg 39 derece"), {weight: "4.2", temperature: "39"}, "birimle sayı");
eq(f("ateş 52"), {}, "aralık dışı ateş eklenmez");
eq(parseDictation("ateş 52", now).warnings, ["temperature"], "aralık dışı uyarı");
eq(f("Iı şey kilo 4,5 ateş 39 derece semptomlar kusma ishal yok iştahsızlık tanı gastroenterit tedavi sıvı tedavisi ve antiemetik kontrol 3 gün sonra"),
  {weight: "4.5", temperature: "39", next: "2026-11-28", symptoms: "Kusma, iştahsızlık; yok: ishal", assessment: "Gastroenterit", plan: "Sıvı tedavisi ve antiemetik"}, "tam muayene ve dolgu süzme");
eq(f("2 gündür yemek yemiyor ve halsiz, bulgular mukozalar soluk karın palpasyonda hassasiyet"),
  {symptoms: "İştahsızlık, halsizlik", findings: "Mukozalar soluk karın palpasyonda hassasiyet", complaint: "2 gündür yemek yemiyor ve halsiz"}, "öykü cümlesi şikâyete");
eq(f("kanlı ishal ve kusma var"), {symptoms: "Kanlı ishal, kusma"}, "bileşik semptom");
eq(f("kontrol haftaya"), {next: "2026-12-02"}, "kontrol haftaya");
eq(f("kontrol yarın"), {next: "2026-11-26"}, "kontrol yarın");
eq(f("tamam yaz"), {}, "yalnız dolgu");
eq(f("şikayeti dün akşamdan beri kusuyor"), {complaint: "Dün akşamdan beri kusuyor"}, "şikâyet başlığı");

eq(splitExamCommand("Pamuk için yeni muayene aç kilo 4 kg ateş 41.3 kusma"), {command: "pamuk icin yeni muayene ac", dictation: "kilo 4 kg ateş 41.3 kusma"}, "komut + dikte");
eq(splitExamCommand("yeni muayene ekle Ayşe Yılmaz Pamuk"), {command: "yeni muayene ekle ayse yilmaz pamuk", dictation: ""}, "ad komuttan sonra");
eq(splitExamCommand("son muayeneyi aç Pamuk"), null, "son muayene komut değil");
eq(splitExamCommand("Pamuk muayene başlat kusma öksürük"), {command: "pamuk muayene baslat", dictation: "kusma öksürük"}, "semptomla başlayan dikte");

if (fails) { console.error(fails + " test kaldı"); process.exit(1); }
console.log("PASS sesli klinik dikte: sayılar, yaşamsal bulgular, semptomlar, bölümler, dolgu süzme, komut ayırma");
