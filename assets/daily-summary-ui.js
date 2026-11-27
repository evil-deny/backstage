import {summarizeDaily,taiwanDay} from './daily-summary-model.js?v=fulfillment-20261127';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>'NT$ '+(c/100).toLocaleString('zh-TW',{maximumFractionDigits:2});
const quantity=units=>[...units].map(([unit,qty])=>qty.toLocaleString('zh-TW')+' / '+unit).join('、')||'0';
export function initDailySummary({csv}){
 const $=id=>document.getElementById(id);let orders=[],bills=[],products=[],summary;
 $('dailyDate').value=taiwanDay(new Date().toISOString());
 const metric=(title,value,sub)=>`<article class="metric"><p>${esc(title)}</p><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`;
 function render(){
  summary=summarizeDaily(orders,bills,products,{date:$('dailyDate').value,supply:$('dailySupply').value,status:$('dailyStatus').value});
  const s=summary;
  $('dailyMetrics').innerHTML=metric('叫貨訂單',s.orderCount,s.peopleCount+' 位批發人；'+s.pendingOrders+' 筆未出貨')+metric(s.unpricedQty?'已知叫貨金額':'叫貨商品合計',money(s.amountCents),s.unpricedQty?'尚有時價未定價，非完整金額':'依下單單價或已建立結帳單的時價');
  $('dailySources').innerHTML=s.sources.map(source=>`<section class="panel"><h2>${esc(source.category)}</h2><strong>${esc(money(source.amountCents))}${source.unpricedQty?' ＋ 待定時價':''}</strong></section>`).join('');
  $('dailyRows').innerHTML=s.rows.map(r=>`<tr><td>${esc(r.category)}</td><td><strong>${esc(r.name)}</strong><small>${esc(r.code)} · ${r.orderCount} 筆訂單</small></td><td class="quantity-unit"><b>${r.qty} / ${esc(r.unit)}</b></td><td class="quantity-unit">${r.pendingQty} / ${esc(r.unit)}</td><td class="quantity-unit">${r.shippedQty} / ${esc(r.unit)}</td><td class="quantity-unit">${r.returnedQty} / ${esc(r.unit)}</td><td class="price">${esc(money(r.amountCents))}${r.unpricedQty?`<small class="daily-unpriced">另有 ${r.unpricedQty} / ${esc(r.unit)} 待定時價</small>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">這一天沒有符合條件的叫貨訂單</td></tr>';
  $('exportDaily').disabled=!s.rows.length;
 }
 for(const id of ['dailyDate','dailySupply','dailyStatus'])$(id).addEventListener('change',render);
 $('dailyToday').onclick=()=>{$('dailyDate').value=taiwanDay(new Date().toISOString());render();};
 $('exportDaily').onclick=()=>csv($('dailyDate').value+'-每日叫貨彙總.csv',[
  ['下單日期',$('dailyDate').value],['分類篩選',$('dailySupply').selectedOptions[0].textContent],['狀態篩選',$('dailyStatus').selectedOptions[0].textContent],
  ['分類','商品編號','品項','叫貨數量','單位','未出貨數量','已出貨數量','退貨數量','已知金額（元）','待定時價數量','訂單數'],
  ...summary.rows.map(r=>[r.category,r.code,r.name,r.qty,r.unit,r.pendingQty,r.shippedQty,r.returnedQty,r.amountCents/100,r.unpricedQty,r.orderCount]),
  ['商品已知金額合計（元）',summary.amountCents/100],['叫貨數量',quantity(summary.units)],['金額是否完整',summary.unpricedQty?'尚有時價未定價':'完整'],
  ['計算方式','依台灣時間下單日；含未出貨，不含取消或刪除；原始叫貨金額未扣退貨，不含租金、廠電費。']]);
 return {update(nextOrders,nextBills,nextProducts){orders=nextOrders;bills=nextBills;products=nextProducts;render();}};
}
