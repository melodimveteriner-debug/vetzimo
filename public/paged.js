// Ortak sayfalayıcı: "1–15 / 340 kayıt", « ‹ 1 2 … 7 8 9 … 33 34 › », sayfa başına 15 · 50 · 100 · Tümü (tercih hatırlanır).
export const VZ_SIZES=[15,50,100,0];
export function vzSize(def){try{let v=Number(localStorage.getItem("vz-page-size"));if(VZ_SIZES.includes(v)&&localStorage.getItem("vz-page-size")!==null)return v}catch{}return def}
export function vzPager(count,state,go,sizes=VZ_SIZES){
  const nav=document.createElement("nav");nav.className="vet-pages vz-pager";nav.setAttribute("aria-label","Sayfalar");
  const draw=()=>{
    const size=state.size||count||1,total=Math.max(1,Math.ceil(count/size)),p=Math.min(Math.max(1,state.page),total);state.page=p;
    const info=document.createElement("span");info.className="vz-pg-info";
    info.textContent=(count?((p-1)*size+1):0).toLocaleString("tr-TR")+"–"+Math.min(count,p*size).toLocaleString("tr-TR")+" / "+count.toLocaleString("tr-TR")+" kayıt";
    const pages=document.createElement("div");pages.className="vz-pg-pages";
    const btn=(t,pg,label,cur)=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.setAttribute("aria-label",label||"Sayfa "+pg);if(cur)b.setAttribute("aria-current","page");b.disabled=!!cur||pg<1||pg>total;
      b.addEventListener("click",()=>{state.page=pg;go(pg,state.size);draw();nav.querySelector('[aria-current="page"]')?.focus();});return b;};
    if(total>1){
      pages.append(btn("«",1,"İlk sayfa"),btn("‹",p-1,"Önceki sayfa"));
      let prev=0;
      for(const x of [...new Set([1,2,p-2,p-1,p,p+1,p+2,total-1,total].filter(x=>x>=1&&x<=total))].sort((a,b)=>a-b)){
        if(prev&&x-prev>1){const g=document.createElement("span");g.className="vz-pg-gap";g.textContent="…";pages.append(g);}
        pages.append(btn(String(x),x,null,x===p));prev=x;
      }
      pages.append(btn("›",p+1,"Sonraki sayfa"),btn("»",total,"Son sayfa"));
    }
    const label=document.createElement("label");label.className="vz-pg-size";
    const sel=document.createElement("select");sel.setAttribute("aria-label","Sayfa başına kayıt");
    for(const v of sizes){const o=document.createElement("option");o.value=String(v);o.textContent=v?String(v):"Tümü";o.selected=v===state.size;sel.append(o);}
    sel.addEventListener("change",()=>{state.size=Number(sel.value);state.page=1;try{localStorage.setItem("vz-page-size",sel.value)}catch{}go(1,state.size);draw();});
    label.append("Göster",sel);
    nav.replaceChildren(info,pages,label);
  };
  draw();return nav;
}

export function pageControls(total,select) {
  const nav=document.createElement("nav");
  nav.className="vet-pages";
  nav.setAttribute("aria-label","Sayfalar");
  const button=(text,page,current=false,label=text)=>{
    const item=document.createElement("button");
    item.type="button";item.textContent=text;item.setAttribute("aria-label",label);
    if (current) item.setAttribute("aria-current","page");
    item.disabled=page<1||page>total;
    item.addEventListener("click",()=>{select(page);render(page);nav.querySelector('[aria-current="page"]')?.focus();});
    return item;
  };
  function render(current) {
    nav.replaceChildren(button("‹",current-1,false,"Önceki sayfa"));
    const pages=[...new Set([1,current-1,current,current+1,total].filter(page=>page>=1&&page<=total))].sort((a,b)=>a-b);
    let prior=0;
    for (const page of pages) {
      if (prior&&page-prior>1) {const gap=document.createElement("span");gap.textContent="…";nav.append(gap);}
      nav.append(button(String(page),page,page===current,"Sayfa "+page));
      prior=page;
    }
    nav.append(button("›",current+1,false,"Sonraki sayfa"));
  }
  render(1);
  return nav;
}
/** Liste sayfalama: 15 kayıttan uzun listelerde sayfa numaraları ve 15/50/100/Tümü seçimi. */
export function paginate(rows,render,perPage=15) {
  if (rows.length<=VZ_SIZES[0]) return render(rows);
  const wrapper=document.createElement("div"), content=document.createElement("div");
  const state={page:1,size:vzSize(VZ_SIZES[0])};
  const show=(page,size)=>content.replaceChildren(render(size?rows.slice((page-1)*size,page*size):rows));
  show(1,state.size);
  wrapper.append(content,vzPager(rows.length,state,show));
  return wrapper;
}
export function paginateTable(table,perPage=15) {
  if (table.dataset.paged) return;
  const body=table.tBodies[0], rows=Array.from(body?.rows||[]);
  if (!rows.length) return;
  table.dataset.paged="1";
  const state={page:1,size:vzSize(VZ_SIZES[0])};
  const show=(page,size)=>body.replaceChildren(...(size?rows.slice((page-1)*size,page*size):rows));
  const anchor=table.closest(".table-wrap")||table;
  let controls;
  function firstPage() {
    state.page=1;show(1,state.size);
    controls?.remove();
    if(rows.length>VZ_SIZES[0]) {controls=vzPager(rows.length,state,show);anchor.after(controls);}
  }
  const headers=Array.from(table.tHead?.rows.length===1?table.tHead.rows[0].cells:[]);
  if(rows.every(row=>row.cells.length===headers.length)) {
    const collator=new Intl.Collator("tr",{numeric:true,sensitivity:"base"});
    for(const [index,header] of headers.entries()) {
      const label=header.textContent.trim();
      if(!label || /^(İşlem|İşlemler|Seç|Aksiyon)$/i.test(label) || header.querySelector("button,input,a")) continue;
      const control=document.createElement("button");
      control.type="button";control.className="column-sort";control.textContent=label;
      const indicator=document.createElement("span");indicator.textContent="↕";indicator.setAttribute("aria-hidden","true");
      control.append(indicator);header.replaceChildren(control);
      control.addEventListener("click",()=>{
        const descending=header.getAttribute("aria-sort")==="ascending";
        for(const other of headers) {
          other.removeAttribute("aria-sort");
          const arrow=other.querySelector(".column-sort span");
          if(arrow) arrow.textContent="↕";
        }
        header.setAttribute("aria-sort",descending?"descending":"ascending");
        indicator.textContent=descending?"↓":"↑";
        const key=cell=>cell.dataset.sortValue??cell.querySelector("time[datetime]")?.dateTime??cell.textContent.trim();
        rows.sort((a,b)=>{
          const x=key(a.cells[index]),y=key(b.cells[index]);
          if(!x || x==="—") return !y||y==="—"?0:1;
          if(!y || y==="—") return -1;
          const xv=/^-?\d+(?:\.\d+)?$/.test(x)?Number(x):null;
          const yv=/^-?\d+(?:\.\d+)?$/.test(y)?Number(y):null;
          return (descending?-1:1)*(xv!==null&&yv!==null?xv-yv:collator.compare(x,y));
        });
        firstPage();
      });
    }
  }
  firstPage();
}
