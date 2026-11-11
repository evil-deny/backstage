import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../public/metrics.js';
test('刪除訂單同步移除所有總覽與商品分析指標，還原時計回且保留日期來源篩選',()=>{
 const shipped={id:'one',createdAt:'2026-11-10T16:01:00Z',channel:'order',status:'returned',market:true,items:[{id:'p1',name:'豆皮',unit:'包',price:50,qty:3},{id:'p2',name:'時價',unit:'板',price:0,qty:1}],returns:[{id:'p1',qty:1}]};
 const pending={...shipped,id:'two',status:'picking',returns:[],market:false};
 const original=analyze([shipped,pending]);assert.equal(original.revenue,100);assert.equal(original.qty,3);assert.equal(original.returned,1);assert.equal(original.pending,1);assert.equal(original.shipped,1);assert.equal(original.marketOrders,1);
 const deleted=[shipped,pending].map(o=>({...o,deletedAt:'2026-11-11T01:00:00Z'}));
 assert.deepEqual(analyze(deleted),{orders:0,pending:0,shipped:0,marketOrders:0,revenue:0,qty:0,returned:0,rows:[]});
 assert.deepEqual(analyze(deleted,{from:'2026-11-11',to:'2026-11-11',channel:'order'}),analyze([]));
 assert.deepEqual(analyze(deleted.map(({deletedAt,...o})=>o)),original);
 assert.equal(analyze([{...shipped,archivedAt:'2026-11-11T01:00:00Z'}]).revenue,100); // Staff archive is not order deletion.
 assert.equal(analyze([shipped],{from:'2026-11-10',to:'2026-11-10'}).orders,0);
 assert.equal(analyze([shipped],{channel:'customer'}).orders,0);
});
