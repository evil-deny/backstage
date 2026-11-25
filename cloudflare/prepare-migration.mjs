import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase,snapshotToSql,validateSnapshot,BUSINESS_TABLES} from './snapshot.mjs';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('請指定搬遷前 JSON 與輸出 SQL 路徑');
const original=JSON.parse(readFileSync(input,'utf8'));
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync(new URL('../hosting/drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../hosting/drizzle/'+file,import.meta.url),'utf8'));
original.tables.order_tombstones??={columns:['request_id','order_id','purged_at'],rows:[]};
validateSnapshot(original);
sql.exec(snapshotToSql(original,{includeSchema:false}));
function prepare(query,args=[]){return {bind(...values){return prepare(query,values);},_all(){return {results:sql.prepare(query).all(...args)}}};}
const db={prepare,async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s._all());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const backup=validateSnapshot(await snapshotDatabase(db));
writeFileSync(output,snapshotToSql(backup),{mode:0o600});
writeFileSync(output.replace(/\.sql$/,'.json'),JSON.stringify(backup),{mode:0o600});
console.log(JSON.stringify({ready:true,counts:Object.fromEntries(BUSINESS_TABLES.map(name=>[name,backup.tables[name].rows.length]))}));
