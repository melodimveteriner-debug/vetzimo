import {breedNames} from "./breeds.js";

const rows = (module, entries) => entries.map(([term,...alternatives])=>({term,alternatives,module}));

export const voiceTerms = [
  ...rows("Laboratuvar",[
    ["Hemogram","hemo gram"],["Biyokimya","biyo kimya"],["Hematokrit","hemato krit"],
    ["ALT","a el te"],["AST","a es te"],["GGT","ge ge te"],["ALP","a el pe"],
    ["Üre"],["Kreatinin"],["Kreatin"],["Glukoz","glikoz"],["Lökosit"],["Trombosit"],
    ["Eritrosit"],["Ürik asit"],["Kan gazı"],["İdrar tahlili"],
  ]),
  ...rows("Muayene",[
    ["Anamnez"],["Palpasyon"],["Oskültasyon"],["Hidrasyon"],["Dehidrasyon"],
    ["Taşikardi"],["Bradikardi"],["Dispne"],["Abdomen"],["Toraks"],["Trakea"],
    ["Otitis"],["Dermatit"],["Gastroenterit"],["Peritonit"],["Sistit"],["Pankreatit"],
  ]),
  ...rows("Görüntüleme ve operasyon",[
    ["Röntgen"],["Ultrason","ultra son"],["EKG","e ka ge"],["Anestezi"],["Entübasyon"],
    ["Ovariohisterektomi"],["Orşiektomi"],["Kastrasyon"],["Sütür"],["Laparotomi"],
  ]),
  ...rows("Etken madde",[
    ["Amoksisilin"],["Klavulanik asit"],["Meloksikam"],["Maropitant"],
    ["Enrofloksasin"],["Doksisiklin"],["Selamektin"],["Prazikuantel"],
  ]),
  ...Object.entries(breedNames).flatMap(([species,breeds])=>rows(species+" ırkı",breeds.map(value=>value.split("|")))),
];

// Only spacing variants with the same meaning may be applied automatically.
export function normalizeClinicalSpeech(text) {
  return text
    .replace(/\bbiyo\s+kimya(?=\p{L}*\b)/giu,"biyokimya")
    .replace(/\bhemo\s+gram(?=\p{L}*\b)/giu,"hemogram")
    .replace(/\bhemato\s+krit(?=\p{L}*\b)/giu,"hematokrit")
    .replace(/\bultra\s+son(?=\p{L}*\b)/giu,"ultrason");
}
