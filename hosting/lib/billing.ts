import {buildBill,personKey} from '../public/billing-model.js';
const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
export async function billingData(db:D1Database){
 await db.prepare("INSERT OR IGNORE INTO billing_state(id,revision) VALUES('main',0)").run();
 const result=await db.batch([db.prepare("SELECT revision FROM billing_state WHERE id='main'"),db.prepare('SELECT body FROM billing_invoices ORDER BY rowid DESC'),db.prepare('SELECT body FROM billing_manual_returns ORDER BY rowid')]);
 return {revision:Number((result[0].results[0] as any)?.revision??0),bills:result[1].results.map((r:any)=>JSON.parse(r.body)),manualReturns:result[2].results.map((r:any)=>JSON.parse(r.body))};
}
export async function billingAction(db:D1Database,path:string,method:string,b:any,orders:any[],products:any[]){
 const data=await billingData(db);
 if(method==='GET'&&path==='/api/admin/billing')return data;
 if(method!=='POST')fail(405,'不支援的結帳操作');
 if(b.revision!==data.revision)fail(409,'結帳資料已更新，請重新整理後再操作');
 const id=typeof b.requestId==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(b.requestId)?b.requestId:fail(400,'請提供有效結帳操作編號');
 const guard=crypto.randomUUID(),statements=[db.prepare("UPDATE billing_state SET revision=revision+1 WHERE id='main' AND revision=?").bind(data.revision),db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(guard)];
 let bill:any;
 if(path==='/api/admin/billing'){
  if(data.bills.some(i=>i.id===id))fail(409,'此結帳單已建立，請重新整理查看');
  const current=orders.filter(o=>o.channel==='order'&&personKey(o)===personKey(b.person)).map(o=>({id:o.id,revision:o.revision})).sort((a,b)=>a.id.localeCompare(b.id));
  if(!Array.isArray(b.orderRevisions)||b.orderRevisions.some((o:any)=>!o||typeof o.id!=='string'||!Number.isSafeInteger(o.revision))||JSON.stringify([...b.orderRevisions].sort((a,b)=>String(a.id).localeCompare(String(b.id))))!==JSON.stringify(current))fail(409,'這位批發人的訂單或退貨已更新，請重新整理再確認金額');
  bill={...buildBill(b,orders,products,data.bills,data.manualReturns),id,createdAt:new Date().toISOString(),paidAt:null};
  // Check every relevant order snapshot: returns and shipping can race with checkout.
  for(const o of orders.filter(o=>o.channel==='order'&&personKey(o)===personKey(bill.person))){
   statements.push(db.prepare('INSERT INTO mutation_guards(id,ok) SELECT ?,COUNT(*) FROM order_records WHERE id=? AND revision=?').bind(guard+o.id,o.id,o.revision));
  }
  statements.push(db.prepare('INSERT INTO billing_invoices(id,body) VALUES(?,?)').bind(id,JSON.stringify(bill)));
  for(const o of bill.orders)statements.push(db.prepare('INSERT INTO billing_claims(order_id,invoice_id) VALUES(?,?)').bind(o.id,id));
 }else if(path==='/api/admin/billing/manual-return'){
  const original=data.bills.find(i=>i.id===b.invoiceId)??fail(404,'找不到原結帳單');
  if(!Number.isSafeInteger(b.lineIndex)||!original.manualItems[b.lineIndex])fail(400,'請選擇原手填品項');
  const line=original.manualItems[b.lineIndex],returned=data.manualReturns.filter(r=>r.invoiceId===original.id&&r.lineIndex===b.lineIndex).reduce((sum,r)=>sum+r.qty,0);
  if(typeof b.qty!=='number'||!Number.isFinite(b.qty)||b.qty<=0||Math.abs(b.qty*1000-Math.round(b.qty*1000))>.00001||Math.round((b.qty+returned)*1000)>Math.round(line.qty*1000))fail(400,'退貨數量超過原結帳數量');
  if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||Number.isNaN(Date.parse(b.date))||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date)fail(400,'請選擇有效退貨日期');
  bill={id,invoiceId:original.id,lineIndex:b.lineIndex,person:original.person,name:line.name,unit:line.unit,unitPriceCents:line.unitPriceCents,qty:b.qty,amountCents:Math.round((returned+b.qty)*line.unitPriceCents)-Math.round(returned*line.unitPriceCents),date:b.date,createdAt:new Date().toISOString()};
  statements.push(db.prepare('INSERT INTO billing_manual_returns(id,body) VALUES(?,?)').bind(id,JSON.stringify(bill)));
 }else if(path==='/api/admin/billing/paid'){
  bill=data.bills.find(i=>i.id===b.invoiceId)??fail(404,'找不到結帳單');if(bill.paidAt)fail(409,'此結帳單已收款');bill={...bill,paidAt:new Date().toISOString()};
  statements.push(db.prepare('UPDATE billing_invoices SET body=? WHERE id=?').bind(JSON.stringify(bill),bill.id));
 }else fail(404,'找不到結帳操作');
 statements.push(db.prepare('DELETE FROM mutation_guards WHERE id LIKE ?').bind(guard+'%'));
 try{await db.batch(statements);}catch{fail(409,'訂單或結帳資料已更新，請重新整理後再結帳');}return bill;
}
