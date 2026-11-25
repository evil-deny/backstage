import {erasurePlan,hashId} from './order-erasure.mjs';
const fail=(status:number,message:string):never=>{throw Object.assign(Error(message),{status});};
export async function purgePreview(db:D1Database,order:any){
 if(!order.deletedAt)fail(409,'請先刪除訂單，再從已刪除訂單永久刪除');
 await db.prepare("INSERT OR IGNORE INTO billing_state(id,revision) VALUES('main',0)").run();
 const results=await db.batch([db.prepare('SELECT id,body FROM billing_invoices'),db.prepare('SELECT body FROM billing_manual_returns'),db.prepare('SELECT order_id,invoice_id FROM billing_claims'),db.prepare("SELECT revision FROM billing_state WHERE id='main'")]);
 const invoices=results[0].results.map((r:any)=>({...JSON.parse(r.body),id:r.id}));
 const plan=erasurePlan([order.id],invoices,results[1].results.map((r:any)=>JSON.parse(r.body)),results[2].results);
 return {...plan,billingRevision:Number((results[3].results[0] as any)?.revision??0)};
}
export async function purgeOrder(db:D1Database,order:any,revision:number,confirmed:boolean,expectedBillingRevision?:number){
 if(confirmed!==true)fail(400,'請確認永久刪除訂單');
 const plan=await purgePreview(db,order);
 if(expectedBillingRevision!==plan.billingRevision)fail(409,'結帳資料已更新，請重新確認永久刪除的影響');
 const key=crypto.randomUUID(),orderHash=await hashId(order.id);
 const statements=[db.prepare("UPDATE billing_state SET revision=revision+1 WHERE id='main' AND revision=?").bind(plan.billingRevision),db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(key)];
 // Hashes contain no original order number, request ID, customer or item details.
 statements.push(db.prepare(`INSERT INTO order_tombstones(request_id,order_id,purged_at) SELECT ?,?,? FROM order_records WHERE id=? AND revision=? AND json_extract(body,'$.deletedAt') IS NOT NULL`).bind(await hashId((await db.prepare('SELECT request_id FROM order_records WHERE id=?').bind(order.id).first<any>())?.request_id||''),orderHash,new Date().toISOString(),order.id,revision));
 statements.push(db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(key+'-order'));
 statements.push(db.prepare('DELETE FROM billing_claims WHERE invoice_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(plan.invoiceIds)),db.prepare('DELETE FROM billing_invoices WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(plan.invoiceIds)),db.prepare('DELETE FROM billing_manual_returns WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(plan.manualReturnIds)));
 statements.push(db.prepare('DELETE FROM billing_claims WHERE order_id=?').bind(order.id),db.prepare('DELETE FROM order_tombstones WHERE order_id=?').bind(order.id),db.prepare('DELETE FROM order_records WHERE id=? AND revision=?').bind(order.id,revision),db.prepare('DELETE FROM mutation_guards WHERE id IN (?,?)').bind(key,key+'-order'));
 try{await db.batch(statements);}catch{fail(409,'訂單或結帳資料已更新，請重新整理後再操作');}
 return {ok:true,purgedId:order.id,deletedInvoices:plan.invoiceIds.length,releasedOrders:plan.releasedOrderIds.length};
}
