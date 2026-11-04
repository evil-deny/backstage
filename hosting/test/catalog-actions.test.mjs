// Compile and exercise the real hosted worker handler with an isolated D1-compatible database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
mkdirSync('.sites-runtime/test',{recursive:true});
await build({entryPoints:['lib/backstage.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/catalog-handler.mjs'});
await build({entryPoints:['lib/google-access.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/catalog-access.mjs'});
const {handleBackstage,createRepository}=await import('../.sites-runtime/test/catalog-handler.mjs');
const {digest}=await import('../.sites-runtime/test/catalog-access.mjs');
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
function prepare(query,args=[]){return {bind(...values){return prepare(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},_run(){const statement=sql.prepare(query);return statement.columns().length?{results:statement.all(...args)}:statement.run(...args);}};}
const db={prepare,async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>s._run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const config={GOOGLE_CLIENT_ID:'catalog-test.apps.googleusercontent.com',ADMIN_EMAILS:'owner@example.test'},token='f'.repeat(64);
sql.prepare('INSERT INTO api_grants(hash,expires,provider,subject,email,audience) VALUES(?,?,?,?,?,?)').run(await digest(token),Date.now()+3600000,'google','owner','owner@example.test',config.GOOGLE_CLIENT_ID);
async function request(path,method='GET',body,admin=true){const r=await handleBackstage(new Request('https://site.example/api/'+path,{method,headers:{...(admin?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),db,config);return {status:r.status,data:await r.json()};}
const catalog=async()=>{const r=await request('admin/catalog');assert.equal(r.status,200);return r.data;};
const contiguous=layout=>assert.deepEqual(layout.products.map(p=>p.code),layout.products.map((_,i)=>'P'+(i+1)));
const find=async id=>(await catalog()).products.concat((await catalog()).deletedProducts).find(p=>p.id===id);

test('P198–P200 插入 P35 後，實際顯示 P36–P38、後面順延且身份不改',async()=>{
 let layout=await catalog();assert.equal(layout.products.length,197);contiguous(layout);
 const before=layout.products.map(p=>({id:p.id,stock:p.stock,price:p.price}));
 for(const n of [198,199,200]){const r=await request('admin/products','POST',{name:'同品牌同包裝 '+n,category:'公司庫存',type:'豆製品',storage:'冷藏',price:100,orderPrice:600,orderUnit:'箱',customerUnit:'包',stock:10,image:'',orderVisible:true,customerVisible:true});assert.equal(r.status,201);assert.equal(r.data.code,'P'+n);}
 // Historical orders capture the old displayed number, before the insert.
 for(const id of ['p36','p198']){const p=await find(id);const r=await request('orders','POST',{requestId:'before-move-'+id,channel:'customer',name:'編號測試',phone:'0900000000',items:[{id,qty:2,price:p.price,unit:p.customerUnit}]},false);assert.equal(r.status,201);}
 layout=await catalog();const r=await request('admin/catalog/reorder','POST',{ids:['p198','p199','p200'],afterId:'p35',revision:layout.revision});assert.equal(r.status,200);layout=r.data;contiguous(layout);
 assert.deepEqual(layout.products.slice(34,39).map(p=>[p.id,p.code]),[['p35','P35'],['p198','P36'],['p199','P37'],['p200','P38'],['p36','P39']]);
 for(const path of ['products?channel=order','products?channel=customer']){const pub=(await request(path,'GET',undefined,false)).data;assert.deepEqual(pub.slice(34,39).map(p=>p.id),['p35','p198','p199','p200','p36']);}
 for(const p of before){const now=layout.products.find(x=>x.id===p.id);assert.equal(now.price,p.price);assert.equal(now.stock,p.stock===null?null:p.stock-(p.id==='p36'?2:0));}
 const orders=(await request('staff/orders','GET',undefined,false)).data;assert.equal(orders.find(o=>o.requestFingerprint&&o.items[0].id==='p198').items[0].code,'P198');assert.equal(orders.find(o=>o.items[0].id==='p36').items[0].code,'P36');
});

test('刪除補齊，舊訂單仍可出退貨並回補正確商品，還原附加最後',async()=>{
 let layout=await catalog(),p=layout.products.find(p=>p.id==='p198');assert.equal(p.code,'P36');const oldStock=p.stock;
 let r=await request('admin/catalog/delete','POST',{ids:['p198'],revision:layout.revision});assert.equal(r.status,200);layout=r.data;contiguous(layout);assert.equal(layout.products.length,199);assert.equal(layout.products[35].id,'p199');assert.equal(layout.products[35].code,'P36');assert.equal(layout.deletedProducts[0].id,'p198');
 assert.equal((await request('products?channel=customer','GET',undefined,false)).data.some(p=>p.id==='p198'),false);
 assert.equal((await request('orders','POST',{requestId:'deleted-stale',channel:'customer',name:'測試',phone:'0900000000',items:[{id:'p198',qty:1,price:p.price}]},false)).status,409);
 assert.equal((await request('admin/products/p198','PATCH',{...p,price:1})).status,409);
 let o=(await request('staff/orders','GET',undefined,false)).data.find(o=>o.items[0].id==='p198');
 o=(await request('staff/orders/'+o.id,'PATCH',{revision:o.revision,action:'ship'},false)).data;
 o=(await request('staff/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:'p198',qty:1}]},false)).data;
 assert.equal(o.returns[0].code,'P198');assert.equal((await find('p198')).stock,oldStock+1);assert.equal((await find('p199')).stock,10);
 const original=(await find('p36')).stock;let other=(await request('staff/orders','GET',undefined,false)).data.find(o=>o.items[0].id==='p36');other=(await request('staff/orders/'+other.id,'PATCH',{revision:other.revision,action:'ship'},false)).data;await request('staff/orders/'+other.id,'PATCH',{revision:other.revision,action:'return',items:[{id:'p36',qty:1}]},false);assert.equal((await find('p36')).stock,original+1);
 layout=await catalog();r=await request('admin/catalog/restore','POST',{id:'p198',revision:layout.revision});assert.equal(r.status,200);layout=r.data;contiguous(layout);p=layout.products.at(-1);assert.equal(p.id,'p198');assert.equal(p.code,'P200');assert.equal(p.stock,oldStock+1);assert.equal(p.customerUnit,'包');assert.equal(p.orderUnit,'箱');assert.equal(p.orderVisible,true);assert.equal(p.customerVisible,true);
});

test('目錄操作驗證權限、插入位置、重複選取、版本衝突與整批原子性',async()=>{
 let layout=await catalog();const payload={ids:['p198'],afterId:'p35',revision:layout.revision};
 for(const action of ['reorder','delete','restore'])assert.equal((await request('admin/catalog/'+action,'POST',payload,false)).status,401);
 for(const body of [{...payload,ids:['p198','p198']},{...payload,ids:['unknown']},{...payload,afterId:'p198'}])assert.equal((await request('admin/catalog/reorder','POST',body)).status,400);
 assert.equal((await catalog()).revision,layout.revision);
 const race=await Promise.all([request('admin/catalog/reorder','POST',payload),request('admin/catalog/delete','POST',{ids:['p199'],revision:layout.revision})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const winner=race.find(r=>r.status===200).data;layout=await catalog();assert.equal(layout.revision,winner.revision);assert.deepEqual(layout.products.map(p=>[p.id,p.code]),winner.products.map(p=>[p.id,p.code]));contiguous(layout);
 // Stale layout operations cannot overwrite a subsequently added product.
 const old=layout;const added=await request('admin/products','POST',{name:'新增後衝突',category:'測試',type:'豆製品',storage:'冷藏',price:20,stock:null,image:'',orderVisible:true,customerVisible:true});assert.equal(added.status,201);
 assert.equal((await request('admin/catalog/reorder','POST',{ids:['p198'],afterId:null,revision:old.revision})).status,409);assert.ok((await catalog()).products.some(p=>p.id===added.data.id));contiguous(await catalog());
 assert.equal(sql.prepare('SELECT count(*) AS n FROM mutation_guards').get().n,0);
});

test('已編排目錄重啟初始化不改號；刪除全部不會重新灌入舊商品',async()=>{
 const before=await catalog(),repo=createRepository(db);await repo.initialize();assert.deepEqual((await catalog()).products.map(p=>[p.id,p.code]),before.products.map(p=>[p.id,p.code]));
 const result=await request('admin/catalog/delete','POST',{ids:before.products.map(p=>p.id),revision:before.revision});assert.equal(result.status,200);assert.equal(result.data.products.length,0);await repo.seed();await repo.initialize();assert.equal((await catalog()).products.length,0);
 const added=await request('admin/products','POST',{name:'重新開始',category:'測試',type:'豆製品',storage:'冷藏',price:20,stock:null,image:'',orderVisible:true,customerVisible:true});assert.equal(added.status,201);assert.equal(added.data.code,'P1');assert.notEqual(added.data.id,'p1');
});
