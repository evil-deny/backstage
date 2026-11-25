import {readFileSync,writeFileSync} from 'node:fs';
import {validateSnapshot,backupParts,sha256,BUSINESS_TABLES} from './snapshot.mjs';
const [input,output]=process.argv.slice(2),snapshot=validateSnapshot(JSON.parse(readFileSync(input,'utf8')));
const body=JSON.stringify(snapshot),parts=backupParts(body),id=new Date().toISOString().replaceAll(':','-')+'-migration',date=new Date().toISOString();
const q=value=>"'"+value.replaceAll("'","''")+"'",counts=Object.fromEntries(BUSINESS_TABLES.map(name=>[name,snapshot.tables[name].rows.length]));
let sql=`INSERT INTO backup_runs(id,started_at,completed_at,status,sha256,byte_length,chunk_count,counts) VALUES(${q(id)},${q(date)},${q(date)},'complete',${q(await sha256(body))},${new TextEncoder().encode(body).length},${parts.length},${q(JSON.stringify(counts))});\n`;
parts.forEach((part,index)=>{sql+=`INSERT INTO backup_chunks(backup_id,part,body) VALUES(${q(id)},${index},${q(part)});\n`;});
writeFileSync(output,sql,{mode:0o600});console.log(JSON.stringify({id,parts:parts.length,counts}));
