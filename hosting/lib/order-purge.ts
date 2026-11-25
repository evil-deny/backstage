// A minimal request tombstone prevents an old device from recreating a purged order.
export async function purgeOrder(db:D1Database,order:any,revision:number,confirmed:boolean){
 const fail=(status:number,message:string):never=>{throw Object.assign(Error(message),{status});};
 if(!order.deletedAt)fail(409,'請先刪除訂單，再從已刪除訂單永久刪除');
 if(confirmed!==true)fail(400,'請確認永久刪除訂單');
 if(order.channel==='order'&&order.returns?.length)fail(409,'這張訂單含有退貨抵扣紀錄，為保留帳款核對資料，不能永久刪除');
 const key=crypto.randomUUID();
 try{await db.batch([
  db.prepare(`INSERT INTO order_tombstones(request_id,order_id,purged_at)
   SELECT request_id,id,? FROM order_records WHERE id=? AND revision=? AND json_extract(body,'$.deletedAt') IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM billing_claims WHERE order_id=order_records.id)
   AND NOT EXISTS(SELECT 1 FROM billing_invoices WHERE instr(body,order_records.id)>0)`)
   .bind(new Date().toISOString(),order.id,revision),
  db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(key),
  db.prepare('DELETE FROM order_records WHERE id=? AND revision=?').bind(order.id,revision),
  db.prepare('UPDATE billing_state SET revision=revision+1'),
  db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key)
 ]);}catch{
  const linked=await db.prepare('SELECT 1 AS linked FROM billing_claims WHERE order_id=? UNION ALL SELECT 1 FROM billing_invoices WHERE instr(body,?)>0 LIMIT 1').bind(order.id,order.id).first();
  if(linked)fail(409,'這張訂單已納入結帳或退貨抵扣，為保留帳款核對資料，不能永久刪除');
  fail(409,'訂單已更新，請重新整理後再操作');
 }
 return {ok:true,purgedId:order.id};
}
