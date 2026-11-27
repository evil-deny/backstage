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
