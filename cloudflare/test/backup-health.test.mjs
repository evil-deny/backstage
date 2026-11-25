import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {backupHealth} from '../backup-health.mjs';
const now=Date.now(),iso=age=>new Date(now-age).toISOString();
const db=(latest,success)=>({prepare(){return {};},async batch(){return [{results:latest?[latest]:[]},{results:success?[success]:[]}];}});
test('備份狀態辨識成功、失敗、停滯及缺少備份，公開結果不含明細',async()=>{
 assert.deepEqual(await backupHealth(db({status:'complete',started_at:iso(1000)},{completed_at:iso(1000)}),now),{ok:true,code:'ok'});
 assert.equal((await backupHealth(db({status:'failed',started_at:iso(1000)},{completed_at:iso(1000)}),now)).code,'failed');
 assert.equal((await backupHealth(db({status:'running',started_at:iso(31*60000)},{completed_at:iso(1000)}),now)).code,'running_too_long');
 assert.equal((await backupHealth(db(null,null),now)).code,'stale');
 assert.equal((await backupHealth(db({status:'complete',started_at:iso(37*3600000)},{completed_at:iso(37*3600000)}),now)).code,'stale');
});
test('Email 警示寄到指定信箱、避免重複寄送，恢復後通知一次',()=>{
 const messages=[],properties={};let healthy=false;
 const context={MailApp:{sendEmail:message=>messages.push(message)},UrlFetchApp:{fetch:()=>({getResponseCode:()=>healthy?200:503,getContentText:()=>JSON.stringify({ok:healthy,code:healthy?'ok':'failed'})})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key],setProperties:values=>Object.assign(properties,values),deleteProperty:key=>delete properties[key]})},Date,ScriptApp:{getProjectTriggers:()=>[]}};
 vm.createContext(context);vm.runInContext(readFileSync('google-backup-alerts.gs','utf8'),context);
 context.checkBackupHealth();context.checkBackupHealth();assert.equal(messages.length,1);assert.equal(messages[0].to,'gooddenny931213@gmail.com');
 healthy=true;context.checkBackupHealth();context.checkBackupHealth();assert.equal(messages.length,2);assert.match(messages[1].subject,/恢復/);
});
