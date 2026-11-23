import {normalizeClinicalSpeech} from "./voice-terms.js?v=20261121-r51";

export const voiceText = value => String(value ?? "").toLocaleLowerCase("tr-TR")
  .normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ı", "i")
  .replace(/[^a-z0-9]+/g, " ").trim();

const has = (text, fragment) => (" " + text + " ").includes(" " + fragment + " ");
const labKinds = ["hemogram","biyokimya","kan gazi","idrar tahlili","rontgen","ultrason","mr","tomografi","ekg"];
const labKind = text => labKinds.find(kind => {
  const stem={"idrar tahlili":"idrar tahlil","kan gazi":"kan gaz"}[kind] ?? kind;
  return new RegExp("\\b"+stem+"(?:ini|sini|unu|unun|u|i|si|in|nin|ina|una|na)?\\b").test(text);
});
export const newest = list => [...list].sort((a,b) =>
  String(b.date || "").localeCompare(String(a.date || "")) || String(b.time || "").localeCompare(String(a.time || "")));

const endings = ["","in","un","nin","nun","i","u","yi","yu","a","e","ya","ye","ta","te","da","de","taki","teki","daki","deki","tan","ten","dan","den"];

function patientAliases(text, patients, owners) {
  const misheard=/\b(rechal|richal|rhal)(in|un|i|u|a|e)?\b/g;
  if (!patients.some(row=>voiceText(row.name)==="recel")) return text;
  const protectedNames=[...patients,...owners].map(row=>voiceText(row.name));
  return text.replace(misheard,(word,alias,suffix)=>
    protectedNames.some(name=>has(name,alias) || has(name,word)) ? word : "recel"+(suffix ?? ""));
}

function nameKey(text) {
  return text.replace(/\b(?:in|un|nin|nun|i|u|yi|yu|a|e|ya|ye|ta|te|da|de|taki|teki|daki|deki|tan|ten|dan|den)\b/g," ").replace(/\s+/g," ").trim();
}

function closeName(input, candidate) {
  if (candidate.length<4 || Math.abs(input.length-candidate.length)>1) return false;
  let i=0,j=0,mismatch=0;
  while (i<input.length && j<candidate.length) {
    if (input[i]===candidate[j]) { i++;j++;continue; }
    if (++mismatch>1) return false;
    if (input.length>=candidate.length) i++;
    if (input.length<=candidate.length) j++;
  }
  return mismatch+input.length-i+candidate.length-j===1;
}

function heardOwnerName(words, owner) {
  const parts=owner.split(" ");
  if (parts.length<2 || !words.includes(parts.at(-1))) return false;
  const first=parts[0];
  return words.some((word,index)=>{
    if (word===first || closeName(word,first)) return true;
    const joined=word+(words[index+1] ?? "");
    return joined===first || closeName(joined,first);
  });
}

function nameSuggestions(query, options) {
  const words=query.split(" ");
  if (words.length>10) return [];
  const scored=[];
  for (const {patient,name,owner,labels} of options) {
    const heardPatient=name.length>=3 && endings.some(suffix=>has(query,name+suffix));
    const heardOwner=owner && heardOwnerName(words,owner);
    const similar=[name,...labels].some(label=>closeName(query,label));
    const score=(heardPatient ? 4 : 0)+(heardOwner ? 3 : 0)+(similar ? 5 : 0);
    if (score) scored.push({patient,score});
  }
  if (!scored.length) return [];
  const best=Math.max(...scored.map(row=>row.score));
  return scored.filter(row=>row.score===best).slice(0,12).map(row=>row.patient);
}

function byNames(spoken,patients,owners,type) {
  if (!spoken) return null;
  const exactQuery=nameKey(spoken);
  const indexed=new Map(owners.map(owner=>[owner.id,voiceText(owner.name)]));
  const exact=(phrase,name)=>name && endings.some(suffix=>name+suffix===phrase);
  const options=patients.map(patient=>{
    const name=voiceText(patient.name);
    const owner=indexed.get(patient.owner);
    return {patient,name,owner,labels:owner ? [owner+" "+name,name+" "+owner] : []};
  });
  const corrected=patientAliases(exactQuery,patients,owners);
  for (const query of new Set([exactQuery,corrected])) {
    const joined=options.filter(({name,owner})=>owner && endings.some(suffix=>
      exact(query,owner+suffix+" "+name) || exact(query,name+suffix+" "+owner)));
    if (joined.length) return {type,patients:joined.map(({patient})=>patient),openRequested:true,showOwner:true};
    const matching=options.filter(({patient,name})=>exact(query,name) || /^\d{15}$/.test(query) && voiceText(patient.chip)===query);
    const customers=type==="patient" && query===exactQuery ? owners.filter(owner=>exact(query,voiceText(owner.name))) : [];
    if (matching.length || customers.length) return {
      type,patients:matching.map(({patient})=>patient),owners:customers,openRequested:true,showOwner:query!==exactQuery,
    };
  }
  const similar=nameSuggestions(spoken,options);
  if (similar.length) return {type,patients:similar,requiresChoice:true,openRequested:true,showOwner:true};
  return null;
}

function commandWords(raw) {
  return voiceText(normalizeClinicalSpeech(raw))
    .replace(/\brandev u(\w*)\b/g,"randevu$1")
    .replace(/\b(bugun|yarin) ku?i?\b/g,(_,day)=>day==="bugun" ? "bugunku" : "yarinki");
}

export function voiceNavigation(raw, sections) {
  const phrase=commandWords(raw)
    .replace(/^(?:lutfen |beni |bana |vetnet |vet net )+/,"")
    .replace(/ (?:acar misin|gosterir misin|acabilir misin|gidebilir miyiz|gotur|ac|acin|goster|git|gec|getir|goruntule|ekle)(?: lutfen)?$/,"")
    .replace(/ (?:sayfa(?:si|sini|sina)?|bolum(?:u|unu|une)?|ekran(?:i|ini|ina)?)$/,"");
  if (!phrase) return [];
  const suffixes=["","i","u","a","e","yi","yu","ya","ye","ni","nu","na","ne","ini","unu","ina","una","sini","suna","leri","lari"];
  const exact=sections.filter(section=>voiceText(section.label)===phrase);
  const candidates=exact.length ? exact : sections.filter(section=>{
    const label=voiceText(section.label);
    return phrase.startsWith(label) && suffixes.includes(phrase.slice(label.length));
  });
  return [...new Map(candidates.map(section=>[section.id,section])).values()];
}

export function voiceIntent(raw, patients, context, owners=[]) {
  const text = commandWords(raw);
  const datedAgenda=/^(?:lutfen )?(bugun(?:ku)?|yarin(?:ki)?) (?:(?:ku|ko) ?)?r[ae]ndevul{1,2}(?:ar|ari|arina) (?:ac|goster|getir|listele)(?: lutfen)?$/.exec(text);
  if (datedAgenda) return {type:"agenda",day:datedAgenda[1].startsWith("yarin") ? 1 : 0,control:false};
  if (!text || /\b(?:yapma|acma|gosterme|sil|silin|gonder|gonderin|degistir|onayla|iade|transfer|aktar|iptal)\b/.test(text)) return {type:"unknown"};
  const examCreate=/\b(?:muayene\w*|soap)\s+(?:olustur\w*|baslat\w*)\b/;
  const requestsDraft = examCreate.test(text) || /\b(?:muayene|soap)\w*\b.*\btaslag\w*\b/.test(text);
  if (examCreate.test(text)) {
    const spoken=text.replace(examCreate," ").replace(/\b(?:icin|yeni|lutfen|musun|misin)\b/g," ").replace(/\s+/g," ").trim();
    const match=byNames(spoken,patients,owners,"examDraft");
    if (match) {
      const selected=match.patients.find(row=>row.id===context?.patient);
      return selected && !match.requiresChoice && !match.showOwner ? {...match,patients:[selected]} : match;
    }
    if (!spoken || /^(?:bu|secili) hasta\w*$/.test(spoken)) {
      return {type:"examDraft",patients:patients.filter(row=>row.id===context?.patient)};
    }
    return {type:"examDraft",patients:[]};
  }
  if (!requestsDraft && /\b(?:ekle|kaydet|olustur|tasi)\b/.test(text)) return {type:"unknown"};
  if (/^(?:bugun\w*|yarin\w*)\b.*\b(?:randevu\w*|kontrol\w*)/.test(text) ||
      /^(?:randevu\w*|kontrol\w*)\b.*\b(?:bugun|yarin)\b/.test(text)) {
    return {type:"agenda", day:/\byarin/.test(text) ? 1 : 0, control:text.includes("kontrol")};
  }
  if (/^(?:kritik stok|stok uyarilari)/.test(text)) return {type:"criticalStock"};
  const stock = raw.trim().match(/^(?:stokta\s+kaç\s+adet|stok\s+ara)\s+(.+?)(?:\s+var)?[?.!]*$/iu);
  if (stock) return {type:"stock", product:voiceText(stock[1])};
  if (/^(?:bugunku tahsilat\w*|bugunku toplam tahsilat\w*|bugun toplam tahsilat\w*)\b/.test(text)) return {type:"collections"};
  if (/^(?:yogun bakim|yatan hastalar|aktif konaklama)\b/.test(text)) return {type:"stays"};

  const kind = labKind(text);
  const implicitLab = /^(?:oncekiyle|onceki sonuc\w*|yukselen deger\w*|dus[eu]n deger\w*)\b/.test(text);
  const compare = /\bkarsilastir\w*\b/.test(text) || implicitLab;
  let type;
  const bloodExact=/\bkan\s+(?:sonuc|deger|test|tahlil)\w*\b/.test(text);
  const heardBlood=text.match(/\bkan\s*([a-z]{5})(?:lar\w*|un\w*|u|i)?\b/)?.[1];
  const uncertainBlood=!bloodExact && Boolean(heardBlood && (heardBlood==="sonuc" || closeName(heardBlood,"sonuc")));
  const bloodQuery=bloodExact || uncertainBlood;
  const measurement=/\b(?:deger|sonuc|parametre)\w*\b/.test(text);
  const analytes=measurement ? [
    ["alt","a el te"],["ast","a es te"],["ggt","ge ge te"],["alp","a el pe"],
    ["kreatin"],["kreatinin"],["ure"],["hematokrit","hct"],["glukoz","glikoz"],
  ].filter(terms=>terms.some(term=>has(text,term))) : [];
  if (kind || implicitLab || bloodQuery || analytes.length || /\b(?:tetkik|laboratuvar|tahlil)\w*\b/.test(text)) type = compare ? "compare" : "labs";
  else if (requestsDraft) type = "examDraft";
  else if (/\b(?:son|onceki)\s+muayene\w*\b/.test(text)) type = "exam";
  else if (/\b(?:randevu|randevular)\w*\b/.test(text)) type = "patientAgenda";
  else if (/\b(?:recete|ilac)\w*\b/.test(text) && /\b(?:son|mevcut)\b/.test(text)) type = "prescriptions";
  else if (/\b(?:dosya|hasta|hasta[nm])\w*\b.*\b(?:ac|acar|acin|bul|goster|gosterir)\b/.test(text)) type = "patient";
  if (!type || type==="patient") {
    const spoken=text.replace(/\s+(?:dosya\w*|hasta\w*|sahibi|kart\w*|profil\w*|isimli|adli|numarali|kedinin|kopegin|ac|acar|acin|goster|gosterir|bul|misin|musun|lutfen)(?=\s|$)/g," ").replace(/\s+/g," ").trim();
    const direct=byNames(spoken,patients,owners,"patient");
    if (direct) return direct;
    if (!type) return {type:"unknown"};
  }

  if (type==="patient" && !/^(?:bu|ayni|secili) hasta/.test(text)) return {type,patients:[]};
  const dateWord=type==="labs" ? text.match(/\b(bugun|dun|yarin)(?:ku|ki)?\b/)?.[1] : undefined;
  const unsupportedDate=type==="labs" && /\b(?:gecen|onceki|sonraki|arasi|tarihinde|tarihli)\b/.test(text);
  if (unsupportedDate) return {type:"clarifyDate"};

  const findNamed = phrase => patients.filter(row => {
    const name = voiceText(row.name);
    const chip = voiceText(row.chip);
    const exactName = name && endings.some(suffix=>has(phrase,name+suffix));
    return Boolean(exactName || (chip && /^\d{15}$/.test(chip) && has(phrase,chip)));
  });
  const exactNames=findNamed(text);
  const corrected=exactNames.length ? text : patientAliases(text,patients,owners);
  const named=corrected===text ? exactNames : findNamed(corrected);
  const implicit = implicitLab || /^(?:(?:bu|ayni|secili) hasta\w*|son muayene\w*|(?:yeni )?(?:muayene|soap) taslag\w*)\b/.test(text);
  const contextual = implicit && patients.find(row => row.id === context?.patient);
  const tokens=text.split(" ");
  const possibleNames=!named.length && !contextual && ["labs","examDraft","exam","prescriptions"].includes(type)
    ? patients.filter(row=>{
      const name=voiceText(row.name);
      if (name.length<4) return false;
      const last=name.at(-1);
      const softened={p:"b",c:"c",t:"d",k:"g"}[last];
      const inflected=softened ? name.slice(0,-1)+softened : "";
      return tokens.some((word,index)=>endings.some(suffix=>
        (word.length>=2 && (tokens[index+1]?.length ?? 0)>=2 && word+tokens[index+1]===name+suffix) ||
        (inflected && /^[iuae]/.test(suffix) && word===inflected+suffix)));

    }).slice(0,12) : [];
  return {type, requiresChoice:uncertainBlood || Boolean(possibleNames.length), openRequested:/\b(?:ac|acar|acin|getir)\b/.test(text), bloodQuery, analytes, dateWord, kind:kind || (implicit ? context?.kind : ""), filter:has(text,"yukselen degerleri")?"up":has(text,"dusen degerleri")?"down":"",
    patients:named.length ? named : contextual ? [contextual] : possibleNames};
}

export const soapSections = {
  anamnez:"complaint", sikayet:"complaint", semptomlar:"symptoms", bulgular:"findings",
  degerlendirme:"assessment", "ayirici tanilar":"assessment", tetkik:"tests", "tetkik plani":"tests",
  plan:"plan", "tedavi plani":"plan", "kontrol onerileri":"plan",
};

const ones=["sifir","bir","iki","uc","dort","bes","alti","yedi","sekiz","dokuz"];
const tens=["","on","yirmi","otuz","kirk","elli","altmis","yetmis","seksen","doksan"];

export function spokenNumber(raw) {
  if (/^\d{1,3}(?:[.,]\d{1,3})?$/.test(raw)) return raw.replace(",",".");
  const [whole,fraction,extra]=voiceText(raw).split(/ (?:virgul|nokta) /);
  function integer(text) {
    const parts=text.split(" ");
    let value=0;
    const hundred=parts.indexOf("yuz");
    if (hundred>=0) {
      if (hundred>1 || (hundred===1 && ones.indexOf(parts[0])<1)) return null;
      value=(hundred===0 ? 1 : ones.indexOf(parts[0]))*100;
      parts.splice(0,hundred+1);
    }
    const ten=tens.indexOf(parts[0]);
    if (ten>0) {value+=ten*10;parts.shift();}
    if (parts.length===1 && ones.includes(parts[0])) value+=ones.indexOf(parts.shift());
    return parts.length ? null : value;
  }
  const value=/^\d{1,3}$/.test(whole) ? Number(whole) : integer(whole);
  if (extra || value===null) return null;
  if (fraction===undefined) return String(value);
  if (/^\d{1,3}$/.test(fraction)) return value+"."+fraction;
  const digits=fraction.split(" ").map(word=>ones.indexOf(word));
  if (digits.length<=3 && digits.every(digit=>digit>=0)) return value+"."+digits.join("");
  const decimal=integer(fraction);
  return decimal===null ? null : value+"."+decimal;
}

export function splitExamDictation(raw, currentField="complaint") {
  const fields = {};
  let key = currentField;
  for (const part of raw.trim().slice(0,6000).split(/\n+|(?<=[.!?])\s+(?=\D)/u)) {
    const marker = part.match(/^(.{1,30}?)(?:\s*:\s*|\s+)(.+)$/u);
    const label = Object.keys(soapSections).sort((a,b)=>b.length-a.length).find(section =>
      marker && (voiceText(marker[1]) === section || voiceText(part).startsWith(section+" ")));
    let content = part.trim();
    if (label) {
      key = soapSections[label];
      if (voiceText(marker[1]) === label) content = marker[2].trim();
      else {
        const words = label.split(" ").length;
        content = content.replace(new RegExp("^(?:\\S+\\s+){"+words+"}"),"").trim();
      }
    }
    const measurement=content.match(/^(kilo(?:su)?|ağırlık|ateş(?:i)?|(?:vücut )?sıcaklığ[ıi]|nab[ıi]z|nabz[ıi]|solunum(?: sayısı)?)\s*:?\s*([^.!?]+?(?:[.,]\d+)?)\s*(?:\b(?:kg|kilo(?:gram)?|derece|atım|nefes))?[.!]?$/iu);
    if (measurement) {
      const name=voiceText(measurement[1]);
      const metric=/^(?:kilo|agirlik)/.test(name) ? "weight" : /^(?:ates|vucut|sicak)/.test(name) ? "temperature" : /^nab/.test(name) ? "pulse" : "respiratory";
      const value=spokenNumber(measurement[2].trim());
      const decimal=value?.split(".")[1]?.length ?? 0;
      if (Number(value)>0 && (metric==="weight" || decimal<=(metric==="temperature" ? 1 : 0))) {
        fields[metric]=value;
        continue;
      }
    }
    if (content) fields[key] = [fields[key],content].filter(Boolean).join("\n");
  }
  return {fields,currentField:key};
}

export const soapFromDictation = raw => splitExamDictation(raw).fields;
