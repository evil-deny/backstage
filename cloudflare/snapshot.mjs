export const BUSINESS_TABLES=['inventory','order_records','catalog_state','billing_state','billing_invoices','billing_claims','billing_manual_returns','billing_people','staff_members','order_tombstones'];
export const ALL_TABLES=[...BUSINESS_TABLES,'api_grants','connection_tickets','google_login_challenges','mutation_guards'];
const quoteId=value=>'"'+value.replaceAll('"','""')+'"';
export const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function backupParts(body){const parts=[];for(let start=0;start<body.length;){let end=Math.min(start+60000,body.length);if(end<body.length&&/[\uD800-\uDBFF]/.test(body[end-1]))end--;parts.push(body.slice(start,end));start=end;}return parts;}

export async function snapshotDatabase(db){
 const placeholders=ALL_TABLES.map(()=>'?').join(',');
 const statements=[db.prepare(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name IN (${placeholders}) OR tbl_name IN (${placeholders})) ORDER BY CASE WHEN type='table' THEN 0 ELSE 1 END,name`).bind(...ALL_TABLES,...ALL_TABLES)];
 for(const table of BUSINESS_TABLES)statements.push(db.prepare(`PRAGMA table_info(${quoteId(table)})`),db.prepare(`SELECT * FROM ${quoteId(table)} ORDER BY rowid`));
 // D1 batch executes the reads in a single transaction, keeping stock and orders consistent.
 const results=await db.batch(statements),tables={};
 BUSINESS_TABLES.forEach((name,index)=>{tables[name]={columns:results[index*2+1].results.map(c=>c.name),rows:results[index*2+2].results};});
 return {format:'fuyuan-d1-snapshot',version:1,exportedAt:new Date().toISOString(),schemaSql:results[0].results.map(r=>r.sql+';').join('\n'),tables};
}

export function validateSnapshot(snapshot){
 if(snapshot?.format!=='fuyuan-d1-snapshot'||snapshot.version!==1||!snapshot.tables)throw Error('不支援的備份格式');
 for(const name of BUSINESS_TABLES){const t=snapshot.tables[name];if(!t||!Array.isArray(t.columns)||!t.columns.length||!Array.isArray(t.rows)||t.columns.some(c=>typeof c!=='string'||!/^[a-z_]+$/.test(c))||new Set(t.columns).size!==t.columns.length)throw Error('備份資料表不完整：'+name);
  const keys=new Set();for(const row of t.rows){if(!row||t.columns.some(c=>!(c in row))||Object.keys(row).some(c=>!t.columns.includes(c)))throw Error('備份欄位不完整：'+name);for(const v of Object.values(row))if(v!==null&&typeof v!=='string'&&!(typeof v==='number'&&Number.isFinite(v)))throw Error('備份欄位型別錯誤');const key=row.request_id??row.id??row.order_id??row.key??row.email;if(key===undefined||keys.has(key))throw Error('備份主鍵重複或遺失：'+name);keys.add(key);if('body' in row)JSON.parse(row.body);}
 }
 return snapshot;
}

export function snapshotToSql(snapshot,{includeSchema=true}={}){
 validateSnapshot(snapshot);
 if(includeSchema&&!snapshot.schemaSql)throw Error('備份未包含資料表結構，請先套用 migrations');
 const value=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
 let sql='-- 福緣素食完整業務資料備份；只可匯入空資料庫。登入憑證不還原。\n';
 if(includeSchema)sql+=snapshot.schemaSql+'\n';
 for(const name of BUSINESS_TABLES){const table=snapshot.tables[name];for(const row of table.rows)sql+=`INSERT INTO ${quoteId(name)} (${table.columns.map(quoteId).join(',')}) VALUES (${table.columns.map(c=>value(row[c])).join(',')});\n`;}
 return sql;
}

export async function createBackup(db,backups){
 const id=new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomUUID().slice(0,8),started=new Date().toISOString();
 await backups.prepare("INSERT INTO backup_runs(id,started_at,status) VALUES(?,?,'running')").bind(id,started).run();
 try{
  const snapshot=validateSnapshot(await snapshotDatabase(db)),body=JSON.stringify(snapshot),bytes=new TextEncoder().encode(body).length;
  // Fail explicitly rather than silently save a partial export near Worker memory limits.
  if(bytes>24*1024*1024)throw Error('完整備份超過 24 MB，請改用 D1 SQL 匯出並調整備份方式');
  const parts=backupParts(body);
  for(let start=0;start<parts.length;start+=20)await backups.batch(parts.slice(start,start+20).map((part,index)=>backups.prepare('INSERT INTO backup_chunks(backup_id,part,body) VALUES(?,?,?)').bind(id,start+index,part)));
  const hash=await sha256(body),counts=Object.fromEntries(BUSINESS_TABLES.map(n=>[n,snapshot.tables[n].rows.length]));
  const written=(await backups.prepare('SELECT body FROM backup_chunks WHERE backup_id=? ORDER BY part').bind(id).all()).results.map(r=>r.body).join('');
  if(await sha256(written)!==hash)throw Error('備份完整性驗證失敗');
  const completed=new Date().toISOString();
  await backups.prepare("UPDATE backup_runs SET status='complete',completed_at=?,sha256=?,byte_length=?,chunk_count=?,counts=? WHERE id=?").bind(completed,hash,bytes,parts.length,JSON.stringify(counts),id).run();
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  await backups.batch([
   backups.prepare('DELETE FROM backup_chunks WHERE backup_id IN (SELECT id FROM backup_runs WHERE started_at<? AND id<>?)').bind(cutoff,id),
   backups.prepare('DELETE FROM backup_runs WHERE started_at<? AND id<>?').bind(cutoff,id)
  ]);
  return {id,completedAt:completed,sha256:hash,byteLength:bytes,counts};
 }catch(error){await backups.prepare("UPDATE backup_runs SET status='failed',error=? WHERE id=?").bind(String(error.message||error).slice(0,300),id).run();throw error;}
}

export async function readBackup(backups,id){
 const record=await backups.prepare("SELECT * FROM backup_runs WHERE id=? AND status='complete'").bind(id).first();if(!record)throw Error('找不到完整備份');
 const parts=(await backups.prepare('SELECT part,body FROM backup_chunks WHERE backup_id=? ORDER BY part').bind(id).all()).results;
 if(parts.length!==record.chunk_count||parts.some((part,index)=>part.part!==index))throw Error('備份分段不完整');
 const body=parts.map(r=>r.body).join('');if(await sha256(body)!==record.sha256)throw Error('備份校驗碼不符');
 return validateSnapshot(JSON.parse(body));
}
