import {zipSync,strToU8} from "/vendor/fflate.js";

const xml=value=>String(value??"").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack='http://schemas.openxmlformats.org/package/2006/relationships';
function column(index) {
  let label="";
  for (let i=index+1;i>0;i=Math.floor((i-1)/26)) label=String.fromCharCode(65+(i-1)%26)+label;
  return label;
}
export function workbook(sheets) {
  const files={};
  const add=(path,data)=>{files[path]=strToU8(prefix+data);};
  add("[Content_Types].xml",`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  add("_rels/.rels",`<Relationships xmlns="${pack}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add("xl/workbook.xml",`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${sheets.map((sheet,i)=>`<sheet name="${xml(sheet.name.slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`);
  add("xl/_rels/workbook.xml.rels",`<Relationships xmlns="${pack}">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}</Relationships>`);
  sheets.forEach(({headers,rows},i)=>{
    const cells=[headers,...rows];
    add(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${headers.map((key,j)=>`<col min="${j+1}" max="${j+1}" width="${Math.max(16,Math.min(40,key.length+4))}" customWidth="1"/>`).join("")}</cols><sheetData>${cells.map((row,j)=>`<row r="${j+1}">${row.map((value,k)=>{
      const ref=column(k)+(j+1);
      return typeof value==="number" && Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${column(headers.length-1)}${cells.length}"/></worksheet>`);
  });
  return zipSync(files);
}
