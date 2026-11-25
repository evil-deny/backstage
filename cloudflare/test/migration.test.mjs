import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {snapshotDatabase,snapshotToSql,createBackup,readBackup} from '../snapshot.mjs';
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
test('永久刪除只允許管理員、要求確認，並阻擋已結帳及退貨抵扣的訂單',async()=>{const body={action:'purge',revision:1,confirmPermanent:true};assert.equal((await request('staff/orders/FY-purge',body,staffToken)).status,403);assert.equal((await request('admin/orders/FY-purge',{action:'purge',revision:1})).status,400);sql.prepare('INSERT INTO billing_invoices VALUES(?,?)').run('bill-test',JSON.stringify({credits:[{orderId:order.id}]}));assert.equal((await request('admin/orders/FY-purge',body)).status,409);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_records').get().n,1);sql.prepare('DELETE FROM billing_invoices WHERE id=?').run('bill-test');assert.equal((await request('admin/orders/FY-purge',{...body,revision:99})).status,409);const result=await request('admin/orders/FY-purge',body);assert.equal(result.status,200);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_records').get().n,0);assert.equal(sql.prepare('SELECT stock FROM inventory').get().stock,20);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_tombstones').get().n,1);const repeated=await handleBackstage(new Request('https://api.example.test/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({requestId:'request-purge',channel:'order',name:'測試人',items:[]})}),db,config);assert.equal(repeated.status,410);});
