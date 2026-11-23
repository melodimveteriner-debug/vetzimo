export function mountClinicFeed(main,feed,track,urgentHost=main) {
  const signature=JSON.stringify([feed.items,feed.urgent]);
  if (main.querySelector(".clinic-content-slots")?.dataset.signature===signature) return;
  main.querySelector(".clinic-content-slots")?.remove();
  urgentHost.querySelector(".clinic-urgent")?.remove();
  const section=document.createElement("section");
  section.className="clinic-content-slots";
  section.dataset.signature=signature;
  section.setAttribute("aria-label","Klinik yayınları");
  const seen=new Set(), read=new Set(), timers=new Map();
  const markRead=id=>{
    if (read.has(id)) return;
    read.add(id);
    void track(id,"read").catch(()=>read.delete(id));
  };
  const clickable=(item,tag)=>{
    const element=document.createElement(item.url?"a":tag);
    if (item.url) {
      element.href=item.url;
      element.target="_blank";
      element.rel="noopener noreferrer";
      element.addEventListener("click",()=>{
        markRead(item.id);
        void track(item.id,"click").catch(()=>{});
      });
    }
    element.dataset.contentId=item.id;
    return element;
  };
  const grid=document.createElement("div");
  grid.className="clinic-content-grid";
  for (const item of feed.items||[]) {
    const card=clickable(item,"article");
    card.className="clinic-ops-card"+(item.image?" has-image":"");
    if (item.image) {
      const image=document.createElement("img");
      image.src=item.image;image.alt="";image.loading="lazy";image.width=960;image.height=540;card.append(image);
    }
    const copy=document.createElement("div");copy.className="clinic-ops-copy";
    const title=document.createElement("h3");title.textContent=item.title;if (item.title) copy.append(title);
    if (item.body) {
      const body=document.createElement("p");body.textContent=item.body;copy.append(body);
    }
    card.title=[item.title,item.body].filter(Boolean).join(" — ");
    if (copy.children.length) card.append(copy);
    if (!item.title && !item.body) card.setAttribute("aria-label",item.kind==="ad"?"Reklam görseli":"Duyuru görseli");
    grid.append(card);
  }
  if (grid.children.length) section.append(grid);
  else section.hidden=true;
  main.append(section);
  const urgent=feed.urgent;
  if (urgent) {
    const bar=clickable(urgent,"aside");
    bar.className="clinic-urgent";
    const label=document.createElement("strong");label.textContent="Duyuru";
    const window=document.createElement("div");window.className="clinic-urgent-window";
    const message=document.createElement("span");message.textContent=[urgent.title,urgent.body].filter(Boolean).join(" · ");
    window.append(message);bar.append(label,window);urgentHost.prepend(bar);
  }
  if (typeof IntersectionObserver!=="function") return;
  const observer=new IntersectionObserver(entries=>{
    for (const entry of entries) {
      const target=entry.target,id=target.dataset.contentId;
      clearTimeout(timers.get(id));timers.delete(id);
      if (!target.isConnected) { observer.unobserve(target);continue; }
      if (!entry.isIntersecting || entry.intersectionRatio<0.5 || document.hidden) continue;
      if (!seen.has(id)) {
        seen.add(id);
        void track(id,"view").catch(()=>seen.delete(id));
      }
      if (!read.has(id)) timers.set(id,setTimeout(()=>{
        timers.delete(id);
        if (target.isConnected && !document.hidden) markRead(id);
      },3000));
    }
  },{threshold:0.5});
  section.querySelectorAll("[data-content-id]").forEach(card=>observer.observe(card));
  const urgentBar=urgentHost.querySelector(".clinic-urgent");
  if (urgentBar) observer.observe(urgentBar);
}
