// Delete complete accounting snapshots so no stale paid totals or credits survive.
export function erasurePlan(orderIds,invoices,manualReturns,claims=[]){
 const targets=new Set(orderIds),bills=new Set(),returns=new Set();
 let changed=true;
 while(changed){changed=false;
  for(const bill of invoices){
   if(bills.has(bill.id))continue;
   if((bill.orders||[]).some(o=>targets.has(o.id))||(bill.lines||[]).some(l=>targets.has(l.orderId))||(bill.credits||[]).some(c=>targets.has(c.orderId)||(String(c.key||'').startsWith('manual:')&&returns.has(c.key.slice(7))))||claims.some(c=>targets.has(c.order_id)&&c.invoice_id===bill.id)){
    bills.add(bill.id);changed=true;
   }
  }
  for(const r of manualReturns)if(bills.has(r.invoiceId)&&!returns.has(r.id)){returns.add(r.id);changed=true;}
 }
 return {invoiceIds:[...bills],manualReturnIds:[...returns],releasedOrderIds:[...new Set(claims.filter(c=>bills.has(c.invoice_id)&&!targets.has(c.order_id)).map(c=>c.order_id))]};
}
export const hashId=async value=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
