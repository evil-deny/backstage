import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {snapshotDatabase,snapshotToSql,createBackup,readBackup,sanitizeBackup,pendingBackupCleanup} from '../snapshot.mjs';
mkdirSync('dist/test',{recursive:true});
await build({entryPoints:['../hosting/lib/backstage.ts'],bundle:true,platform:'node',format:'esm',alias:{jose:fileURLToPath(new URL('../node_modules/jose/dist/webapi/index.js',import.meta.url))},outfile:'dist/test/backend.mjs'});
const {handleBackstage}=await import('../dist/test/backend.mjs');
function wrap(sql){
 function prepare(query,args=[]){return {
  bind(...values){return prepare(query,values);},
  async first(){return sql.prepare(query).get(...args)||null;},
  async all(){return {results:sql.prepare(query).all(...args)};},
  async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},
  _run(){const s=sql.prepare(query);return s.columns().length?{results:s.all(...args)}:{meta:{changes:Number(s.run(...args).changes)}};}
 };}
 return {prepare,async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s._run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
const sql=new DatabaseSync(':memory:');for(const name of readdirSync('../hosting/drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('../hosting/drizzle/'+name,'utf8'));
const db=wrap(sql),backupSql=new DatabaseSync(':memory:');backupSql.exec(readFileSync('backup-schema.sql','utf8'));const backups=wrap(backupSql);
sql.prepare('INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?)').run('p1',JSON.stringify({id:'p1',name:"測試'商品",category:'公司庫存',storage:'乾貨',type:'其他',displayNumber:1}),20,50,1,1,1,40);
sql.prepare('INSERT INTO catalog_state VALUES(?,?)').run('main',2);sql.prepare('INSERT INTO billing_state VALUES(?,?)').run('main',1);sql.prepare('INSERT INTO staff_members VALUES(?,?)').run('staff@example.test','2026-11-25');
const config={ADMIN_EMAILS:'owner@example.test',GOOGLE_CLIENT_ID:'migration-test.apps.googleusercontent.com'},token='a'.repeat(64),staffToken='b'.repeat(64);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
for(const [t,email,provider]of [[token,'owner@example.test','google'],[staffToken,'staff@example.test','google_staff']])sql.prepare('INSERT INTO api_grants(hash,expires,provider,subject,email,audience) VALUES(?,?,?,?,?,?)').run(await digest(t),Date.now()+3600000,provider,email,email,config.GOOGLE_CLIENT_ID);
const order={id:'FY-purge',channel:'order',name:'測試人',phone:'',note:'',createdAt:new Date().toISOString(),status:'cancelled',items:[],returns:[],total:0,market:false,revision:1,deletedAt:new Date().toISOString()};
sql.prepare('INSERT INTO order_records VALUES(?,?,?,?)').run(order.id,'request-purge',JSON.stringify(order),1);
async function request(path,body,auth=token){const r=await handleBackstage(new Request('https://api.example.test/api/'+path,{method:'PATCH',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)}),db,config);return {status:r.status,body:await r.json()};}

test('完整備份可在空資料庫還原，包含白名單但不包含登入憑證',async()=>{const snapshot=await snapshotDatabase(db),restored=new DatabaseSync(':memory:');restored.exec(snapshotToSql(snapshot));assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM staff_members').get().n,1);assert.equal(restored.prepare('SELECT stock FROM inventory').get().stock,20);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM api_grants').get().n,0);assert.equal(restored.prepare('SELECT body FROM order_records').get().body,JSON.stringify(order));});
test('每日備份驗證校驗碼；資料被破壞時拒絕下載還原',async()=>{const result=await createBackup(db,backups);assert.equal((await readBackup(backups,result.id)).tables.inventory.rows.length,1);backupSql.prepare('UPDATE backup_chunks SET body=? WHERE backup_id=? AND part=0').run('tampered',result.id);await assert.rejects(readBackup(backups,result.id),/校驗碼/);});
test('永久刪除清除關聯帳款及舊備份，保留其他訂單並防止重送',async()=>{
 const body={action:'purge',revision:1,confirmPermanent:true};
 assert.equal((await request('staff/orders/FY-purge',body,staffToken)).status,403);
 assert.equal((await request('admin/orders/FY-purge',{action:'purge',revision:1})).status,400);
 const other={...order,id:'FY-keep',name:'其他人'};
 sql.prepare('INSERT INTO order_records VALUES(?,?,?,?)').run(other.id,'request-keep',JSON.stringify(other),1);
 const bills=[{id:'bill-test',orders:[{id:order.id},{id:other.id}],lines:[{orderId:order.id,name:'測試商品'}],credits:[],person:{name:order.name}}, {id:'bill-credit',orders:[],lines:[],credits:[{key:'manual:return-test'}]}, {id:'bill-unrelated',orders:[],lines:[],credits:[]}];
 for(const b of bills)sql.prepare('INSERT INTO billing_invoices VALUES(?,?)').run(b.id,JSON.stringify(b));
 sql.prepare('INSERT INTO billing_claims VALUES(?,?)').run(order.id,'bill-test');sql.prepare('INSERT INTO billing_claims VALUES(?,?)').run(other.id,'bill-test');
 sql.prepare('INSERT INTO billing_manual_returns VALUES(?,?)').run('return-test',JSON.stringify({id:'return-test',invoiceId:'bill-test',name:'手填退貨'}));
 const saved=await createBackup(db,backups);
 const preview=(await request('admin/orders/FY-purge',{action:'purgePreview',revision:1})).body;
 assert.equal(preview.invoiceIds.length,2);assert.deepEqual(preview.releasedOrderIds,[other.id]);
 assert.equal((await request('admin/orders/FY-purge',{...body,revision:99,billingRevision:preview.billingRevision})).status,409);
 assert.equal((await request('admin/orders/FY-purge',{...body,billingRevision:999})).status,409);
 const result=await request('admin/orders/FY-purge',{...body,billingRevision:preview.billingRevision});assert.equal(result.status,200);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_records').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM billing_claims').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM billing_manual_returns').get().n,0);
 assert.deepEqual(sql.prepare('SELECT id FROM billing_invoices').all().map(r=>r.id),['bill-unrelated']);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,20);
 const marker=sql.prepare('SELECT * FROM order_tombstones').get();assert.match(marker.request_id,/^sha256:/);assert.match(marker.order_id,/^sha256:/);assert.equal(JSON.stringify(marker).includes('FY-purge'),false);
 const filtered=await readBackup(backups,saved.id,db);assert.equal(filtered.tables.order_records.rows.some(r=>r.id===order.id),false);assert.equal(filtered.tables.billing_invoices.rows.length,1);
 assert.equal((await pendingBackupCleanup(db,backups)).ids.includes(saved.id),true);
 for(const r of backupSql.prepare('SELECT id FROM backup_runs WHERE id<>?').all(saved.id))backupSql.prepare('DELETE FROM backup_runs WHERE id=?').run(r.id);
 await sanitizeBackup(db,backups,saved.id);assert.equal((await pendingBackupCleanup(db,backups)).ids.length,0);
 const cleaned=await readBackup(backups,saved.id);assert.equal(cleaned.tables.order_records.rows.some(r=>r.id===order.id),false);
 const raw=backupSql.prepare('SELECT body FROM backup_chunks WHERE backup_id=? ORDER BY part').all(saved.id).map(r=>r.body).join('');assert.equal(raw.includes('FY-purge'),false);assert.equal(raw.includes('測試人'),false);assert.equal(raw.includes('request-purge'),false);
 const restored=new DatabaseSync(':memory:');restored.exec(snapshotToSql(cleaned));assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM order_records').get().n,1);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM billing_claims').get().n,0);
 const repeated=await handleBackstage(new Request('https://api.example.test/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({requestId:'request-purge',channel:'order',name:'測試人',items:[]})}),db,config);assert.equal(repeated.status,410);
 const fresh=await createBackup(db,backups);assert.equal((await readBackup(backups,fresh.id)).tables.order_records.rows.length,1);
});

test('員工可送出額外費用單，金額只計一次、重送不重複且可帶入結帳',async()=>{
 const feeItems=[{id:'fee-rent',name:'租金位子',price:5500,qty:1,unit:'筆',custom:true},{id:'fee-electricity',name:'電費',price:250,qty:1,unit:'筆',custom:true}];
 const body={requestId:'request-extra-fees',channel:'order',rentAmount:5500,name:'費用測試',phone:'',items:feeItems};
 const post=async b=>handleBackstage(new Request('https://api.example.test/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staffToken},body:JSON.stringify(b)}),db,config);
 const r=await post(body);assert.equal(r.status,201);const placed=await r.json();assert.equal(placed.total,5750);
 assert.equal((await(await post(body)).json()).id,placed.id);
 const stored=JSON.parse(sql.prepare('SELECT body FROM order_records WHERE id=?').get(placed.id).body);
 assert(stored.items.every(i=>i.category==='額外費用'&&i.unit==='筆'&&i.qty===1&&!i.market));
 assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,20);
 const picked=await request('staff/orders/'+placed.id,{action:'ship',revision:1,pickedIds:feeItems.map(i=>i.id)},staffToken);assert.equal(picked.status,200);
 const {buildBill,billingDay}=await import('../../assets/billing-model.js');
 const bill=buildBill({person:{name:'費用測試',phone:''},date:billingDay(stored.createdAt),rent:0,utilities:0,manualItems:[],marketPrices:{}},[picked.body],[],[],[]);
 assert.equal(bill.payableCents,575000);assert(bill.lines.every(i=>i.category==='額外費用'));
 for(const change of [{qty:2},{price:-1},{price:1.5},{unit:'包'},{name:'改名'}]){const invalid=await post({...body,requestId:crypto.randomUUID(),items:[{...feeItems[0],...change}]});assert.equal(invalid.status,400);}
 assert.equal((await post({...body,requestId:crypto.randomUUID(),channel:'customer',phone:'0912345678'})).status,403);
 assert.equal((await post({...body,requestId:crypto.randomUUID(),rentAmount:undefined})).status,400);
 assert.equal((await post({...body,requestId:crypto.randomUUID(),rentAmount:0})).status,400);
 assert.equal((await post({...body,requestId:crypto.randomUUID(),rentAmount:500})).status,400);
 const zero=await post({...body,requestId:crypto.randomUUID(),rentAmount:0,items:[feeItems[1]]});assert.equal(zero.status,201);assert.equal((await zero.json()).total,250);

});

test('帳號大名依實際登入信箱保存，跨裝置讀取，不能指定他人信箱',async()=>{
 const get=async(auth=staffToken)=>handleBackstage(new Request('https://api.example.test/api/staff/profile',{headers:auth?{Authorization:'Bearer '+auth}:{}}),db,config);
 assert.equal((await get('')).status,401);
 assert.equal((await(await get()).json()).name,'費用測試');
 const saved=await request('staff/profile',{name:'  保存的大名  ',email:'owner@example.test'},staffToken);assert.equal(saved.status,200);assert.equal(saved.body.name,'保存的大名');
 assert.equal((await(await get()).json()).name,'保存的大名');
 assert.equal(sql.prepare('SELECT name FROM staff_profiles WHERE email=?').get('staff@example.test').name,'保存的大名');
 assert.equal(sql.prepare('SELECT name FROM staff_profiles WHERE email=?').get('owner@example.test'),undefined);
 assert.equal((await request('staff/profile',{name:'管理員大名'},token)).status,200);
 assert.equal((await(await get(token)).json()).name,'管理員大名');assert.equal((await(await get()).json()).name,'保存的大名');
 assert.equal((await request('staff/profile',{name:''},staffToken)).status,400);assert.equal((await request('staff/profile',{name:'名'.repeat(61)},staffToken)).status,400);
 const history=sql.prepare("SELECT body FROM order_records WHERE json_extract(body,'$.name')='費用測試' LIMIT 1").get();assert(history);
 const snapshot=await snapshotDatabase(db);assert.equal(snapshot.version,2);assert(snapshot.tables.staff_profiles.rows.some(r=>r.name==='保存的大名'));
 const restored=new DatabaseSync(':memory:');restored.exec(snapshotToSql(snapshot));assert.equal(restored.prepare('SELECT name FROM staff_profiles WHERE email=?').get('staff@example.test').name,'保存的大名');
 const legacy=structuredClone(snapshot);legacy.version=1;delete legacy.tables.staff_profiles;legacy.schemaSql=legacy.schemaSql.replace(/CREATE TABLE[^;]*staff_profiles[^;]*;/g,'');
 const oldRestored=new DatabaseSync(':memory:');oldRestored.exec(snapshotToSql(legacy));assert.equal(oldRestored.prepare('SELECT COUNT(*) AS n FROM staff_profiles').get().n,0);
 const invalid=structuredClone(snapshot);delete invalid.tables.staff_profiles;assert.throws(()=>snapshotToSql(invalid),/staff_profiles/);
});

test('訂購五件預設全數，實出三件只收三件，釋放庫存且退貨不超過三件',async()=>{
 const post=async b=>handleBackstage(new Request('https://api.example.test/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staffToken},body:JSON.stringify(b)}),db,config);
 const result=await post({requestId:crypto.randomUUID(),channel:'order',name:'部分出貨測試',phone:'',rentAmount:0,items:[{id:'p1',qty:5,price:40,unit:'件'}]});assert.equal(result.status,201);const placed=await result.json(),path='staff/orders/'+placed.id;
 let current=JSON.parse(sql.prepare('SELECT body FROM order_records WHERE id=?').get(placed.id).body);
 assert.equal(current.items[0].picked,true);assert.equal(current.items[0].pickQty,5);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,15);
 assert.equal((await request(path,{action:'pick',revision:1,itemId:'p1',qty:6},staffToken)).status,400);
 const picked=await request(path,{action:'pick',revision:1,itemId:'p1',qty:3},staffToken);assert.equal(picked.status,200);assert.equal(picked.body.items[0].pickQty,3);
 // Fresh GET, rather than browser state, retains the saved shipping quantity.
 const reload=await handleBackstage(new Request('https://api.example.test/api/staff/orders',{headers:{Authorization:'Bearer '+staffToken}}),db,config);assert.equal((await reload.json()).find(o=>o.id===placed.id).items[0].pickQty,3);
 assert.equal((await request(path,{action:'ship',revision:2,shipQuantities:[{id:'p1',qty:6}]},staffToken)).status,400);
 const shipped=await request(path,{action:'ship',revision:2,shipQuantities:[{id:'p1',qty:3}]},staffToken);assert.equal(shipped.status,200);assert.equal(shipped.body.items[0].qty,5);assert.equal(shipped.body.items[0].shippedQty,3);assert.equal(shipped.body.total,120);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,17);
 assert.equal((await request(path,{action:'ship',revision:2,shipQuantities:[{id:'p1',qty:3}]},staffToken)).status,409);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,17);
 const {buildBill,billingDay,returnCredits}=await import('../../assets/billing-model.js');const {analyze}=await import('../../assets/metrics.js');const {summarizeDaily}=await import('../../assets/daily-summary-model.js');
 const bill=buildBill({person:{name:'部分出貨測試',phone:''},date:billingDay(shipped.body.createdAt),rent:0,utilities:0,manualItems:[],marketPrices:{}},[shipped.body],[],[],[]);assert.equal(bill.lines[0].qty,3);assert.equal(bill.payableCents,12000);assert.equal(analyze([shipped.body]).qty,3);
 const summary=summarizeDaily([shipped.body],[],[],{date:billingDay(shipped.body.createdAt)});assert.equal(summary.rows[0].qty,5);assert.equal(summary.rows[0].shippedQty,3);
 assert.equal((await request(path,{action:'return',revision:3,items:[{id:'p1',qty:4}]},staffToken)).status,400);
 const returned=await request(path,{action:'return',revision:3,items:[{id:'p1',qty:1}]},staffToken);assert.equal(returned.status,200);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,18);assert.equal(analyze([returned.body]).revenue,80);assert.equal(returnCredits([returned.body],[{...bill,id:'test-bill'}],bill.person)[0].amountCents,4000);
 const rest=await request(path,{action:'return',revision:4,items:[{id:'p1',qty:2}]},staffToken);assert.equal(rest.status,200);assert(rest.body.returnClosedAt);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,20);
});
