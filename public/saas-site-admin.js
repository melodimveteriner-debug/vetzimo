import {marketGroups,marketHomeAreas,marketShared} from "./saas-site-content.js";

const tabs=[["content","İçerik"],["seo","SEO ve marka"],["sections","Bölümler ve referanslar"]];
const groupFor=path=>path===marketShared?"Ortak alanlar":path.startsWith("/ozellikler/")?"Özellik ayrıntıları":
  path.startsWith("/cozumler/")?"Çözüm sayfaları":path.startsWith("/blog/")?"Blog yazıları":"Ana sayfalar";

async function compactImage(file) {
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>6_000_000) throw Error("En fazla 6 MB JPG, PNG veya WebP seçin.");
  const image=await createImageBitmap(file);
  try {
    const canvas=document.createElement("canvas"), context=canvas.getContext("2d");
    let scale=Math.min(1,1000/Math.max(image.width,image.height));
    for (let attempt=0;attempt<6;attempt++,scale*=.72) {
      canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const encoded=canvas.toDataURL("image/jpeg",.78);
      if (encoded.length<=80000) return encoded;
    }
    throw Error("Görsel boyut sınırına sığmadı.");
  } finally {image.close();}
}

export async function mountMarketEditor({area,params,canWrite,el,field,selectField,makeForm,link,section,check,call}) {
  const selected=params.get("page")||marketShared, tab=tabs.some(([id])=>id===params.get("view"))?params.get("view"):"content";
  const sectionId=params.get("section")||"";
  const path=(page=selected,view=tab,id="")=>"/yonetim?"+new URLSearchParams({tab:"site",page,view,...(id?{section:id}:{})});
  const endpoint="site-content?"+new URLSearchParams({page:selected,...(sectionId?{section:sectionId}:{})});
  const {pages,fields,record,sections,selectedSection}=await call(endpoint);
  const activeName=pages.find(([key])=>key===selected)[1], previewPath="/platform"+(selected===marketShared||selected==="/"?"":selected);
  const shell=el("div","",{className:"market-studio"});
  const sidebar=el("aside","",{className:"market-studio-nav",ariaLabel:"Satış sitesi sayfaları"});
  sidebar.append(el("strong","Site haritası"));
  const pageSearch=el("input","",{type:"search",placeholder:"Sayfa ara",ariaLabel:"Satış sitesi sayfası ara"});
  sidebar.append(pageSearch);
  const navGroups=new Map();
  for (const [key,label] of pages) {
    const group=groupFor(key);
    if (!navGroups.has(group)) {
      const details=el("details","",{open:group===groupFor(selected)||group==="Ana sayfalar"});
      details.append(el("summary",group));sidebar.append(details);navGroups.set(group,details);
    }
    const item=link(label,path(key),"market-page-link");
    if (key===selected) item.setAttribute("aria-current","page");
    navGroups.get(group).append(item);
  }
  pageSearch.addEventListener("input",()=>{
    const query=pageSearch.value.trim().toLocaleLowerCase("tr");
    for (const group of navGroups.values()) {
      const links=[...group.querySelectorAll("a")];
      for (const item of links) item.hidden=!item.textContent.toLocaleLowerCase("tr").includes(query);
      group.hidden=links.every(item=>item.hidden);
      if (query&&!group.hidden) group.open=true;
    }
  });

  const main=el("div","",{className:"market-studio-main"});
  const header=section(activeName,"İçeriği, arama görünümünü ve yayımlanan bölümleri bu çalışma alanından yönetin.");
  const links=el("div","",{className:"market-studio-actions"});
  links.append(link("Yayındaki sayfayı aç ↗",previewPath,"button secondary"),link("Yazılım Paketleri","/yonetim?tab=paketler","button secondary"));
  header.append(links);
  const tablist=el("nav","",{className:"market-studio-tabs",ariaLabel:"Site editörü görünümleri"});
  for (const [id,label] of tabs) {
    const item=link(label,path(selected,id));
    if (id===tab) item.setAttribute("aria-current","page");
    tablist.append(item);
  }
  header.append(tablist);main.append(header);

  const reload=async(body,target="")=>{
    await call(endpoint,body);
    if (target) location.assign(target);else location.reload();
  };
  const textarea=(name,title,value,maxLength=2500)=>{
    const label=el("label",title);
    label.append(el("textarea","",{name,value,rows:3,maxLength,readOnly:!canWrite}));
    return label;
  };
  const select=(name,label,options,value)=>{
    const node=selectField(name,label,options);
    node.querySelector("select").value=value;
    return node;
  };
  const input=(name,label,value,maxLength=4000)=>field(name,label,{value,maxLength,required:false,readOnly:!canWrite});

  if (tab==="content") {
    const content=section("Sayfa metinleri ve bağlantıları","Alanları bölümlerine göre düzenleyin. İlk içerik her alanın altında gösterilir.");
    const byArea=new Map();
    for (const {key,kind,original,label,area:region} of fields) {
      const value=record.copy[key]??original;
      const fieldLabel=kind==="href"?label+" · "+original:label;
      const node=kind==="text"&&original.length>72?textarea(key,fieldLabel,value,4000):input(key,fieldLabel,value,kind==="href"?1024:4000);
      node.append(el("small","Varsayılan · "+original,{className:"market-original"}));
      if (!byArea.has(region)) {
        const details=el("details","",{className:"market-admin-details",open:byArea.size===0});
        details.append(el("summary",region));byArea.set(region,details);
      }
      byArea.get(region).append(node);
    }
    const layoutFields=[];
    if (selected==="/") {
      const layout=el("details","",{className:"market-admin-details"});
      layout.append(el("summary","Ana sayfa bölüm sırası ve görünürlüğü"));
      for (const [i,name] of marketHomeAreas.entries()) {
        const row=el("fieldset");
        row.append(el("legend",name),
          check("visible_"+i,"Bölümü göster",record.layout[name]?.visible!==false),
          field("order_"+i,"Sıra",{type:"number",min:0,max:999,value:String(record.layout[name]?.order??i*10)}));
        layout.append(row);
      }
      layoutFields.push(layout);
    }
    const groups=[...layoutFields,...byArea.values()];
    if (canWrite) content.append(makeForm(groups,"Sayfa içeriğini kaydet",data=>{
      const copy=Object.fromEntries(fields.map(({key})=>[key,data[key]]));
      const layout=selected==="/"?Object.fromEntries(marketHomeAreas.map((name,i)=>[name,{visible:data["visible_"+i]==="on",order:Number(data["order_"+i])}])):undefined;
      return reload({action:"copy",version:record.version,copy,seo:record.seo,layout});
    }));
    else content.append(...groups);
    main.append(content);
  }

  if (tab==="seo") {
    const content=section("Arama motoru bilgileri ve marka","Boş SEO alanları site genelindeki varsayılanlara döner. Genel logo üst ve alt alanda kullanılır.");
    const fields=[
      input("title","Başlık",record.seo.title||"",120),
      textarea("description","Açıklama",record.seo.description||"",330),
      input("keywords","Anahtar Sözcük",record.seo.keywords||"",420)
    ];
    if (selected===marketShared) fields.push(input("logo","Site logosu · Görsel adresi",record.branding.logo||"",1024));
    if (canWrite) content.append(makeForm(fields,"SEO ve marka ayarlarını kaydet",({logo,...seo})=>reload({
      action:"copy",version:record.version,copy:record.copy,seo,branding:selected===marketShared?{logo}:undefined
    })));
    else content.append(...fields);
    main.append(content);
  }

  if (tab==="sections") {
    const extras=section("Bölümler, iş ortakları ve referanslar","Özel bölümler, görseller ve kurum kartları ekleyin. Konumu, sırayı ve yayın durumunu belirleyin.");
    if (canWrite) extras.append(link("+ Yeni bölüm veya kurum kartı",path(selected,tab,"new"),"button"));
    const relevant=sections.filter(row=>selected===marketShared||row.page===selected||row.page===marketShared);
    if (!relevant.length) extras.append(el("p","Bu görünümde kayıtlı bölüm yok.",{className:"muted"}));
    for (const row of relevant) {
      const item=link(row.title,path(selected,tab,row.id),"market-section-link");
      item.append(el("small",(marketGroups[row.kind]||"Özel bölüm")+" · "+(row.published?"Yayında":"Taslak")));
      if (sectionId===row.id) item.setAttribute("aria-current","page");
      extras.append(item);
    }
    main.append(extras);
    if (canWrite&&(selectedSection||sectionId==="new")) {
      const row=selectedSection||{};
      const edit=section(row.id?row.title:"Yeni bölüm", "Görsel dosyası veya görsel adresi ekleyebilirsiniz.");
      const uploaded=row.image?.startsWith("data:")?row.image:"";
      const file=field("upload","Görsel yükle",{type:"file",accept:"image/jpeg,image/png,image/webp",required:false});
      const form=makeForm([
        select("kind","Bölüm türü",[["block","Özel içerik bölümü"],...Object.entries(marketGroups)],row.kind||"block"),
        select("page","Yayın yeri",[[marketShared,"Tüm satış sayfaları"],...pages.slice(1)],row.page||(selected===marketShared?"/":selected)),
        select("position","Konum",[["before","Sayfa içeriğinden önce"],["after","Sayfa içeriğinden sonra"],
          ...marketHomeAreas.map(name=>["after:"+name,"Ana sayfa · "+name+" sonrasında"])],row.position||"after"),
        field("order","Gösterim sırası",{type:"number",min:0,max:999,value:String(row.order??10)}),
        field("title","Bölüm veya kurum adı",{value:row.title||"",maxLength:140}),
        textarea("description","Açıklama",row.description||""),
        input("image","Görsel adresi",uploaded?"":row.image||"",1024),file,
        ...(uploaded?[check("removeImage","Mevcut görseli kaldır",false)]:[]),
        input("link","Bağlantı adresi",row.link||"",1024),
        input("cta","Düğme metni",row.cta||"",70),
        check("published","Satış sitesinde yayımla",row.published??false)
      ],"Bölümü kaydet",async ({upload,removeImage,...data})=>{
        const image=upload?.size?await compactImage(upload):data.image||(removeImage==="on"?"":uploaded);
        return reload({...data,action:"section",id:row.id,version:row.version??0,order:Number(data.order),image,
          published:data.published==="on"},path(selected,tab));
      });
      const pageSelect=form.elements.page, position=form.elements.position;
      function syncPositions() {
        for (const option of position.options) if (option.value.startsWith("after:")) option.disabled=pageSelect.value!=="/";
        if (position.selectedOptions[0]?.disabled) position.value="after";
      }
      pageSelect.addEventListener("change",syncPositions);syncPositions();
      if (row.image?.startsWith("https:")) edit.append(link("Mevcut görseli aç ↗",row.image,"button secondary"));
      else if (row.image) edit.append(el("img","",{src:row.image,alt:"Mevcut bölüm görseli",className:"market-section-image"}));
      edit.append(form);
      if (row.id) {
        const remove=el("details","",{className:"market-admin-details market-remove"});
        remove.append(el("summary","Bölümü kaldır"),makeForm([check("confirm","Bu bölümü kalıcı olarak kaldır",false)],"Kaldır",data=>{
          if (data.confirm!=="on") throw Error("Kaldırmak için onay kutusunu işaretleyin.");
          return reload({action:"remove",id:row.id,version:row.version},path(selected,tab));
        }));
        edit.append(remove);
      }
      main.append(edit);
    }
  }

  const preview=section("Yayın önizlemesi","Kaydedilmiş içerik ve yayımlanmış bölümler.");
  preview.classList.add("market-studio-preview");
  const frame=el("iframe","",{src:previewPath,title:"Yayındaki satış sayfası önizlemesi",loading:"lazy"});
  frame.setAttribute("sandbox","");
  preview.append(frame);
  const previewBody=el("details","",{className:"market-preview-toggle"});
  previewBody.append(el("summary","Yayın önizlemesini göster"),preview);
  shell.append(sidebar,main,previewBody);
  area.append(shell);
}
