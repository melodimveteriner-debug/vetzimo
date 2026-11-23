import {empty,propose} from '../public/model.js';
import {writeFile} from 'node:fs/promises';
const date='2026-11-12';
let state=empty();
const pairs=[];
function add(type,row){const next=propose(state,type,row,null,date);pairs.push({type,old:structuredClone(state),next:structuredClone(next)});state=next;}
add('clients',{id:'c1',branch:'merkez',name:'Finance Owner'});
add('products',{id:'pr1',branch:'merkez',name:'Ürün',sku:'sku1',category:'Ürün',track:'Evet',price:'100',vat:'20',stock:'10',min:'2',taxMode:'KDV Hariç'});
add('sales',{id:'sale1',branch:'merkez',client:'c1',date,items:JSON.stringify([{product:'pr1',name:'Ürün',quantity:'2',price:'100',vat:'20',taxMode:'KDV Hariç',discountAmount:'10'}]),paid:'100',discount:'5',discountType:'GenelToplamTL',method:'Nakit'});
add('collections',{id:'col1',branch:'merkez',date,sale:'sale1',amount:'125',method:'Kart'});
add('suppliers',{id:'su1',branch:'merkez',name:'Tedarikçi'});
add('purchases',{id:'pu1',branch:'merkez',supplier:'su1',product:'pr1',date,quantity:'5',amount:'250'});
add('payments',{id:'pay1',branch:'merkez',purchase:'pu1',date,amount:'250',method:'Nakit'});
add('expenses',{id:'exp1',branch:'merkez',date,amount:'30',type:'Gider',detail:'Sarf gideri'});
await writeFile(process.argv[2],JSON.stringify(pairs));
