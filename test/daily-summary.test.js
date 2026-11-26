import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeDaily} from '../assets/daily-summary-model.js';
const item=(extra={})=>({id:'p1',name:'白豆腐',code:'P195',category:'每日叫貨',unit:'板',price:210,qty:2,...extra});
const order=(id,extra={})=>({id,channel:'order',name:'測試夥伴',phone:'',createdAt:'2026-11-25T16:10:00Z',status:'new',items:[item()],returns:[],...extra});
const options={date:'2026-11-26'};
test('依台灣日期含未出貨，排除取消刪除與顧客，單位分開',()=>{
 const s=summarizeDaily([order('new'),order('shipped',{status:'shipped',items:[item({qty:3,unit:'包'})],returns:[item({qty:1})]}),order('cancel',{status:'cancelled'}),order('deleted',{deletedAt:'today'}),order('customer',{channel:'customer'}),order('yesterday',{createdAt:'2026-11-25T15:59:00Z'})],[],[],options);
 assert.equal(s.orderCount,2);assert.equal(s.pendingOrders,1);assert.equal(s.rows.length,2);assert.equal(s.units.get('板'),2);assert.equal(s.units.get('包'),3);assert.equal(s.amountCents,105000);assert.equal(s.rows.find(r=>r.unit==='包').returnedQty,1);
});
test('固定價用下單價格，時價用結帳快照，缺價另計',()=>{
 const orders=[order('fixed'),order('priced',{status:'shipped',items:[item({market:true,price:0,qty:3})]}),order('unpriced',{items:[item({market:true,price:0,qty:4})]})];
 const s=summarizeDaily(orders,[{deletedAt:'hidden-only',lines:[{orderId:'priced',id:'p1',unitPriceCents:22550}]}],[{id:'p1',orderPrice:9999}],options);
 assert.equal(s.amountCents,109650);assert.equal(s.unpricedQty,4);assert.equal(s.rows[0].qty,9);
});
test('分類與出貨狀態篩選保留原叫貨量',()=>{
 const orders=[order('pending'),order('partial',{status:'shipped',items:[item({picked:false})]}),order('company',{items:[item({category:'公司庫存'})]})];
 const s=summarizeDaily(orders,[],[],{...options,supply:'每日叫貨',status:'shipped'});
 assert.equal(s.orderCount,1);assert.equal(s.rows[0].qty,2);assert.equal(s.rows[0].shippedQty,0);assert.equal(s.rows[0].pendingQty,0);
});
test('頁面可初始化、更新、切換及匯出待定時價',async()=>{
 const ids=new Map(),exports=[];
 globalThis.document={getElementById(id){if(!ids.has(id))ids.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,selectedOptions:[{textContent:'全部'}],addEventListener(type,fn){this['on'+type]=fn;}});return ids.get(id);}};
 try{
 const {initDailySummary}=await import('../assets/daily-summary-ui.js');
 const ui=initDailySummary({csv:(...args)=>exports.push(args)});
 ids.get('dailyDate').value='2026-11-26';ids.get('dailySupply').value='all';ids.get('dailyStatus').value='all';
 ui.update([order('market',{items:[item({market:true,price:0})]})],[],[]);
 assert.match(ids.get('dailyRows').innerHTML,/白豆腐/);assert.match(ids.get('dailyRows').innerHTML,/待定時價/);
 ids.get('exportDaily').onclick();assert(exports[0][1].some(r=>r.includes('尚有時價未定價')));
 ids.get('dailyStatus').value='shipped';ids.get('dailyStatus').onchange();assert.equal(ids.get('exportDaily').disabled,true);
 }finally{delete globalThis.document;}
});
