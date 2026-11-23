const normalize=value=>String(value||"").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i");
const breeds=[
  /tekir|tabby|sarman/, /british shorthair|ingiliz kisa tuylu/, /scottish fold|iskoc kivrik/,
  /golden/, /alman coban|alman kurdu|german shepherd/, /kanis|poodle/,
  /scottish straight|iskoc duz/, /ankara kedisi|turkish angora/, /van kedisi|turkish van/,
  /labrador/, /maltese|malta kopegi/, /kangal/,
  /iran kedisi|persian/, /siyam|siamese/, /maine coon/, /bengal/, /sfenks|sphynx/, /ragdoll/,
  /fransiz bulldog|french bulldog/, /pomeranian|pomeranya/, /yorkshire/,
  /sibirya kurdu|siberian husky/, /beagle/, /dachshund|daksund|sosis kopek/,
];

export function petPortrait(pet, now=new Date()) {
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(pet?.photo||"")) return {src:pet.photo,label:"Hasta fotoğrafı",sample:false};
  const species=normalize(pet?.species), isCat=species==="kedi", isDog=species==="kopek";
  if (!isCat && !isDog) return null;
  const catBreeds=new Set([0,1,2,6,7,8,12,13,14,15,16,17]);
  const index=breeds.findIndex((pattern,i)=>catBreeds.has(i)===isCat&&pattern.test(normalize(pet.breed)));
  let age=1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(pet.birth||"")) {
    const [year,month,day]=pet.birth.split("-").map(Number);
    const months=(now.getFullYear()-year)*12+now.getMonth()+1-month-Number(now.getDate()<day);
    if (months>=0) age=months<6?0:months>=60?2:1;
  }
  const description=index>=0?pet.breed:isCat?"Kedi":"Köpek";
  return {src:`/pet-portraits/${index>=0?index:isCat?0:3}-${age}.jpg`,label:`${description} · Temsili görsel`,sample:true};
}
