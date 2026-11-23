export const marketShared="shared";
export const marketHome="/";
export const marketGroups={partners:"İş ortaklarımız",trusted:"Bizi Tercih Edenler"};
export const marketPageKey=path=>path.replace(/\/$/,"")||marketHome;
export const marketSiteEscape=value=>String(value??"").replace(/[&<>"']/g,char=>(
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const decodeText=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({"amp":"&","lt":"<","gt":">","quot":'"',"#39":"'"}[key]));

export function marketSafeLink(value) {
  if (typeof value!=="string"||value.length>1024||/[\s\\\u0000-\u001f\u007f]/.test(value)) return "";
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url=new URL(value);
    return url.protocol==="https:"&&!url.username&&!url.password?url.href:"";
  } catch {return "";}
}

function fieldKey(kind,value) {
  let hash=2166136261;
  for (const char of value) hash=Math.imul(hash^char.codePointAt(0),16777619);
  return kind+":"+ (hash>>>0).toString(36);
}

export const marketHomeAreas=["Karşılama","Klinik, işletme ve iletişim","Öne çıkan modüller","Paket çağrısı","Sık sorulanlar","Klinik rehberi"];

export function marketArrangeHome(html,layout={},sections=[]) {
  const blocks=new Map([...html.matchAll(/<section\b[^>]*data-edit-area="([^"]+)"[^>]*>[\s\S]*?<\/section>/g)]
    .map(([,name],i,all)=>[name,all[i][0]]));
  if (blocks.size!==marketHomeAreas.length) return html;
  return marketHomeAreas.slice().sort((a,b)=>(layout[a]?.order??marketHomeAreas.indexOf(a)*10)-
    (layout[b]?.order??marketHomeAreas.indexOf(b)*10))
    .filter(area=>layout[area]?.visible!==false).map(area=>blocks.get(area)+marketExtraSections(sections,"after:"+area)).join("");
}

export function marketEditableHTML(html,overrides={},fields,initialArea="Sayfa içeriği") {
  let inSvg=false, area=initialArea, tag="";
  function field(kind,original,label) {
    const key=fieldKey(kind,original);
    const prior=fields?.get(key);
    fields?.set(key,{key,kind,label,area:prior?.area||area,original:decodeText(original)});
    return Object.hasOwn(overrides,key)?marketSiteEscape(overrides[key]):original;
  }
  return html.split(/(<[^>]+>)/g).map((part,i)=>{
    if (i%2) {
      if (/^<svg\b/.test(part)) inSvg=true;
      else if (/^<\/svg\b/.test(part)) inSvg=false;
      if (inSvg) return part;
      const marker=part.match(/data-edit-area="([^"]+)"/);
      if (marker) area=marker[1];
      const node=part.match(/^<(\/?)([\w-]+)/);
      if (node) tag=node[1]?"":node[2];
      return part.replace(/\b(placeholder|alt|href)="([^"]*)"/g,(match,attr,value)=>{
        if (!value) return match;
        if (attr==="href"&&(!/^\/platform(?:\/[^?#"]*)?$/.test(value)||value.endsWith("/gizlilik"))) return match;
        return attr+'="'+field(attr,value,attr==="href"?"Bağlantı":attr==="alt"?"Görsel açıklaması":"Alan ipucu")+'"';
      });
    }
    if (inSvg || tag==="time" || (!/\p{L}/u.test(part)&&!(tag==="b"&&/^[\d., ]+₺?$/.test(part.trim())))) return part;
    const labels={h1:"Ana başlık",h2:"Bölüm başlığı",h3:"Kart başlığı",p:"Açıklama",a:"Bağlantı metni",b:"Vurgu",summary:"Soru",small:"Kısa bilgi",button:"Düğme metni"};
    const value=part.trim();
    return part.replace(value,()=>field("text",value,labels[tag]||"Metin"));
  }).join("");
}

export function marketExtraSections(sections,position) {
  const visible=sections.filter(row=>row.position===position);
  const cards=rows=>rows.map(row=>{
    const name=marketSiteEscape(row.title);
    const caption=row.description?`<p>${marketSiteEscape(row.description)}</p>`:"";
    const img=row.image?`<img loading="lazy" src="${marketSiteEscape(row.image)}" alt="" referrerpolicy="no-referrer">`:"";
    const body=img+`<h3>${name}</h3>`+caption;
    return row.link?`<a class="card market-extra-card" href="${marketSiteEscape(row.link)}">${body}</a>`:
      `<article class="card market-extra-card">${body}</article>`;
  }).join("");
  const groups=Object.entries(marketGroups).filter(([key])=>position==="after"||visible.some(row=>row.kind===key)).map(([key,label])=>{
    const rows=visible.filter(row=>row.kind===key);
    return rows.length?`<section class="block market-extra"><div class="section-title"><h2>${marketSiteEscape(label)}</h2></div><div class="cards">${cards(rows)}</div></section>`:"";
  });
  const blocks=visible.filter(row=>row.kind==="block").map(row=>{
    const heading=`<h2>${marketSiteEscape(row.title)}</h2>`;
    const copy=row.description?`<p>${marketSiteEscape(row.description)}</p>`:"";
    const button=row.link?`<a class="button outline" href="${marketSiteEscape(row.link)}">${marketSiteEscape(row.cta||"İncele")}</a>`:"";
    const image=row.image?`<img loading="lazy" src="${marketSiteEscape(row.image)}" alt="" referrerpolicy="no-referrer">`:"";
    return `<section class="block market-extra market-custom"><div>${heading}${copy}${button}</div>${image}</section>`;
  });
  return groups.concat(blocks).join("");
}
