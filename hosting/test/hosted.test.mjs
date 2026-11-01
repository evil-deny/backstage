import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime/test',{recursive:true});
await build({entryPoints:['lib/backstage.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/backstage.mjs'});
const {handleBackstage}=await import('../.sites-runtime/test/backstage.mjs');
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
function prepare(query,args=[]){return {bind(...values){return prepare(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},_run(){return sql.prepare(query).run(...args);}};}
const db={prepare,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s._run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
async function request(path,method='GET',body,auth=true,origin){const headers={...(auth?{'oai-authenticated-user-id':'test-owner'}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})};const r=await handleBackstage(new Request('https://site.example'+path,{method,headers,body:body?JSON.stringify(body):undefined}),db);return {status:r.status,data:await r.json()};}
test('D1 版身份驗證、商品同步、批次庫存與歷史單價',async()=>{
 assert.equal((await request('/api/admin/products','GET',undefined,false)).status,401);
 assert.equal((await request('/api/staff')).data.admin,true);
 assert.equal((await request('/api/products')).data.length,197);
 let p=(await request('/api/admin/products','POST',{name:'雲端測試',category:'測試',type:'豆製品',storage:'冷藏',image:'',price:100,stock:3,orderVisible:true,customerVisible:true})).data;
 const stale=p;p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,customerVisible:false})).data;
 assert.equal((await request('/api/products')).data.some(x=>x.id===p.id),false);
 assert.equal((await request('/api/admin/products/'+p.id,'PATCH',stale)).status,409);
 p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,customerVisible:true})).data;
 const payload=(requestId,qty=2)=>({requestId,channel:'customer',name:'測試',phone:'0900000000',items:[{id:p.id,qty,price:100}]});
 const race=await Promise.all(['a','b'].map(id=>request('/api/orders','POST',payload(id))));assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 const winner=race.find(r=>r.status===201),winnerId=race[0].status===201?'a':'b';assert.equal((await request('/api/orders','POST',payload(winnerId))).data.id,winner.data.id);
 p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,1);
 p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,price:200})).data;
 assert.equal((await request('/api/orders','POST',payload('stale'))).status,409);
 let o=(await request('/api/admin/orders')).data[0];assert.equal(o.total,200);
 o=(await request('/api/admin/orders/'+o.id,'PATCH',{action:'ship',revision:o.revision})).data;
 const rev=o.revision;o=(await request('/api/admin/orders/'+o.id,'PATCH',{action:'return',revision:rev,items:[{id:p.id,qty:1}]})).data;
 assert.equal(o.returns.length,1);assert.equal((await request('/api/admin/orders/'+o.id,'PATCH',{action:'return',revision:rev,items:[{id:p.id,qty:1}]})).status,409);
 p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,2);
 assert.equal((await request('/api/admin/orders/'+o.id,'PATCH',{action:'return',revision:o.revision,items:[{id:p.id,qty:2}]})).status,400);
 assert.equal((await request('/api/admin/products','POST',{},true,'https://elsewhere.example')).status,403);
 assert.equal((await request('/api/admin/backup')).data.orders.length,1);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM mutation_guards').get().n,0);
});
test('D1 batch 在中途發現庫存不足時整單回滾',async()=>{
 const all=(await request('/api/admin/products')).data;let a=all.find(p=>p.stock>=2&&p.price>0),b=all.find(p=>p.id!==a.id&&p.stock>=2&&p.price>0);
 const before=a.stock;const repository=(await import('../.sites-runtime/test/backstage.mjs')).createRepository(db);
 const o={id:'rollback-test',channel:'customer',items:[{id:a.id,qty:1,price:a.price},{id:b.id,qty:b.stock+1,price:b.price}]};
 await assert.rejects(repository.place(o,'rollback-request'));
 assert.equal((await repository.product(a.id)).stock,before);assert.equal(await repository.findRequest('rollback-request'),null);
});
