const aliases={
  WBC:"WBC",RBC:"RBC",HGB:"HGB",HCT:"HCT",PLT:"PLT",MCV:"MCV",MCH:"MCH",MCHC:"MCHC",
  "RDW-CV":"RDW-CV","RDW-SD":"RDW-SD","RDW%":"RDW-CV",RDWA:"RDW-SD",MPV:"MPV",PDW:"PDW",PCT:"PCT",
  NEU:"NEU",LYM:"LYM",MON:"MON",EOS:"EOS",BAS:"BAS",
  GLU:"GLU",ALB:"ALB",TP:"TP",GLOB:"GLOB",ALP:"ALP",ALT:"ALT",GPT:"ALT",AST:"AST",GOT:"AST",
  GGT:"GGT",BUN:"BUN",CRE:"CRE",CREA:"CRE",TBIL:"TBIL",IBIL:"TBIL",CA:"Ca",IP:"P",P:"P",
  NA:"Na",K:"K",CL:"Cl","ALB/GLOB":"A/G","BUN/CRE":"BUN/CRE",
  GLUCOSE:"GLU",UREA:"UREA",SDMA:"SDMA",DBIL:"DBIL",CHOL:"CHOL",TG:"TG",TRIG:"TG",AMY:"AMY",AMYL:"AMY",LIP:"LIP",LIPA:"LIP",CK:"CK",CPK:"CK",LDH:"LDH",MG:"Mg",
  FRU:"FRU",NH3:"NH3",CRP:"CRP",T4:"T4",TT4:"T4",RETIC:"RETIC",GRAN:"NEU",LYMPH:"LYM",MONO:"MON",
  PH:"pH",PCO2:"pCO2",PO2:"pO2",HCO3:"HCO3","HCO3-":"HCO3",CHCO3:"HCO3",TCO2:"TCO2",BE:"BE","BE(B)":"BE","BE(ECF)":"BE",BEECF:"BE",BEB:"BE",
  LAC:"LAC",LACT:"LAC",ICA:"iCa","CA++":"iCa",AG:"AG",SO2:"sO2",
};
const differential=new Set(["NEU","LYM","MON","EOS","BAS"]);
const markers=/^(?:HIGH|LOW|YÜKSEK|DÜŞÜK|[HLYD#*↑↓])(?=\s|[<=>]|$)/iu;
const codes=Object.keys(aliases).sort((a,b)=>b.length-a.length).map(code=>code.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&")).join("|");
const analyte=new RegExp(`(?<![\\p{L}\\d/])(${codes})(?:\\s*([#%]))?(?:\\s*[-=]\\s*PS)?(?![\\p{L}\\d/])`,"giu");
const resultNumber="[+-]?\\d+(?:[.,]\\s*\\d+)?";
const resultPattern=new RegExp(`^([<=>≤≥])?\\s*(${resultNumber})(?![\\d.,])`);
const rangePattern=new RegExp(`(?:^|[\\s(\\[])(${resultNumber})\\s*[-–—−:]\\s*(${resultNumber})(?=$|[\\s)\\]])`);
const unitPattern=/^(?:%|(?:[×x]\s*)?10\s*[\^*°⁹¹²A]?\s*(?:12|9|6|3)?\s*\/\s*[a-zµμ1|]+|[a-zµμ]+\s*\/\s*[a-zµμ1|]+|f[lL]|pg|mmHg|kPa)(?=$|\s|\()/i;
const tidy=value=>value.replace(/([.,])\s+(?=\d)/g,"$1").trim();
const n=value=>Number(value.replace(",","."));
const flags={H:"H",HIGH:"H",Y:"H",YÜKSEK:"H","↑":"H",L:"L",LOW:"L",D:"L",DÜŞÜK:"L","↓":"L","#":"#","*":"*"};

function readFragment(fragment) {
  let tail=fragment.tail.trim().replace(/^[:|.]\s*/,"")
    .replace(/^[|.\s\-]+(?=[<=>])/,"").replace(/^[^\d<=>HL#*↑↓]+(?=[<=>]\s*\d)/,"");
  let mark=tail.match(markers)?.[0];
  if(mark) tail=tail.slice(mark.length).trim();
  const result=tail.match(resultPattern);
  if(!result) {
    if(!mark && !/\d/.test(tail)) return null;
    return {...fragment,value:"",operator:"",unit:"",min:"",max:"",mark:flags[mark?.toUpperCase()]||""};
  }
  tail=tail.slice(result[0].length).trim();
  const after=tail.match(markers)?.[0];
  if(after && !mark) mark=after;
  if(after) tail=tail.slice(after.length).trim();
  tail=tail.replace(/^[|.,;'"]+\s*/,"").replace(/^[^\w%µμ(\[]+\s*/,"");
  const value=tidy(result[2]);
  const operator=result[1]==="="? "":result[1]||"";
  const range=tail.match(rangePattern);
  const [min,max]=range ? [tidy(range[1]),tidy(range[2])] : ["",""];
  const unit=(tail.match(unitPattern)?.[0]||"").replace(/\s/g,"").replace(/\|/g,"l");
  if(!unit && !range && !mark && !operator && !["A/G","BUN/CRE","GLOB","pH","BE","AG"].includes(fragment.code)) return null;
  const validRange=min!=="" && n(min)<=n(max);
  return {...fragment,value,operator,unit,min:validRange?min:"",max:validRange?max:"",mark:flags[mark?.toUpperCase()]||""};
}

export function readLabReport(text) {
  const chunks=[];
  let pending=null;
  for (const [index,raw] of String(text||"").split(/\r?\n/).entries()) {
    const line=raw.replace(/[⇧⬆▲]/g,"↑").replace(/[⇩⬇▼]/g,"↓").trim();
    if(!line) continue;
    const hits=[...line.matchAll(analyte)].filter(hit=>hit[1].length>1 || /^(?:[<=>]|\d)/.test(line.slice(hit.index+hit[0].length).trim()));
    if(!hits.length) {
      if(pending && index-pending.index<=4 && (/^[<=>≤≥({\[\d]/.test(line) || /^[^\d]{1,6}[<=>]\s*\d/.test(line))) {
        const value=line.replace(/^\{/,"(").replace(/^[^\d<=>]{1,6}(?=[<=>]\s*\d)/,"");
        if (!readFragment(pending)?.value || /^[[(]/.test(value)) pending.tail+=" "+value;
      }
      continue;
    }
    for (const [i,hit] of hits.entries()) {
      const canonical=aliases[hit[1].toUpperCase()];
      const suffix=hit[2]||"";
      const code=differential.has(canonical)?canonical+(suffix==="%"?"%":"#"):canonical;
      const flag=suffix==="#"&&!differential.has(canonical)?"# ":"";
      pending={code,name:flag?hit[0].replace(/#$/,"").trim():hit[0].trim(),index,tail:flag+line.slice(hit.index+hit[0].length,hits[i+1]?.index).trim()};
      chunks.push(pending);
    }
  }
  return chunks.flatMap(chunk=>{
    const row=readFragment(chunk);
    return row?[row]:[];
  });
}

export function mergeLabPasses(texts) {
  const groups=new Map();
  const repeated=new Set();
  for (const text of texts) {
    const pass=new Map();
    for (const row of readLabReport(text)) {
      if(!pass.has(row.code)) pass.set(row.code,row);
      else {
        if (row.value!==pass.get(row.code).value && row.min && pass.get(row.code).min) repeated.add(row.code);
        if (row.unit && row.min && !pass.get(row.code).min) pass.set(row.code,row);
      }
    }
    for (const row of pass.values()) {
      if(!groups.has(row.code)) groups.set(row.code,[]);
      groups.get(row.code).push(row);
    }
  }
  return [...groups.values()].map(rows=>{
    const votes=new Map();
    for (const row of rows) {
      const key=row.value?row.operator+n(row.value):"?";
      votes.set(key,(votes.get(key)||0)+1);
    }
    const ranking=rows.slice().sort((a,b)=>((votes.get(b.operator+n(b.value))||0)-(votes.get(a.operator+n(a.value))||0))*4+
      Number(Boolean(b.min&&b.max))-Number(Boolean(a.min&&a.max)) + Number(Boolean(b.unit))-Number(Boolean(a.unit)));
    const row=ranking[0];
    const count=votes.get(row.operator+n(row.value));
    const sameValue=rows.filter(item=>item.operator+n(item.value)===row.operator+n(row.value));
    const refVotes=new Map();
    for(const item of sameValue.filter(item=>item.min && item.max)){
      const key=n(item.min)+"/"+n(item.max);
      refVotes.set(key,(refVotes.get(key)||0)+1);
    }
    const reference=sameValue.filter(item=>item.min && item.max).sort((a,b)=>refVotes.get(n(b.min)+"/"+n(b.max))-refVotes.get(n(a.min)+"/"+n(a.max)))[0];
    const verify=!row.value || repeated.has(row.code) || count<2 || votes.size>1 || Boolean(row.operator) || !row.unit || !reference ||
      refVotes.size>1 || refVotes.get(n(reference.min)+"/"+n(reference.max))<2 || row.mark==="#";
    return [row.name,row.operator+row.value,row.unit,reference?.min||"",reference?.max||"",row.mark||sameValue.find(item=>item.mark)?.mark||"",row.code,verify?"?":""].join(" | ");
  }).join("\n");
}
