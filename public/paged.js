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
export function paginate(rows,render,perPage=12) {
  if (rows.length<=perPage) return render(rows);
  const wrapper=document.createElement("div"), content=document.createElement("div");
  const total=Math.ceil(rows.length/perPage);
  const show=page=>content.replaceChildren(render(rows.slice((page-1)*perPage,page*perPage)));
  show(1);
  wrapper.append(content,pageControls(total,show));
  return wrapper;
}
export function paginateTable(table,perPage=15) {
  if (table.dataset.paged) return;
  const body=table.tBodies[0], rows=Array.from(body?.rows||[]);
  if (!rows.length) return;
  table.dataset.paged="1";
  const show=page=>body.replaceChildren(...rows.slice((page-1)*perPage,page*perPage));
  const anchor=table.closest(".table-wrap")||table;
  const total=Math.ceil(rows.length/perPage);
  let controls;
  function firstPage() {
    show(1);
    controls?.remove();
    if(total>1) {controls=pageControls(total,show);anchor.after(controls);}
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
