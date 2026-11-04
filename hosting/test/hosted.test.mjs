import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
mkdirSync('.sites-runtime/test',{recursive:true});
await build({entryPoints:['lib/backstage.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/backstage.mjs'});
const {handleBackstage}=await import('../.sites-runtime/test/backstage.mjs');
const {analyze}=await import('../public/metrics.js');
const {catalogOrder,catalogGroups}=await import('../public/catalog-order.js');
await build({entryPoints:['lib/google-access.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test/access.mjs'});
const {pkce,digest}=await import('../.sites-runtime/test/access.mjs');
const config={ADMIN_EMAILS:'owner@example.test',GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'};
const adminToken='a'.repeat(64);
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
function prepare(query,args=[]){return {bind(...values){return prepare(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},_run(){const statement=sql.prepare(query);return statement.columns().length?{results:statement.all(...args)}:statement.run(...args);}};}
const db={prepare,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s._run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
await db.prepare('INSERT INTO api_grants(hash,expires,provider,subject,email,audience) VALUES(?,?,?,?,?,?)').bind(await digest(adminToken),Date.now()+8*3600000,'google','test-owner','owner@example.test',config.GOOGLE_CLIENT_ID).run();
async function request(path,method='GET',body,auth=true,origin){const headers={...(auth?{Authorization:'Bearer '+adminToken}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})};const r=await handleBackstage(new Request('https://site.example'+path,{method,headers,body:body?JSON.stringify(body):undefined}),db,config);return {status:r.status,data:r.status===204?null:await r.json(),headers:r.headers};}

test('批發與顧客單位獨立同步、歷史快照、退貨與分析保持原單位',async()=>{
 const legacy=(await request('/api/products')).data[0];assert.equal(legacy.unit,'件');
 let p=(await request('/api/admin/products','POST',{name:'雙單位測試',category:'測試',type:'豆製品',storage:'冷藏',image:'',price:60,orderPrice:600,orderUnit:'箱',customerUnit:'包',stock:null,orderVisible:true,customerVisible:true})).data;assert.equal(p.id,'p198');
 for(const [channel,unit,price] of [['order','箱',600],['customer','包',60]]){
  const pub=(await request('/api/products?channel='+channel)).data.find(x=>x.id===p.id);assert.equal(pub.unit,unit);assert.equal(pub.price,price);assert.equal('orderUnit' in pub,false);assert.equal('customerUnit' in pub,false);
 }
 const payload=(channel,unit)=>({requestId:'units-'+channel,channel,name:'單位測試',phone:'0900000000',items:[{id:p.id,qty:2,price:channel==='order'?600:60,unit}]});
 assert.equal((await request('/api/orders','POST',payload('order','包'),false)).status,409);
 const a=await request('/api/orders','POST',payload('order','箱'),false),b=await request('/api/orders','POST',payload('customer','包'),false);assert.equal(a.status,201);assert.equal(b.status,201);
 p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,orderUnit:'盒',customerUnit:'袋'})).data;
 assert.equal(p.orderUnit,'盒');assert.equal(p.customerUnit,'袋');
 // Old callers that only update visibility must preserve both saved units.
 const {orderUnit,customerUnit,...withoutUnits}=p;p=(await request('/api/admin/products/'+p.id,'PATCH',{...withoutUnits,customerVisible:false})).data;assert.equal(p.orderUnit,'盒');assert.equal(p.customerUnit,'袋');
 for(const unit of ['', 'a'.repeat(21),12])assert.equal((await request('/api/admin/products/'+p.id,'PATCH',{...p,orderUnit:unit})).status,400);
 assert.equal((await request('/api/orders','POST',{...payload('order','箱'),requestId:'units-stale'},false)).status,409);
 // A concurrent unit edit after validation is also rejected by the atomic reservation.
 const repo=(await import('../.sites-runtime/test/backstage.mjs')).createRepository(db);
 await assert.rejects(repo.place({id:'unit-race',channel:'order',items:[{id:p.id,qty:1,price:600,unit:'箱'}]},'unit-race'));assert.equal(await repo.findRequest('unit-race'),null);
 const orders=[];
 for(const [result,unit] of [[a,'箱'],[b,'包']]){
  let o=(await request('/api/staff/orders', 'GET',undefined,false)).data.find(o=>o.id===result.data.id);assert.equal(o.items[0].unit,unit);
  o=(await request('/api/staff/orders/'+o.id,'PATCH',{revision:o.revision,action:'ship'},false)).data;
  o=(await request('/api/staff/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:p.id,qty:1}]},false)).data;assert.equal(o.returns[0].unit,unit);orders.push(o);
 }
 const metrics=analyze(orders);assert.equal(metrics.rows.length,2);assert.deepEqual(metrics.rows.map(r=>r.unit).sort(),['包','箱']);assert.equal(metrics.revenue,660);assert.ok(metrics.rows.every(r=>r.net===1));
 // Keep independent pre-existing tests' shared fixture unchanged.
 sql.prepare('DELETE FROM order_records WHERE id IN (?,?)').run(a.data.id,b.data.id);sql.prepare('DELETE FROM inventory WHERE id=?').run(p.id);
});
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
 const winner=race.find(r=>r.status===201),winnerId=race[0].status===201?'a':'b';assert.equal((await request('/api/orders','POST',payload(winnerId))).data.id,winner.data.id);assert.equal((await request('/api/orders','POST',payload(winnerId,1))).status,409);
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

test('Google 登入驗證簽章、audience、issuer、驗證信箱、nonce、PKCE 與舊登入撤銷',async()=>{
 const origin='https://evil-deny.github.io';
 const preflight=await request('/api/admin/products','OPTIONS',undefined,false,origin);assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'test-google',alg:'RS256',use:'sig'};
 const originalFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});};
 try{
  const verifier='b'.repeat(64),challenge=await pkce(verifier);
  const start=await request('/api/auth/google/start','POST',{challenge},false,origin);assert.equal(start.status,200);assert.equal(start.data.clientId,config.GOOGLE_CLIENT_ID);
  const sign=async(extra={},options={})=>new SignJWT({email:'owner@example.test',email_verified:true,nonce:start.data.nonce,...extra}).setProtectedHeader({alg:'RS256',kid:'test-google'}).setSubject('google-subject-123').setIssuer(options.issuer??'https://accounts.google.com').setAudience(options.audience??config.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime(options.expiration??'10m').sign(privateKey);
  const credential=await sign();
  const login=(token,secret=verifier)=>request('/api/auth/google','POST',{credential:token,verifier:secret},false,origin);
  assert.equal((await login(await sign({},{audience:'attacker.apps.googleusercontent.com'}))).status,401);
  assert.equal((await login(await sign({},{issuer:'https://evil.example'}))).status,401);
  assert.equal((await login(await sign({},{expiration:Math.floor(Date.now()/1000)-60}))).status,401);
  assert.equal((await login(await sign({email_verified:false}))).status,401);
  assert.equal((await login(await sign({email:'other@example.test'}))).status,403);
  assert.equal((await login(await sign({nonce:'c'.repeat(64)}))).status,401);
  assert.equal((await login(credential,'c'.repeat(64))).status,401);
  const tampered=credential.split('.');tampered[2]=(tampered[2][0]==='A'?'B':'A')+tampered[2].slice(1);assert.equal((await login(tampered.join('.'))).status,401);
  const grant=await login(credential);assert.equal(grant.status,200);assert.equal(grant.data.token.length,64);assert.equal(grant.data.email,'owner@example.test');
  assert.equal((await login(credential)).status,401);
  const authorized=()=>handleBackstage(new Request('https://site.example/api/admin/orders',{headers:{Origin:origin,Authorization:'Bearer '+grant.data.token}}),db,config);
  assert.equal((await authorized()).status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM api_grants WHERE hash=?').get(grant.data.token).n,0);
  await handleBackstage(new Request('https://site.example/api/logout',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+grant.data.token,'Content-Type':'application/json'},body:'{}'}),db,config);assert.equal((await authorized()).status,401);
  assert.equal((await request('/api/auth/exchange','POST',{code:'a'.repeat(64),verifier},false)).status,410);
  const native=await handleBackstage(new Request('https://site.example/api/admin/orders',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),db,config);assert.equal(native.status,401);
  const legacyToken='d'.repeat(64);await db.prepare('INSERT INTO api_grants(hash,expires) VALUES(?,?)').bind(await digest(legacyToken),Date.now()+3600000).run();
  const legacy=await handleBackstage(new Request('https://site.example/api/admin/orders',{headers:{Authorization:'Bearer '+legacyToken}}),db,config);assert.equal(legacy.status,401);
  const missing=await handleBackstage(new Request('https://site.example/api/auth/google/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge})}),db,{});assert.equal(missing.status,503);
  const expired=await request('/api/auth/google/start','POST',{challenge},false);await db.prepare('UPDATE google_login_challenges SET expires=0 WHERE hash=?').bind(await digest(expired.data.nonce)).run();assert.equal((await login(await sign({nonce:expired.data.nonce}))).status,401);
 }finally{globalThis.fetch=originalFetch;}
});

test('顧客免登入送單，員工流程保留揀貨、部分出貨與自訂品項',async()=>{
 const all=(await request('/api/admin/products')).data,p=all.find(p=>p.stock>=3&&p.customerVisible&&p.price>0),q=all.find(q=>q.id!==p.id&&q.stock>=3&&q.orderVisible&&q.price>0);
 const publicOrder=await request('/api/orders','POST',{requestId:'public-customer',channel:'customer',name:'顧客',phone:'0900000000',items:[{id:p.id,qty:1,price:p.price}]},false,'https://evil-deny.github.io');assert.equal(publicOrder.status,201);
 const staffPayload={requestId:'staff-order',channel:'order',name:'員工測試',items:[{id:p.id,qty:1,price:p.price},{id:q.id,qty:2,price:q.price},{id:'custom-test',custom:true,name:'自訂商品',qty:1,price:75}]};
 assert.equal((await request('/api/orders','POST',staffPayload,false)).status,201);
 assert.equal((await request('/api/orders','POST',{...staffPayload,requestId:'fake-price',channel:'customer',phone:'0900000000'},false)).status,403);
 const staffResult=await request('/api/orders','POST',staffPayload);assert.equal(staffResult.status,201);let o=(await request('/api/admin/orders')).data.find(o=>o.id===staffResult.data.id);
 assert.equal((await request('/api/admin/products')).data.find(i=>i.id===q.id).stock,q.stock-2);
 o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'pick',itemId:p.id,picked:true})).data;assert.equal(o.status,'picking');
 o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'ship',pickedIds:[p.id,'custom-test']})).data;assert.equal(o.total,p.price+75);assert.equal((await request('/api/admin/products')).data.find(i=>i.id===q.id).stock,q.stock);
 assert.equal((await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:q.id,qty:1}]})).status,400);
 o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:p.id,qty:1},{id:'custom-test',qty:1}]})).data;assert.ok(o.returnClosedAt);assert.equal(o.returns.length,2);
 o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'archive'})).data;assert.ok(o.archivedAt);
 const pending=(await request('/api/admin/orders')).data.find(o=>o.id===publicOrder.data.id);const cancelled=await request('/api/admin/orders/'+pending.id,'PATCH',{revision:pending.revision,action:'cancel'});assert.equal(cancelled.data.status,'cancelled');
 assert.equal((await request('/api/admin/products')).data.find(i=>i.id===p.id).stock,p.stock);
});

test('員工免登入、雙價格隔離、庫存一致、調價保留歷史與管理權限',async()=>{
 const origin='https://evil-deny.github.io';
 let p=(await request('/api/admin/products','POST',{name:'雙價格測試',category:'測試',type:'豆製品',storage:'冷藏',image:'',price:150,orderPrice:90,stock:4,orderVisible:true,customerVisible:true})).data;
 const customer=(await request('/api/products?channel=customer','GET',undefined,false,origin)).data.find(x=>x.id===p.id);
 const staff=(await request('/api/products?channel=order','GET',undefined,false,origin)).data.find(x=>x.id===p.id);
 assert.equal(customer.price,150);assert.equal(staff.price,90);assert.equal('orderPrice' in customer,false);assert.equal('orderPrice' in staff,false);
 const payload=(channel,price,id)=>({requestId:id,channel,name:'免登入測試',...(channel==='customer'?{phone:'0900000000'}:{}),items:[{id:p.id,price,qty:1}]});
 assert.equal((await request('/api/orders','POST',payload('customer',90,'wrong-customer'),false,origin)).status,409);
 assert.equal((await request('/api/orders','POST',payload('order',150,'wrong-staff'),false,origin)).status,409);
 const a=await request('/api/orders','POST',payload('order',90,'anonymous-staff'),false,origin);assert.equal(a.status,201);assert.equal(a.data.total,90);
 assert.equal((await request('/api/orders','POST',payload('order',90,'anonymous-staff'),false,origin)).data.id,a.data.id);
 const b=await request('/api/orders','POST',payload('customer',150,'anonymous-customer'),false,origin);assert.equal(b.status,201);assert.equal(b.data.total,150);
 p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,2);
 p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,orderPrice:80,price:160})).data;
 assert.equal((await request('/api/orders','POST',payload('order',90,'stale-staff'),false,origin)).status,409);
 assert.equal((await request('/api/orders','POST',payload('customer',150,'stale-customer'),false,origin)).status,409);
 let orders=(await request('/api/admin/orders')).data;assert.equal(orders.find(o=>o.id===a.data.id).items[0].price,90);assert.equal(orders.find(o=>o.id===b.data.id).items[0].price,150);
 assert.equal((await request('/api/admin/orders','GET',undefined,false,origin)).status,401);
 assert.equal((await request('/api/admin/products/'+p.id,'PATCH',{...p,price:1},false,origin)).status,401);
 assert.equal((await request('/api/admin/orders/'+a.data.id,'PATCH',{action:'ship',revision:1},false,origin)).status,401);
 for(const id of [a.data.id,b.data.id]){const o=orders.find(x=>x.id===id);assert.equal((await request('/api/admin/orders/'+id,'PATCH',{action:'cancel',revision:o.revision})).data.status,'cancelled');}
 assert.equal((await request('/api/admin/products')).data.find(x=>x.id===p.id).stock,4);
 p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);
 p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,orderPrice:0,orderVisible:false})).data;
 assert.equal((await request('/api/products?channel=order','GET',undefined,false)).data.some(x=>x.id===p.id),false);
 assert.equal((await request('/api/orders','POST',payload('order',0,'hidden-staff'),false)).status,409);
 assert.equal((await request('/api/admin/products/'+p.id,'PATCH',{...p,orderPrice:-1})).status,400);
 const fallback=(await request('/api/admin/products')).data.find(x=>x.id==='p1');assert.equal(fallback.orderPrice,fallback.price);
 const repo=(await import('../.sites-runtime/test/backstage.mjs')).createRepository(db);
 p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,orderVisible:true})).data;
 await assert.rejects(repo.place({id:'bad-price',channel:'order',items:[{id:p.id,qty:1,price:123}]},'atomic-price-check'));
 assert.equal((await repo.product(p.id)).stock,4);
});

test('新增員工價欄位保留既有商品、庫存與原價',()=>{
 const legacy=new DatabaseSync(':memory:');
 const files=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort();
 for(const file of files.filter(f=>!f.startsWith('0002_')))legacy.exec(readFileSync('drizzle/'+file,'utf8'));
 legacy.prepare('INSERT INTO inventory VALUES(?,?,?,?,?,?,?)').run('legacy',JSON.stringify({name:'既有商品'}),7,123,1,1,9);
 legacy.exec(readFileSync('drizzle/'+files.find(f=>f.startsWith('0002_')),'utf8'));
 const p=legacy.prepare('SELECT *,COALESCE(order_price,price) AS staff FROM inventory').get();
 assert.equal(p.stock,7);assert.equal(p.price,123);assert.equal(p.staff,123);assert.equal(p.revision,9);assert.equal(p.body,JSON.stringify({name:'既有商品'}));
 assert.throws(()=>legacy.prepare('UPDATE inventory SET order_price=-1').run(),/CHECK constraint/);
 legacy.close();
});

test('公開員工訂單保留自訂開單、揀貨、部分出貨、退貨及結案，商品管理仍受保護',async()=>{
 const origin='https://evil-deny.github.io';
 const p=(await request('/api/products?channel=order','GET',undefined,false)).data.find(p=>p.stock>=3&&p.price>0);
 const place=await request('/api/orders','POST',{requestId:'public-staff-workflow',channel:'order',name:'員工流程測試',items:[{id:p.id,price:p.price,qty:2},{id:'custom-public',name:'客製化品項',price:45,qty:1,custom:true}]},false,origin);
 assert.equal(place.status,201);
 let all=await request('/api/staff/orders','GET',undefined,false,origin);assert.equal(all.status,200);
 let o=all.data.find(o=>o.id===place.data.id);assert.equal(o.channel,'order');assert.equal(o.items.length,2);
 const patch=async body=>{const r=await request('/api/staff/orders/'+o.id,'PATCH',{revision:o.revision,...body},false,origin);assert.equal(r.status,200);o=r.data;return r;};
 await patch({action:'pick',itemId:p.id,picked:true});assert.equal(o.status,'picking');
 await patch({action:'ship',pickedIds:[p.id]});assert.equal(o.total,p.price*2);assert.equal(o.items[1].picked,false);
 const stale=await request('/api/staff/orders/'+o.id,'PATCH',{revision:o.revision-1,action:'closeReturn'},false,origin);assert.equal(stale.status,409);
 await patch({action:'return',items:[{id:p.id,qty:1}]});assert.equal(o.returns[0].qty,1);
 assert.equal((await request('/api/admin/products')).data.find(x=>x.id===p.id).stock,p.stock-1);
 await patch({action:'return',items:[{id:p.id,qty:1}]});assert.ok(o.returnClosedAt);
 assert.equal((await request('/api/admin/products')).data.find(x=>x.id===p.id).stock,p.stock);
 await patch({action:'archive'});assert.ok(o.archivedAt);
 assert.equal((await request('/api/staff/orders','GET',undefined,false,'https://elsewhere.example')).status,403);
 for(const endpoint of ['/api/admin/products','/api/admin/orders','/api/admin/backup'])assert.equal((await request(endpoint,'GET',undefined,false,origin)).status,401);
 assert.equal((await request('/api/admin/products/'+p.id,'PATCH',{...p,price:1},false,origin)).status,401);
});

test('顧客送出的訂單出現在同一份員工待出貨清單並可揀貨出貨',async()=>{
 const p=(await request('/api/products?channel=customer','GET',undefined,false)).data.find(p=>p.stock>=1&&p.price>0);
 const submitted=await request('/api/orders','POST',{requestId:'customer-to-shipping',channel:'customer',name:'顧客同步驗證',phone:'0900000000',items:[{id:p.id,price:p.price,qty:1}]},false,'https://evil-deny.github.io');assert.equal(submitted.status,201);
 const orders=(await request('/api/staff/orders','GET',undefined,false,'https://evil-deny.github.io')).data;
 let order=orders.filter(o=>!o.archivedAt&&['new','picking'].includes(o.status)).find(o=>o.id===submitted.data.id);assert.ok(order);assert.equal(order.channel,'customer');assert.equal(order.items[0].price,p.price);
 let result=await request('/api/staff/orders/'+order.id,'PATCH',{revision:order.revision,action:'pick',itemId:p.id,picked:true},false);assert.equal(result.status,200);order=result.data;
 result=await request('/api/staff/orders/'+order.id,'PATCH',{revision:order.revision,action:'ship',pickedIds:[p.id]},false);assert.equal(result.status,200);order=result.data;assert.equal(order.status,'shipped');assert.equal(order.channel,'customer');
 result=await request('/api/staff/orders/'+order.id,'PATCH',{revision:order.revision,action:'return',items:[{id:p.id,qty:1}]},false);assert.equal(result.status,200);assert.equal((await request('/api/admin/products')).data.find(x=>x.id===p.id).stock,p.stock);
});

test('新增品項原子接續固定編號，隱藏與改分類不改號，三個目錄按商品編號排序',async()=>{
 const original=(await request('/api/admin/products')).data;
 const next=Math.max(...original.filter(p=>/^p\d+$/.test(p.id)).map(p=>Number(p.id.slice(1))))+1;
 const body={name:'排序測試湯10',category:'測試',type:'湯品/鍋物',storage:'冷凍',image:'',price:10,stock:null,orderVisible:true,customerVisible:true};
 const result=await Promise.all([
  request('/api/admin/products','POST',{...body,id:'p1'}),
  request('/api/admin/products','POST',{...body,name:'排序測試湯2'}),
 ]);
 assert.ok(result.every(r=>r.status===201));assert.deepEqual(result.map(r=>r.data.id).sort(),['p'+next,'p'+(next+1)].sort());
 let a=result[0].data,b=result[1].data;
 a=(await request('/api/admin/products/'+a.id,'PATCH',{...a,orderVisible:false,customerVisible:false})).data;assert.equal(a.id,result[0].data.id);
 const c=(await request('/api/admin/products','POST',{...body,name:'排序測試冷藏',storage:'冷藏'})).data;assert.equal(c.id,'p'+(next+2));
 const d=(await request('/api/admin/products','POST',{...body,name:'排序測試新分類',type:'新增類別'})).data;assert.equal(d.id,'p'+(next+3));
 a=(await request('/api/admin/products/'+a.id,'PATCH',{...a,orderVisible:true,customerVisible:true})).data;
 const expected=[a.id,b.id,c.id,d.id];
 for(const path of ['/api/admin/products','/api/products?channel=order','/api/products?channel=customer']){
  const all=(await request(path)).data;assert.deepEqual(all.filter(p=>p.name.startsWith('排序測試')).map(p=>p.id),expected);
  const before=all.findIndex(p=>p.id===b.id),after=all.findIndex(p=>p.id===a.id);assert.ok(after<before);
 }
 const moved=(await request('/api/admin/products/'+b.id,'PATCH',{...b,storage:'乾貨',type:'醬料'})).data;assert.equal(moved.id,b.id);
 const reordered=(await request('/api/admin/products')).data;assert.deepEqual(reordered.filter(p=>p.name.startsWith('排序測試')).map(p=>p.id),expected);
 // Existing products keep their stable identifiers and remain addressable after insertion.
 for(const p of original){const saved=reordered.find(x=>x.id===p.id);assert.ok(saved);assert.equal(saved.name,p.name);}
 // Category edits preserve both the product number and its position in the catalog.
 const categoryMoved=(await request('/api/admin/products/'+b.id,'PATCH',{...moved,category:'公司庫存'})).data;assert.equal(categoryMoved.id,b.id);
 for(const endpoint of ['/api/admin/products','/api/products?channel=order','/api/products?channel=customer']){
  const rows=(await request(endpoint)).data;assert.deepEqual(rows.filter(p=>p.name.startsWith('排序測試')).map(p=>p.id),expected);
 }
});

test('商品編號為第一順位，使用數字順序且分組不打亂順序',()=>{
 const sample=[
  {id:'p1',category:'兩天一次(三五日結單/一四六到貨)',storage:'冷凍',type:'湯品/鍋物',name:'湯2'},
  {id:'p2',category:'公司庫存',storage:'乾貨',type:'醬料',name:'醬油'},
  {id:'p3',category:'公司庫存',storage:'冷凍',type:'湯品/鍋物',name:'湯10'},
  {id:'p4',category:'公司庫存',storage:'冷凍',type:'湯品/鍋物',name:'湯2'},
  {id:'p5',category:'公司庫存',storage:'冷凍',type:'丸類/火鍋料',name:'丸子'},
  {id:'p6',category:'新增分類',storage:'冷凍',type:'湯品/鍋物',name:'湯1'},
 ];
 assert.deepEqual(sample.sort(catalogOrder).map(p=>p.id),['p1','p2','p3','p4','p5','p6']);
 const numbered=[{id:'p10',category:'甲'},{id:'p2',category:'乙'},{id:'p1',category:'甲'},{id:'p-legacy',category:'甲'}].sort(catalogOrder);
 assert.deepEqual(numbered.map(p=>p.id),['p1','p2','p10','p-legacy']);
 const groups=catalogGroups(numbered,p=>p.category);assert.equal(groups.length,3);assert.deepEqual(groups.flatMap(([,items])=>items).map(p=>p.id),['p1','p2','p10','p-legacy']);
 for(const template of ['employee','customer'])assert.match(readFileSync('templates/'+template+'.html','utf8'),/catalogGroups\(/);
});
