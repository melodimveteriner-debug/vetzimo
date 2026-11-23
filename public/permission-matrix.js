export function permissionMatrix({el,selectField,modules,current={},readOnly=false,presets={},prefix="module-",initial="none",title="Modül erişim tablosu"}) {
  const fieldset=el("fieldset","",{className:"suite-permission-matrix"});
  const tools=el("div","",{className:"suite-tabs"});
  fieldset.append(el("legend",title),tools);
  const controls=new Map();
  const set=(key,value)=>{
    const {read,write,stored}=controls.get(key);
    read.checked=value==="read"||value==="write";
    if (write) {
      write.checked=value==="write";
      write.disabled=!read.checked;
    }
    stored.value=value;
  };
  const apply=values=>{for (const key of controls.keys()) set(key,typeof values==="string"?values:values[key]||"none");};
  const action=(title,fn)=>{
    const button=el("button",title,{type:"button",className:"button small"});
    button.addEventListener("click",fn);
    tools.append(button);
  };
  action("Tümünü görüntüle",()=>apply("read"));
  if (!readOnly) action("Tümüne gelişmiş izin ver",()=>apply("write"));
  action("Tüm izinleri kaldır",()=>apply("none"));
  if (Object.keys(presets).length) {
    const preset=selectField("preset","Hazır izin şablonu",[["","Seçiniz"],...Object.entries(presets).map(([key,item])=>[key,item.label])],false);
    const select=preset.querySelector("select");
    select.addEventListener("change",()=>{if (presets[select.value]) apply(presets[select.value].values);select.value="";});
    tools.append(preset);
  }
  const wrap=el("div","",{className:"suite-table"});
  const table=el("table");
  const head=table.createTHead().insertRow();
  for (const title of ["Modül","Görüntüleme",...(!readOnly?["Gelişmiş işlemler"]:[])]) head.append(el("th",title,{scope:"col"}));
  const body=table.createTBody();
  for (const [key,title] of Object.entries(modules)) {
    const row=body.insertRow();row.append(el("th",title,{scope:"row"}));
    const toggle=(label)=>{
      const node=el("input","",{type:"checkbox",ariaLabel:title+" · "+label});
      node.setAttribute("role","switch");
      row.insertCell().append(node);
      return node;
    };
    const read=toggle("Görüntüleme");
    const write=readOnly?null:toggle("Gelişmiş işlemler");
    const stored=el("input","",{type:"hidden",name:prefix+key});
    row.firstElementChild.append(stored);
    controls.set(key,{read,write,stored});
    set(key,current[key]||initial);
    read.addEventListener("change",()=>set(key,read.checked?"read":"none"));
    write?.addEventListener("change",()=>set(key,write.checked?"write":"read"));
  }
  wrap.append(table);fieldset.append(wrap);
  return fieldset;
}

