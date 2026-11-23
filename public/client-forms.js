const cityNames="Adana|Adıyaman|Afyonkarahisar|Ağrı|Amasya|Ankara|Antalya|Artvin|Aydın|Balıkesir|Bilecik|Bingöl|Bitlis|Bolu|Burdur|Bursa|Çanakkale|Çankırı|Çorum|Denizli|Diyarbakır|Edirne|Elazığ|Erzincan|Erzurum|Eskişehir|Gaziantep|Giresun|Gümüşhane|Hakkâri|Hatay|Isparta|Mersin|İstanbul|İzmir|Kars|Kastamonu|Kayseri|Kırklareli|Kırşehir|Kocaeli|Konya|Kütahya|Malatya|Manisa|Kahramanmaraş|Mardin|Muğla|Muş|Nevşehir|Niğde|Ordu|Rize|Sakarya|Samsun|Siirt|Sinop|Sivas|Tekirdağ|Tokat|Trabzon|Tunceli|Şanlıurfa|Uşak|Van|Yozgat|Zonguldak|Aksaray|Bayburt|Karaman|Kırıkkale|Batman|Şırnak|Bartın|Ardahan|Iğdır|Yalova|Karabük|Kilis|Osmaniye|Düzce".split("|");
const cities=cityNames.map((name,index)=>({id:index+1,name})).sort((a,b)=>a.name.localeCompare(b.name,"tr"));
const cache=new Map();

async function locationList(path) {
  if (!cache.has(path)) {
    const pending=fetch("/api/locations/"+path).then(async response=>{
      if (!response.ok) throw Error("Adres listesi alınamadı.");
      return (await response.json()).items;
    }).catch(error=>{cache.delete(path);throw error;});
    cache.set(path,pending);
  }
  return cache.get(path);
}
const addOptions=(select,items,existing,placeholder)=>{
  const options=[new Option(placeholder,"")];
  for (const entry of items) {
    const option=new Option(entry.name,entry.name);
    option.dataset.locationId=String(entry.id);
    options.push(option);
  }
  if (existing && !items.some(item=>item.name===existing)) options.push(new Option(existing,existing));
  select.replaceChildren(...options);
  select.value=existing || "";
  select.disabled=false;
};

export function addressMarkup(record,esc) {
  return `<div class="address-group">
    <div class="address-options">
    ${[["city","Şehir"],["district","İlçe"],["neighborhood","Mahalle"]].map(([key,label])=>`<label class="form-field"><span>${label}</span><select name="${key}" data-location="${key}" aria-label="${label}"></select></label>`).join("")}
    </div>
    <div class="address-manual" hidden>${[["city","Şehir"],["district","İlçe"],["neighborhood","Mahalle"]].map(([key,label])=>`<label class="form-field"><span>${label}</span><input name="${key}" data-manual="${key}" value="${esc(record[key])}" disabled maxlength="120"></label>`).join("")}</div>
    <div class="address-helper"><button type="button" class="inline" data-address-mode>Adresi elle gir</button><span data-address-status role="status"></span></div>
  </div>`;
}

export function mountAddress(group,record) {
  const [city,district,neighborhood]=group.querySelectorAll("select");
  const manual=[...group.querySelectorAll("[data-manual]")];
  const status=group.querySelector("[data-address-status]");
  const toggle=group.querySelector("[data-address-mode]");
  let sequence=0, manualMode=false;
  addOptions(city,cities,record.city,"Şehir seç");
  addOptions(district,[],record.district,"Önce şehir seç");
  addOptions(neighborhood,[],record.neighborhood,"Önce ilçe seç");
  function mode(active) {
    manualMode=active;
    sequence++;
    if (active) for (const [index,field] of [city,district,neighborhood].entries()) manual[index].value=field.value;
    group.querySelector(".address-options").hidden=active;
    group.querySelector(".address-manual").hidden=!active;
    for (const field of manual) field.disabled=!active;
    for (const field of [city,district,neighborhood]) field.disabled=active;
    toggle.textContent=active?"Adres listesinden seç":"Adresi elle gir";
    status.textContent="";
  }
  async function loadNeighborhood(existing="") {
    const current=++sequence;
    const id=district.selectedOptions[0]?.dataset.locationId;
    addOptions(neighborhood,[],existing,id?"Mahalleler yükleniyor…":"Önce ilçe seç");
    if (!id) return;
    try {
      const list=await locationList("neighborhoods/"+id);
      if (current!==sequence || manualMode) return;
      addOptions(neighborhood,list,existing,list.length?"Mahalle seç":"Mahalle bulunamadı");
      if (!list.length) status.textContent="Mahalle kaydını elle girebilirsin.";
      else status.textContent="";
    } catch {
      if (current!==sequence || manualMode) return;
      addOptions(neighborhood,[],existing,"Mahalle listesi alınamadı");
      status.textContent="Adres listesini yükleyemedik. Elle giriş açık.";
    }
  }
  async function loadDistrict(existing="",neighborhoodName="") {
    const current=++sequence;
    const id=city.selectedOptions[0]?.dataset.locationId;
    addOptions(district,[],existing,id?"İlçeler yükleniyor…":"Önce şehir seç");
    addOptions(neighborhood,[],neighborhoodName,"Önce ilçe seç");
    if (!id) return;
    try {
      const list=await locationList("districts/"+id);
      if (current!==sequence || manualMode) return;
      addOptions(district,list,existing,list.length?"İlçe seç":"İlçe bulunamadı");
      status.textContent="";
      if (district.value) await loadNeighborhood(neighborhoodName);
    } catch {
      if (current!==sequence || manualMode) return;
      addOptions(district,[],existing,"İlçe listesi alınamadı");
      status.textContent="Adres listesini yükleyemedik. Elle giriş açık.";
    }
  }
  city.addEventListener("change",()=>{status.textContent="";void loadDistrict();});
  district.addEventListener("change",()=>{status.textContent="";void loadNeighborhood();});
  toggle.addEventListener("click",()=>{
    if (!manualMode) mode(true);
    else {
      const [a,b,c]=manual.map(field=>field.value.trim());
      mode(false);
      addOptions(city,cities,a,"Şehir seç");
      void loadDistrict(b,c);
    }
  });
  void loadDistrict(record.district,record.neighborhood);
}

export function normalizeCustomerPhone(value) {
  let digits=String(value || "").replace(/[\s()+-]/g,"");
  if (/^0\d{10}$/.test(digits)) digits="90"+digits.slice(1);
  else if (/^\d{10}$/.test(digits)) digits="90"+digits;
  return /^[1-9]\d{9,14}$/.test(digits) ? "+"+digits : "";
}

export function customerIdentityValid(value) {
  if (!value) return true;
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits=[...value].map(Number);
  const odd=digits[0]+digits[2]+digits[4]+digits[6]+digits[8];
  const even=digits[1]+digits[3]+digits[5]+digits[7];
  return ((odd*7-even)%10+10)%10===digits[9] && digits.slice(0,10).reduce((a,b)=>a+b,0)%10===digits[10];
}
