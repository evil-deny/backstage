// Amounts are integer cents. Historical bills never read today's catalog prices.
export const billingDay=iso=>new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
export const personKey=p=>JSON.stringify([String(p?.name??'').trim(),String(p?.phone??'').replace(/[\s-]/g,'')]);
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function cents(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e8||Math.abs(value*100-Math.round(value*100))>0.00001)invalid('金額請填寫非負數，最多兩位小數');return Math.round(value*100);}
export function billOrders(orders,bills,person,date){const claimed=new Set(bills.flatMap(b=>b.orders.map(o=>o.id)));return orders.filter(o=>o.channel==='order'&&!o.deletedAt&&['shipped','returned'].includes(o.status)&&personKey(o)===personKey(person)&&billingDay(o.createdAt)===date&&!claimed.has(o.id));}
export function returnCredits(orders,bills,person,currentLines=[],manualReturns=[]){
 const prices=new Map([...bills.flatMap(b=>b.lines),...currentLines].map(i=>[JSON.stringify([i.orderId,i.id]),i]));
 const used=new Map();for(const b of bills)for(const c of b.credits)used.set(c.key,(used.get(c.key)||0)+c.appliedCents);
 const rows=[];for(const o of orders.filter(o=>o.channel==='order'&&personKey(o)===personKey(person)))for(const [index,r]of o.returns.entries()){
  const line=prices.get(JSON.stringify([o.id,r.id]));if(!line)continue;
  const amountCents=Math.round(r.qty*line.unitPriceCents),key=o.id+':'+index,appliedCents=used.get(key)||0;
  rows.push({key,orderId:o.id,name:r.name,qty:r.qty,unit:r.unit??'件',returnedAt:r.returnedAt||o.createdAt,unitPriceCents:line.unitPriceCents,amountCents,appliedCents,remainingCents:Math.max(0,amountCents-appliedCents)});
 }
 for(const r of manualReturns.filter(r=>personKey(r.person)===personKey(person))){const key='manual:'+r.id,appliedCents=used.get(key)||0;rows.push({...r,key,orderId:null,returnedAt:r.date+'T12:00:00+08:00',appliedCents,remainingCents:Math.max(0,r.amountCents-appliedCents)});}
 return rows.sort((a,b)=>a.returnedAt.localeCompare(b.returnedAt)||a.key.localeCompare(b.key));
}
export function buildBill(input,orders,products,bills,manualReturns=[]){
 const person={name:String(input.person?.name??'').trim(),phone:String(input.person?.phone??'').trim()};
 if(!person.name||person.name.length>80||person.phone.length>40)invalid('請選擇或填寫批發人');
 const date=input.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)invalid('請選擇有效結帳日期');
 const chosen=billOrders(orders,bills,person,date);
 const lines=chosen.flatMap(o=>o.items.filter(i=>i.picked!==false).map(i=>{
  const key=JSON.stringify([o.id,i.id]),p=products.find(p=>p.id===i.id),unitPriceCents=i.market?cents(input.marketPrices?.[key]):cents(i.price);
  return {id:i.id,orderId:o.id,date:billingDay(o.createdAt),name:i.name,code:i.code??i.id,category:i.category??(i.custom?'客製化品項':p?.category??'未記錄分類'),qty:i.qty,unit:i.unit??'件',unitPriceCents,grossCents:Math.round(i.qty*unitPriceCents)};
 }));
 if(!Array.isArray(input.manualItems)||input.manualItems.length>100)invalid('手填品項格式錯誤');
 const manualItems=input.manualItems.map(i=>{if(!i||typeof i.name!=='string'||!i.name.trim()||i.name.length>120||typeof i.qty!=='number'||!Number.isFinite(i.qty)||i.qty<=0||i.qty>1e6||Math.abs(i.qty*1000-Math.round(i.qty*1000))>.00001)invalid('手填品項請填寫名稱與有效數量（最多三位小數）');const unitPriceCents=cents(i.price);if(typeof i.unit!=='string'||!i.unit.trim()||i.unit.length>20)invalid('請填寫手填品項單位');return {name:i.name.trim(),qty:i.qty,unit:i.unit.trim(),unitPriceCents,grossCents:Math.round(i.qty*unitPriceCents)};});
 const rentCents=cents(input.rent),utilitiesCents=cents(input.utilities??0),goodsCents=lines.reduce((s,i)=>s+i.grossCents,0),manualCents=manualItems.reduce((s,i)=>s+i.grossCents,0),chargesCents=goodsCents+manualCents+rentCents+utilitiesCents;
 if(!Number.isSafeInteger(chargesCents)||chargesCents>1e12)invalid('結帳總額超過上限');
 if(!chosen.length&&!manualItems.length&&!rentCents&&!utilitiesCents)invalid('此日沒有未結帳的已出貨訂單，請加入手填品項、租金或廠電費');
 const available=returnCredits(orders,bills,person,lines,manualReturns);let remaining=chargesCents;
 const credits=available.filter(c=>c.remainingCents>0).map(c=>{const appliedCents=Math.min(remaining,c.remainingCents);remaining-=appliedCents;return {...c,appliedCents};}).filter(c=>c.appliedCents>0);
 const availableCreditCents=available.reduce((s,c)=>s+c.remainingCents,0),creditCents=chargesCents-remaining;
 return {person,date,orders:chosen.map(o=>({id:o.id,revision:o.revision})),lines,manualItems,rentCents,utilitiesCents,goodsCents,manualCents,chargesCents,credits,creditCents,payableCents:remaining,carryCents:availableCreditCents-creditCents};
}
