export const day=iso=>new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
export function analyze(orders,{from='',to='',channel='all'}={}){
 const filtered=orders.filter(o=>!o.deletedAt&&(!from||day(o.createdAt)>=from)&&(!to||day(o.createdAt)<=to)&&(channel==='all'||o.channel===channel));
 const rows=new Map();let revenue=0,qty=0,returned=0,shipped=0,marketOrders=0;
 for(const o of filtered){if(!['shipped','returned'].includes(o.status))continue;shipped++;if(o.market)marketOrders++;
  for(const i of o.items){if(i.picked===false)continue;const unit=i.unit??'件',key=JSON.stringify([i.id,unit]);const row=rows.get(key)||{id:i.id,name:i.name,unit,sold:0,returned:0,net:0,revenue:0};const ret=o.returns.filter(r=>r.id===i.id).reduce((s,r)=>s+r.qty,0);row.sold+=i.qty;row.returned+=ret;row.net+=i.qty-ret;row.revenue+=(i.qty-ret)*i.price;rows.set(key,row);revenue+=(i.qty-ret)*i.price;qty+=i.qty-ret;returned+=ret;}
 }
 return {orders:filtered.length,pending:filtered.filter(o=>['new','picking'].includes(o.status)).length,shipped,marketOrders,revenue,qty,returned,rows:[...rows.values()].sort((a,b)=>b.revenue-a.revenue||b.net-a.net)};
}
