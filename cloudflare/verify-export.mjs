import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {BUSINESS_TABLES,readBackup} from './snapshot.mjs';
const [exportFile,snapshotFile,mode]=process.argv.slice(2),sql=new DatabaseSync(':memory:');sql.exec(readFileSync(exportFile,'utf8'));
if(mode==='backups'){
 const latest=sql.prepare("SELECT id FROM backup_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").get();
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args);},async all(){return {results:sql.prepare(query).all(...args)};}};}};
 const restored=await readBackup(db,latest.id),original=JSON.parse(readFileSync(snapshotFile,'utf8'));
 if(JSON.stringify(restored.tables)!==JSON.stringify(original.tables))throw Error('備份資料與搬遷資料不一致');console.log(JSON.stringify({backupVerified:true,id:latest.id}));
}else{
 const snapshot=JSON.parse(readFileSync(snapshotFile,'utf8')),counts={};
 const stable=row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));
 for(const name of BUSINESS_TABLES){const rows=sql.prepare('SELECT * FROM "'+name+'"').all().map(stable).sort(),expected=snapshot.tables[name].rows.map(stable).sort();if(JSON.stringify(rows)!==JSON.stringify(expected))throw Error('雲端匯入資料不一致：'+name);counts[name]=rows.length;}
 console.log(JSON.stringify({remoteDataVerified:true,counts}));
}
