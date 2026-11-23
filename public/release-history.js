import {pageControls} from "./paged.js";

const labels={feature:"Yeni özellik",fix:"Hata giderme",update:"Düzenleme"};
const date=new Intl.DateTimeFormat("tr-TR",{dateStyle:"long",timeStyle:"short",timeZone:"Europe/Istanbul"});
const make=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});

export async function mountReleaseHistory(root) {
  const content=make("div","",{className:"release-list",ariaLive:"polite"});
  root.replaceChildren(content);
  let requested=0, pagination=null;
  async function show(page) {
    const seq=++requested;
    content.setAttribute("aria-busy","true");
    content.replaceChildren(make("p","Sürüm geçmişi yükleniyor…"));
    try {
      const response=await fetch("/api/ops/releases?page="+page);
      const data=await response.json();
      if (!response.ok) throw Error(data.error||"Sürüm geçmişi yüklenemedi.");
      if (seq!==requested||!root.contains(content)) return;
      const cards=data.items.map(row=>{
        const card=make("article","");
        const meta=make("div","",{className:"release-meta"});
        meta.append(make("span",row.version,{className:"version-pill"}),make("span",labels[row.kind]||"Güncelleme"),
          make("time",date.format(new Date(row.updated_at)),{dateTime:row.updated_at}));
        card.append(meta,make("h3",row.title),make("p",row.body,{className:"clinic-preline"}));
        return card;
      });
      content.replaceChildren(...(cards.length?cards:[make("p","Henüz yayımlanmış sürüm notu yok.")]));
      if (!pagination&&data.pages>1) {
        pagination=pageControls(data.pages,next=>{content.scrollIntoView({block:"nearest"});void show(next);});
        root.append(pagination);
      }
    } catch(error) {
      if (seq!==requested) return;
      const retry=make("button","Tekrar dene",{type:"button",className:"button"});
      retry.addEventListener("click",()=>void show(page));
      content.replaceChildren(make("p",error.message),retry);
    } finally {
      if (seq===requested) content.removeAttribute("aria-busy");
    }
  }
  await show(1);
}
