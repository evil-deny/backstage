import {orderLabel} from './order-display.js';
const money=n=>'NT$ '+(n/100).toLocaleString('zh-TW',{maximumFractionDigits:2});
const group=i=>String(i.category).includes('兩天一次')?'兩天一次':String(i.category).includes('公司庫存')?'公司庫存':i.category||'其他品項';
export function billImageRows(b){
 const rows=[];for(const category of [...new Set(b.lines.map(group))]){
  const items=b.lines.filter(i=>group(i)===category);rows.push({kind:'group',text:category+'　小計 '+money(items.reduce((s,i)=>s+i.grossCents,0))});
  for(const i of items)rows.push({kind:'item',name:i.name,detail:[i.code,orderLabel(i.orderId)].filter(Boolean).join(' · '),qty:i.qty+' '+i.unit,price:money(i.unitPriceCents),total:money(i.grossCents)});
 }
 if(b.manualItems.length){rows.push({kind:'group',text:'手填時價品項'});for(const i of b.manualItems)rows.push({kind:'item',name:i.name,detail:'',qty:i.qty+' '+i.unit,price:money(i.unitPriceCents),total:money(i.grossCents)});}
 rows.push({kind:'sum',text:'訂單商品合計',value:money(b.goodsCents)},{kind:'sum',text:'手填品項合計',value:money(b.manualCents)},{kind:'sum',text:'租金',value:money(b.rentCents)},{kind:'sum',text:'廠電費',value:money(b.utilitiesCents??0)},{kind:'sum',text:'退貨抵扣',value:'− '+money(b.creditCents)},{kind:'payable',text:'本次應收',value:money(b.payableCents)},{kind:'sum',text:'留待下次抵扣',value:money(b.carryCents)});
 if(b.credits.length){rows.push({kind:'group',text:'本次抵扣的退貨'});for(const c of b.credits)rows.push({kind:'sum',text:c.name,value:'− '+money(c.appliedCents)});}
 return rows;
}
function wrap(ctx,text,width){const result=[];let line='';for(const c of String(text)){if(line&&ctx.measureText(line+c).width>width){result.push(line);line=c;}else line+=c;}if(line)result.push(line);return result.length?result:[''];}
export async function renderBillImages(b){
 await document.fonts?.ready;
 const width=1080,maxBody=3600,font='"Microsoft JhengHei", "PingFang TC", sans-serif',probe=document.createElement('canvas').getContext('2d');
 if(!probe)throw Error('瀏覽器無法產生圖片');probe.font='30px '+font;
 const rows=billImageRows(b).map(row=>{const names=wrap(probe,row.name??row.text,row.kind==='item'?430:row.kind==='group'?930:590);return {...row,names,height:row.kind==='item'?Math.max(100,names.length*42+38):row.kind==='payable'?102:Math.max(70,names.length*42+18)};});
 const pages=[[]];let used=0;for(let row of rows){
  // Split exceptionally long names instead of clipping or exceeding canvas limits.
  const chunks=[];while(row.names.length>20){chunks.push({...row,names:row.names.slice(0,20),height:890});row={...row,names:row.names.slice(20),height:Math.max(100,(row.names.length-20)*42+38)};}chunks.push(row);
  for(const chunk of chunks){if(used+chunk.height>maxBody&&pages.at(-1).length){pages.push([]);used=0;}pages.at(-1).push(chunk);used+=chunk.height;}
 }
 probe.font='34px '+font;const personLines=wrap(probe,b.person.name,720),extraHeader=Math.max(0,personLines.length-2)*38;
 const result=[];for(const [index,page]of pages.entries()){
  const canvas=document.createElement('canvas'),height=370+extraHeader+page.reduce((s,r)=>s+r.height,0)+90;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('無法產生圖片');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#17634e';ctx.fillRect(0,0,width,110);ctx.fillStyle='#ffffff';ctx.font='bold 42px '+font;ctx.fillText('福緣素食｜批發結帳單',48,70);
  const label=(text,x,y,size=30,color='#243f35',align='left',maxWidth=1000)=>{ctx.font=size+'px '+font;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(text,x,y,maxWidth);};
  label(b.date+'　JS-'+b.id.slice(0,8).toUpperCase(),48,165,29);
  personLines.forEach((line,j)=>label(line,48,215+j*38,34));
  label(b.paidAt?'● 已收款':'● 未收款',1028,215,33,b.paidAt?'#116438':'#b94519','right');
  label((b.person.phone||'未填電話')+(b.deletedAt?'　｜已刪除紀錄，帳款保留':''),48,300+extraHeader,26);
  ctx.fillStyle='#eef5f1';ctx.fillRect(40,320+extraHeader,1000,50);label('品項',56,354+extraHeader,25);label('數量',680,354+extraHeader,25,'#243f35','right');label('單價',840,354+extraHeader,25,'#243f35','right');label('小計',1020,354+extraHeader,25,'#243f35','right');
  let y=370+extraHeader;for(const r of page){
   if(r.kind==='group'||r.kind==='payable'){ctx.fillStyle=r.kind==='group'?'#eef5f1':'#d9eee3';ctx.fillRect(40,y,1000,r.height);}
   if(r.kind==='item'){
    r.names.forEach((line,j)=>label(line,56,y+40+j*42,30));if(r.detail)label(r.detail,56,y+r.height-15,20,'#667a70');
    label(r.qty,680,y+42,27,'#243f35','right',155);label(r.price,840,y+42,27,'#243f35','right',150);label(r.total,1020,y+42,27,'#243f35','right',170);
   }else{r.names.forEach((line,j)=>label(line,56,y+44+j*42,r.kind==='payable'?34:30));if(r.value)label(r.value,1020,y+44,r.kind==='payable'?39:31,r.kind==='payable'?'#116438':'#243f35','right');}
   y+=r.height;ctx.strokeStyle='#dce5df';ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(1040,y);ctx.stroke();
  }
  label(`第 ${index+1}／${pages.length} 張 · 退貨餘額留待下次抵扣`,48,height-35,23,'#667a70');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('無法產生 PNG 圖片');result.push({blob,filename:`${b.date}-${b.person.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60)}-結帳單-${index+1}.png`});
 }
 return result;
}
