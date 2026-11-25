import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {snapshotToSql,validateSnapshot,BUSINESS_TABLES} from './snapshot.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('用法：node restore.mjs <backup.json> <restore.sql>（只產生 SQL，不修改雲端資料）');
const snapshot=validateSnapshot(JSON.parse(readFileSync(input,'utf8'))),sql=snapshotToSql(snapshot);
const check=new DatabaseSync(':memory:');
check.exec(sql);
for(const name of BUSINESS_TABLES){const rows=check.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all();if(JSON.stringify(rows)!==JSON.stringify(snapshot.tables[name].rows))throw Error('還原驗證失敗：'+name);}
writeFileSync(output,sql,{mode:0o600});
console.log(JSON.stringify({verified:true,counts:Object.fromEntries(BUSINESS_TABLES.map(name=>[name,snapshot.tables[name].rows.length]))}));
