import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {analyze,day} from '../public/metrics.js';

test('共用商品、訂單與庫存完整流程',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'backstage-test-')),dbPath=join(dir,'test.sqlite'),password='test-password-123456';let server=createApp({dbPath,password});server.listen(0,'127.0.0.1');await once(server,'listening');let base='http://127.0.0.1:'+server.address().port,cookie='';
 async function request(path,method='GET',body,auth=true,extra={}){const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth&&cookie?{Cookie:cookie}:{}),...extra},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text(),headers:r.headers};}
 t.after(async()=>{if(server.listening){await new Promise(r=>server.close(r));}rmSync(dir,{recursive:true,force:true});});
 await t.test('身份驗證與安全邊界',async()=>{
  assert.equal((await request('/api/admin/orders')).status,401);assert.equal((await request('/api/staff')).data.admin,false);
  assert.equal((await request('/api/login','POST',{password:'bad'})).status,401);
  const r=await request('/api/login','POST',{password});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/staff')).data.admin,true);
  assert.equal((await request('/api/admin/products','POST',{},true,{Origin:'https://foreign.example'})).status,403);
  assert.equal((await request('/data/backstage.sqlite')).status,404);
  for(const path of ['/','/customer','/order','/metrics.js']){const page=await request(path);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);}
 });
 let p;
 await t.test('197 項真實商品；兩入口可獨立隱藏與還原',async()=>{
  assert.equal((await request('/api/admin/products')).data.length,197);
  const r=await request('/api/admin/products','POST',{name:'測試商品',category:'測試',type:'豆製品',storage:'冷藏',image:'',price:100,stock:5,orderVisible:true,customerVisible:true});assert.equal(r.status,201);p=r.data;
  assert.equal((await request('/api/admin/products/'+p.id,'PATCH',{...p,price:-1})).status,400);
  const next=await request('/api/admin/products/'+p.id,'PATCH',{...p,customerVisible:false});assert.equal(next.status,200);
  assert.equal((await request('/api/products?channel=customer')).data.some(x=>x.id===p.id),false);assert.equal((await request('/api/products?channel=order')).data.some(x=>x.id===p.id),true);
  assert.equal((await request('/api/admin/products/'+p.id,'PATCH',p)).status,409);
  p=(await request('/api/admin/products/'+p.id,'PATCH',{...next.data,customerVisible:true})).data;
 });
 const payload=(id='request-1',qty=2)=>({requestId:id,channel:'customer',name:'王小明',phone:'0912345678',items:[{id:p.id,qty,price:100}]});let o;
 await t.test('送單防重複、保留成交價格、避免超賣',async()=>{
  const r=await request('/api/orders','POST',payload(),false);assert.equal(r.status,201);assert.equal(r.data.total,200);o=(await request('/api/admin/orders')).data[0];
  const again=await request('/api/orders','POST',payload(),false);assert.equal(again.data.id,o.id);p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,3);
  assert.equal((await request('/api/orders','POST',{...payload('staff'),channel:'order'},false)).status,401);
  assert.equal((await request('/api/orders','POST',payload('too-many',4),false)).status,409);
  assert.equal((await request('/api/orders','POST',{...payload('duplicate'),items:[...payload().items,...payload().items]},false)).status,400);
  assert.equal((await request('/api/orders','POST',payload('decimal',1.5),false)).status,400);
  const responses=await Promise.all(['race-a','race-b'].map(id=>request('/api/orders','POST',payload(id,2),false)));assert.deepEqual(responses.map(x=>x.status).sort(),[201,409]);
  const success=(await request('/api/admin/orders')).data.find(x=>x.id!==o.id);await request('/api/admin/orders/'+success.id,'PATCH',{revision:success.revision,action:'cancel'});
  p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,3);
  p=(await request('/api/admin/products/'+p.id,'PATCH',{...p,price:200})).data;
  assert.equal((await request('/api/orders','POST',payload('stale'),false)).status,409);assert.equal((await request('/api/admin/orders')).data.find(x=>x.id===o.id).total,200);
 });
 await t.test('出貨、部分退貨、庫存回補與歷史分析',async()=>{
  o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'ship'})).data;
  let result=analyze((await request('/api/admin/orders')).data);assert.equal(result.revenue,200);assert.equal(result.qty,2);
  o=(await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:p.id,qty:1}]})).data;
  p=(await request('/api/admin/products')).data.find(x=>x.id===p.id);assert.equal(p.stock,4);
  result=analyze((await request('/api/admin/orders')).data);assert.equal(result.revenue,100);assert.equal(result.returned,1);
  assert.equal((await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'return',items:[{id:p.id,qty:2}]})).status,400);
  assert.equal((await request('/api/admin/orders/'+o.id,'PATCH',{revision:o.revision,action:'cancel'})).status,400);
  assert.equal((await request('/api/admin/backup')).data.orders.length,2);
 });
 await t.test('重新啟動後資料保留，登入狀態失效',async()=>{
  await new Promise(r=>server.close(r));server=createApp({dbPath,password});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  assert.equal((await request('/api/admin/orders')).status,401);cookie=(await request('/api/login','POST',{password})).headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/admin/orders')).data.length,2);assert.equal((await request('/api/admin/products')).data.find(x=>x.id===p.id).stock,4);
 });
});
test('分析依台灣下單日期、來源篩選，時價不虛增營業額',()=>{
 assert.equal(day('2026-10-27T16:30:00Z'),'2026-10-28');
 const base={id:'o',createdAt:'2026-10-27T16:30:00Z',channel:'customer',status:'shipped',market:true,items:[{id:'a',name:'時價',price:0,qty:3},{id:'b',name:'定價',price:50,qty:2}],returns:[]};
 assert.equal(analyze([base],{from:'2026-10-28',to:'2026-10-28'}).revenue,100);assert.equal(analyze([base],{from:'2026-10-29'}).orders,0);assert.equal(analyze([base],{channel:'order'}).orders,0);assert.equal(analyze([base]).marketOrders,1);
});
