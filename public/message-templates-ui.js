import {messageTags,resolveMessageTemplate} from "./message-templates.js";
import {paginate} from "./paged.js";

export const messageExamples=[
  {name:"Yaklaşan aşı hatırlatması",channel:"SMS",category:"Aşı",message:"Sayın {sahip}, {hasta} için {asi} tarihi {asi_tarihi}. Randevu için {klinik}: {klinik_telefon}."},
  {name:"Geciken aşı takibi",channel:"SMS",category:"Aşı",message:"Merhaba {sahip}, {hasta} için {asi} kaydı {asi_tarihi} tarihindeydi. Yeni planlama için {klinik_telefon} üzerinden bize ulaşabilirsiniz. {klinik}"},
  {name:"Randevu hatırlatması",channel:"SMS",category:"Randevu",message:"Merhaba {sahip}, {hasta} için kliniğimizde bir randevunuz var. Saatinizi doğrulamak veya değiştirmek için {klinik_telefon} numarasını arayabilirsiniz. {klinik}"},
  {name:"Muayene sonrası kontrol",channel:"SMS",category:"Muayene",message:"Sayın {sahip}, {hasta} için kontrol planını görüşmek üzere {klinik} ile iletişime geçebilirsiniz: {klinik_telefon}."},
  {name:"Açık hesap bilgilendirmesi",channel:"SMS",category:"Finans",message:"Sayın {sahip}, kliniğinizdeki hesap hareketleri hakkında bilgi almak için {klinik_telefon} üzerinden {klinik} ile görüşebilirsiniz."},
  {name:"Klinik iletişim bilgileri",channel:"SMS",category:"Bilgilendirme",message:"Merhaba {sahip}, {klinik} ile randevu ve klinik işlemleri için {klinik_telefon} numarasından iletişime geçebilirsiniz."},
  {name:"Aşı hatırlatması · WhatsApp",channel:"WhatsApp",category:"Aşı",message:"Merhaba {sahip}, {hasta} için {asi} uygulaması {asi_tarihi} tarihinde planlandı. Randevu için {klinik} ile {klinik_telefon} numarasından iletişime geçebilirsiniz."},
  {name:"Randevu teyidi · WhatsApp",channel:"WhatsApp",category:"Randevu",message:"Merhaba {sahip}, {hasta} için planlanan randevuyu teyit etmek ister misiniz? Değişiklik gerekiyorsa {klinik} ile iletişime geçebilirsiniz: {klinik_telefon}."},
];

const node=(tag,value="",props={})=>Object.assign(document.createElement(tag),{textContent:value,...props});
const makeButton=(label,action,style="small")=>{
  const button=node("button",label,{type:"button",className:"button "+style});
  button.addEventListener("click",action);
  return button;
};
const sample=clinic=>({sahip:"Örnek Hasta Sahibi",hasta:"Mia",asi:"Kuduz",asi_tarihi:"20.11.2026",
  klinik:clinic.name||"Örnek Veteriner Kliniği",klinik_telefon:clinic.phone||"0 (000) 000 00 00"});
const count=value=>new Intl.NumberFormat("tr-TR").format(value);
const textFold=value=>String(value||"").toLocaleLowerCase("tr-TR");

export function messagePreview(root,{title,body,channel,clinic}) {
  const filled=resolveMessageTemplate(String(body||""),sample(clinic));
  const keys=[...new Set([...String(body||"").matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]))];
  const valid=keys.filter(key=>Object.hasOwn(messageTags,key));
  const unknown=keys.filter(key=>!Object.hasOwn(messageTags,key));
  const phone=node("section","",{className:"message-phone"});
  phone.append(node("div",channel==="WhatsApp"?"WhatsApp · Örnek":"SMS · Örnek",{className:"eyebrow"}),node("h3",title||"Mesaj önizlemesi"),
    node("p",filled.body||"Mesaj metnini yazdıkça önizleme burada görünür.",{className:"message-bubble"}),
    node("small",count([...filled.body].length)+" karakter · "+(valid.map(key=>messageTags[key]).join(", ")||"Sabit metin"),{className:"suite-muted"}));
  if (unknown.length) phone.append(node("p","Tanınmayan alanlar: "+unknown.join(", "),{className:"callout warning"}));
  if (channel==="WhatsApp") {
    const pattern=node("details");
    pattern.append(node("summary","Sağlayıcı şablonu biçimi"),node("p",filled.approvedBody,{className:"message-bubble"}),
      node("small","Gönderimde metin ve alan sırası, bağlı ve onaylı WhatsApp şablonuyla eşleşmelidir."));
    phone.append(pattern);
  }
  root.replaceChildren(phone);
}

export function mountMessageTemplates(root,{templates,clinic,canWrite,edit,remove,send}) {
  let channel="", search="", library=false;
  const actions=node("div","",{className:"suite-tabs"});
  const controls=node("div","",{className:"suite-toolbar"});
  const label=node("label","Şablonlarda ara");
  const input=node("input","",{type:"search",placeholder:"Ad, kategori veya mesaj",className:"message-template-search"});
  label.append(input);
  controls.append(label,actions);
  const filters=node("div","",{className:"suite-tabs",ariaLabel:"Gönderim kanalı"});
  const contents=node("div");
  const preview=node("section","",{className:"message-preview-region",hidden:true});
  if (canWrite) actions.append(makeButton("+ Yeni şablon",()=>edit(),"primary"));
  const libraryButton=makeButton("Hazır şablonlar",()=>{
    library=!library;preview.hidden=true;draw();
  });
  actions.append(libraryButton);
  if (send) actions.append(node("a","Toplu mesaj",{className:"button",href:"#bayi-mesajlari/toplu"}));
  root.append(controls,filters,contents,preview);
  input.addEventListener("input",()=>{search=textFold(input.value.trim());draw();});

  function show(row) {
    messagePreview(preview,{title:row.name,body:row.message,channel:row.channel,clinic});
    preview.hidden=false;
    preview.tabIndex=-1;preview.focus({preventScroll:true});preview.scrollIntoView({block:"nearest"});
  }
  function draw() {
    libraryButton.setAttribute("aria-pressed",String(library));
    filters.replaceChildren(...[["","Tüm kanallar"],["SMS","SMS"],["WhatsApp","WhatsApp"]].map(([value,title])=>{
      const tab=makeButton(title,()=>{
        channel=value;draw();filters.querySelector('[aria-pressed="true"]')?.focus();
      });
      tab.setAttribute("aria-pressed",String(channel===value));return tab;
    }));
    const rows=(library?messageExamples:templates).filter(row=>(!channel||row.channel===channel)&&
      (!search||[row.name,row.category,row.message].some(value=>textFold(value).includes(search))));
    const summary=node("p",count(rows.length)+" "+(library?"hazır şablon":"kayıtlı şablon"),{className:"suite-muted",role:"status"});
    const table=paginate(rows,visible=>{
      if (!visible.length) return node("p",library?"Bu seçimde hazır şablon bulunamadı.":"Kayıtlı şablon bulunamadı. Hazır şablonlardan başlayabilirsiniz.",{className:"suite-muted"});
      const wrap=node("div","",{className:"suite-table"});
      const table=node("table"), headings=table.createTHead().insertRow(), body=table.createTBody();
      for (const label of ["Şablon","Kanal","İşlemler"]) headings.append(node("th",label,{scope:"col"}));
      for (const item of visible) {
        const row=body.insertRow();
        row.insertCell().append(node("strong",item.name),node("small",item.category||String(item.message||"").slice(0,90)));
        row.insertCell().append(node("span",item.channel,{className:"suite-pill"}));
        const commands=node("div","",{className:"suite-tabs"});
        commands.append(makeButton("Önizle",()=>show(item)));
        if (library&&canWrite) commands.append(makeButton("Şablonu kullan",()=>edit(null,item)));
        else if (!library) {
          if (send) commands.append(node("a","Toplu gönderime hazırla",{className:"button small",href:"#bayi-mesajlari/toplu/"+encodeURIComponent(item.id)}));
          if (canWrite) commands.append(makeButton("Düzenle",()=>edit(item.id)),
            makeButton("Kopyala",()=>edit(null,{...item,name:item.name.slice(0,145)+" · Kopya"})),
            makeButton("Sil",async event=>{
              if (!window.confirm("Bu mesaj şablonu silinsin mi?")) return;
              const button=event.currentTarget;button.disabled=true;
              try {await remove(item.id);} finally {button.disabled=false;}
            },"small suite-danger"));
        }
        row.insertCell().append(commands);
      }
      wrap.append(table);return wrap;
    },15);
    contents.replaceChildren(summary,table);
  }
  draw();
}
