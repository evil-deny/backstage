import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync('templates/employee.html','utf8'),start=html.indexOf('    async function submitPendingOrder()'),end=html.indexOf('    async function cloudAction',start),fn=html.slice(start,end);
test('分享送單與一般送單共用請求，並行及再次分享只送一次；逾時重試沿用同一編號',async()=>{
 let calls=0,clears=0,fail=false;const ids=[];
 const context=vm.createContext({FuyuanCloud:{random:()=> 'request-fixed',notice:()=>{},place:async payload=>{calls++;ids.push(payload.requestId);if(fail)throw Error('timeout');return {id:'order-1'};}},product:()=>({name:'豆腐'}),itemPrice:i=>i.price,clearCart:()=>{clears++;},orderLabel:id=>id,document:{querySelectorAll:()=>[]}});
 vm.runInContext("let cloudRequestId=null;let pendingOrder={name:'測試',note:'',items:[{id:'p1',qty:1,price:10}]};"+fn,context);
 await Promise.all([vm.runInContext('submitPendingOrder()',context),vm.runInContext('submitPendingOrder()',context)]);await vm.runInContext('submitPendingOrder()',context);assert.equal(calls,1);assert.equal(clears,1);
 vm.runInContext("pendingOrder={name:'測試',items:[{id:'p1',qty:1,price:10}]};",context);fail=true;await assert.rejects(vm.runInContext('submitPendingOrder()',context),/timeout/);fail=false;await vm.runInContext('submitPendingOrder()',context);assert.deepEqual(ids,['request-fixed','request-fixed','request-fixed']);assert.equal(clears,2);
});
