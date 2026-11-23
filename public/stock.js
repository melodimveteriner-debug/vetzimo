export function productLots(state, product) {
  const lots=(state.stockLots || []).filter(lot=>lot.product===product.id && lot.branch===product.branch);
  if (lots.length || Number(product.stock)<=0 || product.track==="Hayır" || product.category==="Hizmet") return lots;
  return [{
    id:"initial-"+product.id,branch:product.branch,product:product.id,received:product.stock,remaining:product.stock,
    expiry:product.expiry || "",serial:product.batch || "",reason:"Önceki stok bakiyesi",date:"",
    supplier:"",supplierName:"",buy:"",sell:product.price || "",
  }];
}

const total = lots => lots.reduce((sum,lot)=>sum+Number(lot.remaining),0);
function materialize(state,product) {
  const lots=productLots(state,product);
  if (lots.length && !state.stockLots.some(lot=>lot.id===lots[0].id)) state.stockLots.push(...lots);
  return lots;
}
function productInBranch(state,branch,id) {
  const product=state.products.find(row=>row.id===id && row.branch===branch);
  if (!product) throw Error("Ürün bu şubede bulunamadı.");
  return product;
}
function changeLot(lot,delta) {
  const remaining=Number(lot.remaining)+delta;
  if (!Number.isSafeInteger(remaining) || remaining<0 || remaining>Number(lot.received)) throw Error("İşlem için parti stoku yetersiz.");
  lot.remaining=String(remaining);
}
function updateBalance(state,product) {
  const stock=total(state.stockLots.filter(lot=>lot.product===product.id && lot.branch===product.branch));
  if (!Number.isSafeInteger(stock)) throw Error("Stok miktarı geçersiz.");
  product.stock=String(stock);
}
const priceValid = value => value==="" || (/^\d{1,12}(?:\.\d{1,2})?$/.test(value) && Number(value)>=0);
const positiveQuantity = value => Number.isSafeInteger(Number(value)) && Number(value)>0;
const addMovement = (state,lot,delta,date,reason,source) => {
  state.stockMoves.unshift({
    id:crypto.randomUUID(),branch:lot.branch,product:lot.product,lot:lot.id,date,
    delta:String(delta),reason,source,balance:lot.remaining,
  });
};

export function latestPurchasePrice(state,product) {
  const lot=productLots(state,product).filter(item=>item.buy!=="")
    .sort((a,b)=>(b.updatedAt || b.date).localeCompare(a.updatedAt || a.date))[0];
  if (lot) return lot.buy;
  const previous=(state.purchases || []).filter(item=>item.branch===product.branch && item.product===product.id && Number(item.quantity)>0)
    .sort((a,b)=>b.date.localeCompare(a.date))[0];
  return previous ? (Number(previous.amount)/Number(previous.quantity)).toFixed(2) : "";
}

export function proposeStock(state,branch,id,input,date) {
  const next=structuredClone(state);
  next.stockLots ||= [];
  next.stockMoves ||= [];
  const product=productInBranch(next,branch,id);
  if (product.track==="Hayır" || product.category==="Hizmet") throw Error("Bu ürünün stok takibi kapalı.");
  const lots=materialize(next,product);
  if (!input.reason?.trim()) throw Error("İşlem açıklamasını girin.");
  if (input.incoming) {
    if (!positiveQuantity(input.quantity)) throw Error("Pozitif bir tam sayı girin.");
    if (!priceValid(input.buy) || !priceValid(input.sell)) throw Error("Alış veya satış fiyatı geçersiz.");
    if (input.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiry)) throw Error("Geçerli bir SKT girin.");
    const supplier=next.suppliers.find(item=>item.id===input.supplier && item.branch===branch);
    const lot={
      id:crypto.randomUUID(),branch,product:id,received:String(Number(input.quantity)),remaining:String(Number(input.quantity)),
      expiry:input.expiry,serial:input.serial,supplier:supplier?.id || "",supplierName:supplier?.name || input.supplierName,
      buy:input.buy,sell:input.sell || product.price,date,reason:input.reason,updatedAt:new Date().toISOString(),
    };
    next.stockLots.push(lot);
    addMovement(next,lot,Number(lot.remaining),date,input.reason,"Manuel giriş");
    if (input.sell!=="") product.price=input.sell;
  } else {
    const removals=Object.entries(input.removals).filter(([,quantity])=>Number(quantity)!==0);
    if (!removals.length) throw Error("En az bir parti için düşülecek miktarı girin.");
    for (const [id,quantity] of removals) {
      const lot=lots.find(item=>item.id===id);
      if (!lot || !positiveQuantity(quantity)) throw Error("Parti veya miktar geçersiz.");
      changeLot(lot,-Number(quantity));
      addMovement(next,lot,-Number(quantity),date,input.reason,"Manuel çıkış");
    }
  }
  updateBalance(next,product);
  return next;
}

export function applyInventoryPurchase(state,row,prior,date) {
  const product=productInBranch(state,row.branch,row.product);
  const quantity=Number(row.quantity);
  if (!positiveQuantity(quantity)) throw Error("Adet pozitif bir tam sayı olmalı.");
  const source="Alış";
  const id="purchase-"+row.id;
  let existing=state.stockLots.find(item=>item.id===id);
  if (prior && !existing) {
    const previous=productInBranch(state,row.branch,prior.product);
    const lots=materialize(state,previous);
    const legacy=lots.find(item=>item.id==="initial-"+previous.id);
    const remaining=Math.min(Number(prior.quantity),Number(legacy?.remaining || 0));
    if (legacy) {
      legacy.received=String(Number(legacy.received)-remaining);
      legacy.remaining=String(Number(legacy.remaining)-remaining);
    }
    existing={id,product:previous.id,branch:row.branch,received:String(prior.quantity),remaining:String(remaining)};
    state.stockLots.push(existing);
  }
  materialize(state,product);
  const consumed=existing ? Number(existing.received)-Number(existing.remaining) : 0;
  if (consumed>quantity || (consumed && existing.product!==product.id)) throw Error("Kullanılan stok, bu alışta yapılan değişikliğe izin vermiyor.");
  if (existing?.product && existing.product!==product.id) {
    const previous=productInBranch(state,row.branch,existing.product);
    const removed=Number(existing.remaining);
    existing.remaining="0";
    if (removed) addMovement(state,existing,-removed,date,"Alış kaydı değişti",source);
    updateBalance(state,previous);
  }
  const oldAmount=existing?.product===product.id ? Number(existing.remaining) : 0;
  const lot={
    id,branch:row.branch,product:product.id,received:String(quantity),remaining:String(quantity-consumed),
    expiry:row.expiry || "",serial:row.serial || "",supplier:row.supplier || "",
    supplierName:state.suppliers.find(item=>item.id===row.supplier && item.branch===row.branch)?.name || "",
    buy:(Number(row.amount)/quantity).toFixed(2),sell:existing?.sell || product.price,date:row.date,
    reason:row.notes || "Alış kaydı",updatedAt:existing?.updatedAt && existing.buy===(Number(row.amount)/quantity).toFixed(2) && prior?.date===row.date ? existing.updatedAt : new Date().toISOString(),
  };
  if (existing) Object.assign(existing,lot);
  else state.stockLots.push(lot);
  const delta=Number(lot.remaining)-oldAmount;
  if (delta) addMovement(state,lot,delta,date,lot.reason,source);
  updateBalance(state,product);
}

export function allocateInventory(state,type,row,prior,oldLines,newLines,date) {
  const source=type==="sales"?"Satış":"Reçete";
  const totals=lines=>{
    const map=new Map();
    for (const line of lines) {
      if (!positiveQuantity(line.quantity)) throw Error("Adet pozitif bir tam sayı olmalı.");
      map.set(line.product,(map.get(line.product) || 0)+Number(line.quantity));
    }
    return map;
  };
  const old=totals(oldLines), wanted=totals(newLines);
  if ([...new Set([...old.keys(),...wanted.keys()])].every(id=>(old.get(id)||0)===(wanted.get(id)||0))) return;
  const allocations=JSON.parse(prior?.stockAllocations || "[]");
  const applied=[];
  for (const id of new Set([...old.keys(),...wanted.keys()])) {
    const product=productInBranch(state,row.branch,id);
    const lots=materialize(state,product);
    let previous=old.get(id) || 0;
    let required=wanted.get(id) || 0;
    const retained=[];
    for (const [lotId,productId,amount] of allocations.filter(([,productId])=>productId===id)) {
      const lot=lots.find(item=>item.id===lotId);
      if (!lot) throw Error("İşleme ait stok partisi bulunamadı.");
      const keep=Math.min(amount,required);
      if (keep) retained.push([lotId,productId,keep]);
      const returned=amount-keep;
      if (returned) {
        changeLot(lot,returned);
        addMovement(state,lot,returned,date,"Kayıt güncellemesi",source);
      }
      required-=keep;
      previous-=amount;
    }
    const legacyKeep=Math.min(required,previous);
    required-=legacyKeep;
    const legacyReturn=previous-legacyKeep;
    if (legacyReturn) {
      let legacy=lots.find(item=>item.id==="initial-"+id);
      if (!legacy) {
        legacy={id:"initial-"+id,branch:row.branch,product:id,received:"0",remaining:"0",expiry:product.expiry||"",serial:product.batch||"",reason:"Önceki stok bakiyesi",date:"",supplier:"",supplierName:"",buy:"",sell:product.price};
        lots.push(legacy);
        state.stockLots.push(legacy);
      }
      legacy.received=String(Number(legacy.received)+legacyReturn);
      changeLot(legacy,legacyReturn);
      addMovement(state,legacy,legacyReturn,date,"Önceki kayıttan iade",source);
    }
    const eligible=lots.filter(lot=>!lot.expiry || lot.expiry>=date).sort((a,b)=>(a.expiry || "9999").localeCompare(b.expiry || "9999"));
    for (const lot of eligible) {
      if (!required) break;
      const amount=Math.min(required,Number(lot.remaining));
      if (!amount) continue;
      changeLot(lot,-amount);
      addMovement(state,lot,-amount,date,source,source);
      retained.push([lot.id,id,amount]);
      required-=amount;
    }
    if (required) throw Error("İşlem için SKT’si geçmemiş yeterli stok yok.");
    updateBalance(state,product);
    applied.push(...retained);
  }
  row.stockAllocations=JSON.stringify(applied);
}
