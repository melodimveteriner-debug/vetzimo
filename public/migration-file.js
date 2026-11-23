import {strFromU8,unzipSync} from "/vendor/fflate.js";
import {migrationNames} from "./migration-model.js";

const localElements=(root,name)=>Array.from(root.getElementsByTagNameNS("*",name));
function xml(bytes) {
  if (!bytes) throw Error("Excel çalışma sayfası okunamadı.");
  const content=strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw Error("Güvenli olmayan Excel XML içeriği.");
  const document=new DOMParser().parseFromString(content,"application/xml");
  if (localElements(document,"parsererror").length) throw Error("Excel çalışma sayfası bozuk.");
  return document;
}
function excel(bytes) {
  let total=0,count=0;
  const zip=unzipSync(bytes,{filter(file){
    const allowed=/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[\w.-]+\.xml)$/.test(file.name);
    if (allowed&&(++count>70||(total+=file.originalSize)>18_000_000)) throw Error("Excel dosyası açıldığında boyut sınırını aşıyor.");
    return allowed;
  }});
  const workbook=xml(zip["xl/workbook.xml"]), relationships=xml(zip["xl/_rels/workbook.xml.rels"]);
  const strings=zip["xl/sharedStrings.xml"]?localElements(xml(zip["xl/sharedStrings.xml"]),"si")
    .map(item=>localElements(item,"t").map(text=>text.textContent).join("")):[];
  const links=new Map(localElements(relationships,"Relationship").map(item=>[item.getAttribute("Id"),item]));
  return localElements(workbook,"sheet").flatMap(sheet=>{
    const id=Array.from(sheet.attributes).find(attr=>attr.localName==="id")?.value;
    const relation=links.get(id), target=relation?.getAttribute("Target")||"";
    if (relation?.getAttribute("TargetMode")==="External"||!/^\/?(?:xl\/)?worksheets\/[\w.-]+\.xml$/.test(target)) return [];
    const path=target.replace(/^\/?(?:xl\/)?/,"xl/");
    const rows=localElements(xml(zip[path]),"row");
    if (rows.length>12000) throw Error("Bir çalışma sayfası 12.000 satırı aşamaz. Dosyayı parçalara ayırın.");
    const cells=rows.map(row=>{
      const result=[];
      for (const cell of localElements(row,"c")) {
        const ref=/^([A-Z]{1,3})\d+$/.exec(cell.getAttribute("r")||"");
        const column=ref?[...ref[1]].reduce((n,char)=>n*26+char.charCodeAt(0)-64,0)-1:result.length;
        if (column>199) continue;
        const value=localElements(cell,"v")[0]?.textContent||"",type=cell.getAttribute("t");
        result[column]=type==="s"?strings[Number(value)]||"":type==="inlineStr"?localElements(cell,"t").map(item=>item.textContent).join(""):value;
      }
      return Array.from(result,value=>value??"");
    }).filter(row=>row.some(Boolean));
    if (!cells.length) return [];
    const [headers,...values]=cells;
    return [{name:sheet.getAttribute("name")||"Excel",headers,rows:values}];
  });
}
function csv(text,name) {
  const input=text.replace(/^\ufeff/,"");
  const head=input.split(/\r?\n/,1)[0].replace(/"(?:""|[^"])*"/g,"");
  const delimiter=[";",",","\t"].sort((a,b)=>head.split(b).length-head.split(a).length)[0];
  const rows=[];let row=[],cell="",quoted=false;
  const pushRow=()=>{row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell="";};
  for (let i=0;i<input.length;i++) {
    const char=input[i];
    if (char==='"'&&quoted&&input[i+1]==='"') {cell+='"';i++;}
    else if (char==='"'&&(quoted||!cell)) quoted=!quoted;
    else if (char===delimiter&&!quoted) {row.push(cell);cell="";}
    else if ((char==="\r"||char==="\n")&&!quoted) {
      if (char==="\r"&&input[i+1]==="\n") i++;
      pushRow();
    } else cell+=char;
  }
  if (quoted) throw Error("CSV dosyasında kapanmamış bir tırnak var.");
  pushRow();
  const [headers=[],...values]=rows;
  return headers.length?[{name,headers,rows:values}]:[];
}
function jsonFile(input) {
  const state=input?.state||input?.datasets||input;
  if (!state||typeof state!=="object"||Array.isArray(state)) throw Error("VetZimo JSON yedeği okunamadı.");
  const groups=[];
  for (const type of Object.keys(migrationNames)) {
    if (!Array.isArray(state[type])||!state[type].length) continue;
    const byBranch=new Map();
    for (const item of state[type]) {
      if (!item||typeof item!=="object"||Array.isArray(item)) continue;
      const branch=typeof item.branch==="string"?item.branch:"";
      if (!byBranch.has(branch)) byBranch.set(branch,[]);
      byBranch.get(branch).push(item);
    }
    for (const [branch,records] of byBranch) {
      const headers=[...new Set(records.flatMap(row=>Object.keys(row)))].filter(key=>key!=="branch");
      groups.push({name:migrationNames[type],type,sourceBranch:branch,
        headers,rows:records.map(row=>headers.map(key=>typeof row[key]==="number"||typeof row[key]==="string"?String(row[key]):""))});
    }
  }
  return groups;
}

export async function readMigrationFile(file) {
  if (!file?.size||file.size>8_000_000) throw Error("En fazla 8 MB boyutunda bir dosya seçin.");
  const name=file.name.replace(/\.[^.]+$/,"");
  if (/\.xlsx$/i.test(file.name)) return excel(new Uint8Array(await file.arrayBuffer()));
  if (/\.(csv|tsv)$/i.test(file.name)) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    let text;
    try {text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
    catch {text=new TextDecoder("windows-1254").decode(bytes);}
    return csv(text,name);
  }
  if (/\.json$/i.test(file.name)) return jsonFile(JSON.parse(await file.text()));
  throw Error("XLSX, CSV, TSV veya VetZimo JSON yedeği seçin. Eski XLS dosyasını Excel’de XLSX olarak kaydedin.");
}
