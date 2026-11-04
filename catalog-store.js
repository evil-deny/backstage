import {catalogOrder} from './public/catalog-order.js';
import {movedCatalog} from './public/catalog-layout.js';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function createCatalogStore(db,decode){
 db.exec("CREATE TABLE IF NOT EXISTS catalog_state(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO catalog_state VALUES('main',0)");
 const all=()=>db.prepare('SELECT body FROM products ORDER BY rowid').all().map(r=>decode(r.body));
 const write=p=>db.prepare('UPDATE products SET body=? WHERE id=?').run(JSON.stringify({...p,revision:(p.revision||0)+1}),p.id);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 transaction(()=>{const rows=all(),missing=rows.filter(p=>!p.deletedAt&&!Number.isSafeInteger(p.displayNumber)).sort(catalogOrder);let n=Math.max(0,...rows.filter(p=>!p.deletedAt).map(p=>p.displayNumber||0));for(const p of missing){p.displayNumber=++n;db.prepare('UPDATE products SET body=? WHERE id=?').run(JSON.stringify(p),p.id);}});
 const layout=()=>{const rows=all();return {revision:db.prepare("SELECT revision FROM catalog_state WHERE id='main'").get().revision,products:rows.filter(p=>!p.deletedAt).sort(catalogOrder),deletedProducts:rows.filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))};};
 const check=revision=>{const current=layout();if(revision!==current.revision)fail(409,'商品目錄已更新，請重新整理');return current;};
 const commit=products=>{products.forEach((p,index)=>{delete p.deletedAt;delete p.deletedCode;p.displayNumber=index+1;write(p);});db.prepare("UPDATE catalog_state SET revision=revision+1 WHERE id='main'").run();return layout();};
 return {layout,
  add(body){return transaction(()=>{const rows=all(),next=Math.max(0,...rows.filter(p=>/^p\d+$/.test(p.id)).map(p=>Number(p.id.slice(1))))+1,id='p'+next;const p={...body,id,revision:1,displayNumber:layout().products.length+1};db.prepare('INSERT INTO products VALUES(?,?)').run(id,JSON.stringify(p));db.prepare("UPDATE catalog_state SET revision=revision+1 WHERE id='main'").run();return decode(JSON.stringify(p));});},
  reorder(body){return transaction(()=>{const current=check(body.revision);if(!Array.isArray(body.ids)||body.ids.some(id=>typeof id!=='string')||!(body.afterId===null||typeof body.afterId==='string'))fail(400,'請選擇商品及插入位置');let ordered;try{ordered=movedCatalog(current.products,body.ids,body.afterId);}catch(e){fail(400,e.message);}return commit(ordered);});},
  remove(body){return transaction(()=>{const current=check(body.revision);if(!Array.isArray(body.ids)||!body.ids.length||new Set(body.ids).size!==body.ids.length||body.ids.some(id=>!current.products.some(p=>p.id===id)))fail(400,'請選擇有效商品');for(const p of current.products.filter(p=>body.ids.includes(p.id))){p.deletedAt=new Date().toISOString();p.deletedCode=p.code;p.displayNumber=null;p.deletedOrderVisible=p.orderVisible;p.deletedCustomerVisible=p.customerVisible;p.orderVisible=false;p.customerVisible=false;write(p);}return commit(current.products.filter(p=>!body.ids.includes(p.id)));});},
  restore(body){return transaction(()=>{const current=check(body.revision),p=current.deletedProducts.find(p=>p.id===body.id);if(!p)fail(400,'找不到已刪除商品');p.orderVisible=!!p.deletedOrderVisible;p.customerVisible=!!p.deletedCustomerVisible;return commit([...current.products,p]);});},
 };
}
