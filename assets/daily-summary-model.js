import {shippedQuantity} from './fulfillment.js';
export const taiwanDay=iso=>new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
export const supplyName=category=>String(category||'').startsWith('兩天一次')?'兩天一次':category||'其他品項';
export function summarizeDaily(orders,bills,products,{date,supply='all',status='all'}={}){
 const prices=new Map();
 for(const bill of bills)for(const line of bill.lines||[])prices.set(JSON.stringify([line.orderId,line.id]),line.unitPriceCents);
 const catalog=new Map(products.map(p=>[p.id,p])),rows=new Map(),people=new Set(),orderIds=new Set(),units=new Map(),sources=new Map();
 let amountCents=0,unpricedQty=0,pendingOrders=0;
 for(const order of orders){
  if(order.channel!=='order'||order.deletedAt||!['new','picking','shipped','returned'].includes(order.status)||taiwanDay(order.createdAt)!==date)continue;
  const pending=['new','picking'].includes(order.status);
  if(status==='pending'&&!pending||status==='shipped'&&pending)continue;
  let included=false;
  for(const item of order.items){
   const category=supplyName(item.category||catalog.get(item.id)?.category||(item.custom?'客製化品項':'其他品項'));
   if(supply!=='all'&&category!==supply)continue;
   included=true;
   const unit=item.unit??'件',key=JSON.stringify([category,item.id,item.name,unit]);
   const row=rows.get(key)||{category,id:item.id,code:item.code||'',name:item.name,unit,qty:0,pendingQty:0,shippedQty:0,returnedQty:0,amountCents:0,unpricedQty:0,orderIds:new Set()};
   const market=item.market===true||item.price===0,price=market?prices.get(JSON.stringify([order.id,item.id])):Math.round(item.price*100);
   const missing=!Number.isSafeInteger(price)||price<0;
   const amount=missing?0:Math.round(price*item.qty);
   row.qty+=item.qty;row.pendingQty+=pending?item.qty:0;row.shippedQty+=!pending?shippedQuantity(item):0;
   row.returnedQty+=(order.returns||[]).filter(r=>r.id===item.id).reduce((s,r)=>s+r.qty,0);
   row.amountCents+=amount;row.unpricedQty+=missing?item.qty:0;row.orderIds.add(order.id);rows.set(key,row);
   units.set(unit,(units.get(unit)||0)+item.qty);amountCents+=amount;unpricedQty+=missing?item.qty:0;
   const source=sources.get(category)||{category,amountCents:0,unpricedQty:0,units:new Map()};
   source.amountCents+=amount;source.unpricedQty+=missing?item.qty:0;source.units.set(unit,(source.units.get(unit)||0)+item.qty);sources.set(category,source);
  }
  if(included){orderIds.add(order.id);people.add(JSON.stringify([order.name,String(order.phone||'').replace(/[\s-]/g,'')]));if(pending)pendingOrders++;}
 }
 const rank=c=>['公司庫存','兩天一次','每日叫貨'].indexOf(c)<0?3:['公司庫存','兩天一次','每日叫貨'].indexOf(c);
 const ordered=[...rows.values()].sort((a,b)=>rank(a.category)-rank(b.category)||a.category.localeCompare(b.category,'zh-Hant')||a.code.localeCompare(b.code,'zh-Hant',{numeric:true})||a.name.localeCompare(b.name,'zh-Hant'));
 return {rows:ordered.map(r=>({...r,orderCount:r.orderIds.size,orderIds:undefined})),sources:[...sources.values()].sort((a,b)=>rank(a.category)-rank(b.category)),units,amountCents,unpricedQty,orderCount:orderIds.size,peopleCount:people.size,pendingOrders};
}
