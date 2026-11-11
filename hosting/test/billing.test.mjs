import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {billingDay,buildBill,returnCredits} from '../public/billing-model.js';
import {billImageRows} from '../public/billing-image.js';
mkdirSync('.sites-runtime/test',{recursive:true});
await build({entryPoints:['lib/backstage.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/billing-handler.mjs'});
const {handleBackstage}=await import('../.sites-runtime/test/billing-handler.mjs');
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
const prepare=(query,args=[])=>({bind(...a){return prepare(query,a);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},_run(){const s=sql.prepare(query);return s.columns().length?{results:s.all(...args)}:s.run(...args);}});
const db={prepare,async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s._run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const token='b'.repeat(64),config={ADMIN_EMAILS:'owner@example.test',GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'};
sql.prepare('INSERT INTO api_grants(hash,expires,provider,subject,email,audience) VALUES(?,?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+3600000,'google','owner','owner@example.test',config.GOOGLE_CLIENT_ID);
async function request(path,method='GET',body,auth=true){const r=await handleBackstage(new Request('https://site.example'+path,{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),db,config);return {status:r.status,data:await r.json()};}
const person={name:'每日結帳測試',phone:'0900000000'},date=billingDay(new Date().toISOString());
let counter=0;
async function post(input){const orderRevisions=(await request('/api/admin/orders')).data.filter(o=>o.channel==='order'&&JSON.stringify([o.name,o.phone])===JSON.stringify([(input.person??person).name,(input.person??person).phone])).map(o=>({id:o.id,revision:o.revision}));const state=(await request('/api/admin/billing')).data;return request('/api/admin/billing','POST',{person,date,manualItems:[],rent:0,marketPrices:{},orderRevisions,revision:state.revision,requestId:'billing-operation-'+(++counter),...input});}
async function order(products,channel='order',who=person){const r=await request('/api/orders','POST',{requestId:'billing-order-'+(++counter),channel,...who,items:products.map(p=>({id:p.id,price:channel==='order'?p.orderPrice:p.price,qty:2}))},false);assert.equal(r.status,201);const shipped=await request('/api/admin/orders/'+r.data.id,'PATCH',{action:'ship',revision:1});assert.equal(shipped.status,200);return shipped.data;}
async function product(name,category,price=100){const r=await request('/api/admin/products','POST',{name,category,type:'測試',storage:'乾貨',price,orderPrice:price,stock:100,orderVisible:true,customerVisible:true});assert.equal(r.status,201);return r.data;}
test('每日批發結帳、雙分類、單分類單品、手填租金、跨日退貨抵扣與權限',async()=>{
 assert.equal((await request('/api/admin/billing','GET',undefined,false)).status,401);
 for(const path of ['/api/admin/billing','/api/admin/billing/paid','/api/admin/billing/manual-return'])assert.equal((await request(path,'POST',{},false)).status,401);
 const a=await product('公司商品','公司庫存',100),b=await product('兩天商品','兩天一次(三五日結單/一四六到貨)',50);
 const oa=await order([a]),ob=await order([b]);await order([a],'customer');await order([a],'order',{...person,phone:'0911111111'});
 let result=await post({manualItems:[{name:'豆腐',qty:3,unit:'斤',price:12.5},{name:'豆干',qty:2,unit:'包',price:20}],rent:80});assert.equal(result.status,200);const first=result.data;
 assert.equal(first.orders.length,2);assert.equal(first.goodsCents,30000);assert.equal(first.manualCents,7750);assert.equal(first.payableCents,45750);assert.deepEqual(new Set(first.lines.map(i=>i.category)),new Set([a.category,b.category]));
 result=await post({});assert.equal(result.status,400); // No double-billed orders.
 const stale=await request('/api/admin/billing','POST',{person,date,manualItems:[],rent:10,revision:0,requestId:'stale-operation'});assert.equal(stale.status,409);
 // New catalog price and category cannot change the original bill or its refund value.
 const current=(await request('/api/admin/products')).data.find(p=>p.id===a.id);await request('/api/admin/products/'+a.id,'PATCH',{...current,orderPrice:500,category:'改分類'});
 const returned=await request('/api/staff/orders/'+oa.id,'PATCH',{revision:oa.revision,action:'return',items:[{id:a.id,qty:2}]},false);assert.equal(returned.status,200);
 let state=(await request('/api/admin/billing')).data;assert.equal(state.bills[0].goodsCents,30000);
 result=await request('/api/admin/billing/manual-return','POST',{revision:state.revision,requestId:'manual-return-1',invoiceId:first.id,lineIndex:0,qty:1,date});assert.equal(result.status,200);assert.equal(result.data.amountCents,1250);
 state=(await request('/api/admin/billing')).data;
 result=await request('/api/admin/billing/manual-return','POST',{revision:state.revision,requestId:'manual-return-too-many',invoiceId:first.id,lineIndex:0,qty:3,date});assert.equal(result.status,400);
 const third=await order([b]);result=await post({});assert.equal(result.status,200);assert.equal(result.data.orders.length,1);assert.equal(result.data.lines.length,1);assert.equal(result.data.creditCents,10000);assert.equal(result.data.payableCents,0);assert.equal(result.data.carryCents,11250);
 result=await post({rent:200});assert.equal(result.status,200);assert.equal(result.data.creditCents,11250);assert.equal(result.data.payableCents,8750);assert.equal(result.data.carryCents,0);
 state=(await request('/api/admin/billing')).data;
 const credits=returnCredits((await request('/api/admin/orders')).data,state.bills,person,[],state.manualReturns);assert.equal(credits.reduce((s,c)=>s+c.remainingCents,0),0);
 const paid=await request('/api/admin/billing/paid','POST',{revision:state.revision,requestId:'mark-paid-operation',invoiceId:first.id});assert.equal(paid.status,200);assert.ok(paid.data.paidAt);
 assert.equal((await request('/api/admin/backup')).data.billing.bills.length,3);
 // Concurrent checkouts cannot both consume the same credit or order.
 await order([b]);state=(await request('/api/admin/billing')).data;
 const orderRevisions=(await request('/api/admin/orders')).data.filter(o=>o.channel==='order'&&o.name===person.name&&o.phone===person.phone).map(o=>({id:o.id,revision:o.revision}));
 const changed=await request('/api/admin/billing','POST',{person,date,rent:0,manualItems:[],marketPrices:{},revision:state.revision,requestId:'stale-order-operation',orderRevisions:[]});assert.equal(changed.status,409);
 const races=await Promise.all(['race-first','race-second'].map(requestId=>request('/api/admin/billing','POST',{person,date,rent:0,manualItems:[],marketPrices:{},orderRevisions,revision:state.revision,requestId})));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
});
test('時價單價必填、以結帳快照退貨、分次手填退貨不因四捨五入超退',async()=>{
 const who={name:'時價批發人',phone:''},p=await product('時價豆腐','兩天一次',0);let o=await order([p],'order',who);
 assert.equal((await post({person:who})).status,400);
 const first=(await post({person:who,marketPrices:{[JSON.stringify([o.id,p.id])]:20.25},manualItems:[{name:'分次退貨豆干',qty:1,price:.01,unit:'斤'}]})).data;assert.equal(first.goodsCents,4050);
 await request('/api/admin/orders/'+o.id,'PATCH',{action:'return',revision:o.revision,items:[{id:p.id,qty:1}]});
 for(const [index,qty]of [.333,.333,.334].entries()){const state=(await request('/api/admin/billing')).data;const r=await request('/api/admin/billing/manual-return','POST',{revision:state.revision,requestId:'fractional-return-'+index,invoiceId:first.id,lineIndex:0,qty,date});assert.equal(r.status,200);}
 const state=(await request('/api/admin/billing')).data;assert.equal(state.manualReturns.filter(r=>r.invoiceId===first.id).reduce((s,r)=>s+r.amountCents,0),1);
 const bill=(await post({person:who,rent:30})).data;assert.equal(bill.creditCents,2026);assert.equal(bill.payableCents,974);
 const invalid=(await post({person:who,rent:-1}));assert.equal(invalid.status,400);
});
test('台灣跨日、未出貨／取消排除，舊分類回填與單品仍可結帳',()=>{
 const o={id:'one',channel:'order',name:'單品',phone:'',createdAt:'2026-11-04T16:01:00Z',status:'shipped',revision:1,items:[{id:'p1',name:'商品',price:10,qty:1,picked:true}],returns:[]};
 const body={person:o,date:'2026-11-05',manualItems:[],rent:0,marketPrices:{}};const bill=buildBill(body,[o], [{id:'p1',category:'公司庫存'}],[]);assert.equal(bill.lines.length,1);assert.equal(bill.lines[0].category,'公司庫存');assert.equal(bill.payableCents,1000);
 assert.throws(()=>buildBill({...body,date:'2026-11-04'},[o],[],[]),/沒有未結帳/);
 for(const status of ['new','picking','cancelled'])assert.throws(()=>buildBill(body,[{...o,status}],[],[]),/沒有未結帳/);
 assert.throws(()=>buildBill({...body,date:'2026-02-30'},[o],[],[]),/有效結帳日期/);
});

test('刪除批發人與結帳紀錄可還原，保留價格、收款、訂單認列及退貨抵扣',async()=>{
 const state=async()=>(await request('/api/admin/billing')).data;
 const action=async(name,body={})=>request('/api/admin/billing/'+name,'POST',{revision:(await state()).revision,requestId:'delete-restore-'+(++counter),...body});
 for(const name of ['delete-person','restore-person','delete-invoice','restore-invoice'])assert.equal((await request('/api/admin/billing/'+name,'POST',{},false)).status,401);
 let before=await state();const original=before.bills.find(b=>b.paidAt);assert.ok(original);
 const originalOrders=(await request('/api/admin/orders')).data;
 const creditsBefore=returnCredits(originalOrders,before.bills,original.person,[],before.manualReturns);
 const result=await action('delete-invoice',{invoiceId:original.id});assert.equal(result.status,200);assert.ok(result.data.deletedAt);assert.equal(result.data.paidAt,original.paidAt);
 let after=await state();assert.deepEqual(returnCredits(originalOrders,after.bills,original.person,[],after.manualReturns),creditsBefore);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM billing_claims WHERE invoice_id=?').get(original.id).n,original.orders.length);
 assert.equal((await action('paid',{invoiceId:original.id})).status,409);assert.equal((await action('delete-invoice',{invoiceId:original.id})).status,409);
 assert.equal((await action('delete-person',{person:original.person})).status,200);
 after=await state();assert.equal(after.deletedPeople[0].person.name,original.person.name);
 assert.equal((await post({person:original.person,rent:10})).status,409);
 assert.equal((await request('/api/admin/backup')).data.billing.deletedPeople.length,1);
 assert.equal((await action('restore-person',{person:original.person})).status,200);assert.equal((await state()).deletedPeople.length,0);
 assert.equal((await action('restore-invoice',{invoiceId:original.id})).status,200);
 const restored=(await state()).bills.find(b=>b.id===original.id);assert.deepEqual(restored,original);
 assert.equal((await action('restore-invoice',{invoiceId:original.id})).status,409);
 assert.deepEqual((await request('/api/admin/orders')).data,originalOrders);
 const revision=(await state()).revision;
 const concurrent=await Promise.all(['delete-a','delete-b'].map(requestId=>request('/api/admin/billing/delete-invoice','POST',{revision,requestId,invoiceId:original.id})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 assert.equal((await action('restore-invoice',{invoiceId:original.id})).status,200);
});

test('四項時價品項保留單位，廠電費納入結帳與圖片，舊帳單相容',async()=>{
 const who={name:'四項時價測試',phone:''},manualItems=[{name:'白豆腐',unit:'板',qty:2,price:100},{name:'炸四角',unit:'籃',qty:1,price:120},{name:'黃干',unit:'包',qty:3,price:50},{name:'Ng干',unit:'包',qty:2,price:30}];
 let r=await post({person:who,manualItems,rent:100,utilities:25.5});assert.equal(r.status,200);const b=r.data;
 assert.equal(b.manualCents,53000);assert.equal(b.utilitiesCents,2550);assert.equal(b.payableCents,65550);assert.deepEqual(b.manualItems.map(i=>[i.name,i.unit]),manualItems.map(i=>[i.name,i.unit]));
 const rows=billImageRows(b);assert.ok(rows.some(r=>r.text==='廠電費'&&r.value==='NT$ 25.5'));assert.ok(rows.some(r=>r.text==='本次應收'&&r.value==='NT$ 655.5'));
 r=await post({person:who,utilities:10});assert.equal(r.status,200);assert.equal(r.data.payableCents,1000);
 const legacy={...b};delete legacy.utilitiesCents;assert.ok(billImageRows(legacy).some(r=>r.text==='廠電費'&&r.value==='NT$ 0'));
 assert.equal((await post({person:who,utilities:-1})).status,400);
 assert.equal((await post({person:who,utilities:1.001})).status,400);
 assert.equal((await request('/api/admin/backup')).data.billing.bills.find(i=>i.id===b.id).utilitiesCents,2550);
});
