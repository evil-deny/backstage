import catalog from '../data/catalog.json';
import {catalogOrder} from '../public/catalog-order.js';
import {movedCatalog} from '../public/catalog-layout.js';
import {isAdmin,allowedOrigin,corsHeaders,startGoogleLogin,googleLogin,revoke,digest,type AccessConfig} from './google-access';
type Product={id:string;name:string;category:string;type:string;storage:string;image:string;price:number;orderPrice:number;orderUnit:string;customerUnit:string;stock:number|null;orderVisible:boolean;customerVisible:boolean;revision:number;displayNumber?:number|null;code?:string;deletedAt?:string;deletedCode?:string};
type Item={id:string;name:string;price:number;qty:number;unit?:string;code?:string;market:boolean;returnedAt?:string;custom?:boolean;picked?:boolean};
type Order={id:string;channel:string;name:string;phone:string;note:string;createdAt:string;status:string;items:Item[];returns:Item[];total:number;market:boolean;revision:number;shippedAt?:string;returnClosedAt?:string;archivedAt?:string;requestFingerprint?:string;submittedTotal?:number;submittedMarket?:boolean};
const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
const text=(v:unknown,max=200):string=>typeof v==='string'&&v.trim().length&&v.length<=max?v.trim():fail(400,'文字欄位未填或過長');
const number=(v:unknown,max=1e8):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:fail(400,'價格與數量必須是非負整數');
let seeded:Promise<void>|null=null;
function decode(row:any):Product{const {creationToken,...body}=JSON.parse(row.body);return {...body,id:row.id,code:body.deletedAt?(body.deletedCode||row.id):Number.isSafeInteger(body.displayNumber)?'P'+body.displayNumber:row.id,orderUnit:body.orderUnit??'件',customerUnit:body.customerUnit??'件',stock:row.stock,price:row.price,orderPrice:row.order_price??row.price,revision:row.revision,orderVisible:!!row.order_visible,customerVisible:!!row.customer_visible};}
export function createRepository(db:D1Database){
 const product=async(id:string)=>{const row=await db.prepare('SELECT * FROM inventory WHERE id=?').bind(id).first();return row?decode(row):fail(404,'找不到商品');};
 const products=async(includeDeleted=false)=> (await db.prepare('SELECT * FROM inventory ORDER BY rowid').all()).results.map(decode).filter(p=>includeDeleted||!p.deletedAt).sort(catalogOrder);
 const orders=async():Promise<Order[]>=> (await db.prepare('SELECT body,revision FROM order_records ORDER BY rowid DESC').all<any>()).results.map(row=>({...JSON.parse(row.body),revision:row.revision}));
 const order=async(id:string):Promise<Order>=>{const row=await db.prepare('SELECT body,revision FROM order_records WHERE id=?').bind(id).first<any>();return row?{...JSON.parse(row.body),revision:row.revision}:fail(404,'找不到訂單');};
 const guard=(id:string)=>db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(id);
 const layout=async()=>{
  const rows=(await db.prepare("SELECT inventory.*, (SELECT revision FROM catalog_state WHERE id='main') AS catalog_revision FROM inventory ORDER BY rowid").all<any>()).results;
  const all=rows.map(decode);return {revision:rows[0]?.catalog_revision??(await db.prepare("SELECT revision FROM catalog_state WHERE id='main'").first<any>())?.revision??0,products:all.filter(p=>!p.deletedAt).sort(catalogOrder),deletedProducts:all.filter(p=>p.deletedAt).sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt)))};
 };
 return {product,products,orders,order,layout,
  async initialize(){await db.batch([
   db.prepare("INSERT OR IGNORE INTO catalog_state(id,revision) VALUES('main',0)"),
   db.prepare(`WITH base AS MATERIALIZED (SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0) AS n FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL),
    missing AS MATERIALIZED (SELECT id,ROW_NUMBER() OVER(ORDER BY CASE WHEN id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END,CASE WHEN id GLOB 'p[0-9]*' THEN CAST(substr(id,2) AS INTEGER) ELSE 0 END,rowid) AS n FROM inventory WHERE json_extract(body,'$.displayNumber') IS NULL AND json_extract(body,'$.deletedAt') IS NULL)
    UPDATE inventory SET body=json_set(body,'$.displayNumber',(SELECT n FROM base)+(SELECT n FROM missing WHERE missing.id=inventory.id)) WHERE id IN (SELECT id FROM missing)`)
  ]);},
  async arrange(ordered:Product[],revision:number,deleted:Product[]=[],restoreId:string|null=null){
   const key=crypto.randomUUID(),now=new Date().toISOString(),statements=[db.prepare("UPDATE catalog_state SET revision=revision+1 WHERE id='main' AND revision=?").bind(revision),guard(key)];
   for(const p of deleted)statements.push(db.prepare("UPDATE inventory SET body=json_set(body,'$.deletedAt',?,'$.deletedCode',?,'$.displayNumber',NULL,'$.deletedOrderVisible',order_visible,'$.deletedCustomerVisible',customer_visible),order_visible=0,customer_visible=0,revision=revision+1 WHERE id=?").bind(now,p.code||p.id,p.id));
   ordered.forEach((p,index)=>{statements.push(db.prepare("UPDATE inventory SET body=json_set(json_remove(body,'$.deletedAt','$.deletedCode'),'$.displayNumber',?),order_visible=CASE WHEN id=? THEN COALESCE(json_extract(body,'$.deletedOrderVisible'),0) ELSE order_visible END,customer_visible=CASE WHEN id=? THEN COALESCE(json_extract(body,'$.deletedCustomerVisible'),0) ELSE customer_visible END,revision=revision+1 WHERE id=?").bind(index+1,restoreId,restoreId,p.id));});
   statements.push(db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key));
   try{await db.batch(statements);}catch{fail(409,'商品目錄已在其他視窗更新，請重新整理再操作');}return layout();
  },
  async seed(){if(await db.prepare('SELECT id FROM inventory LIMIT 1').first())return;const batches:D1PreparedStatement[]=[];for(let start=0;start<catalog.length;start+=10){const group=catalog.slice(start,start+10);batches.push(db.prepare('INSERT OR IGNORE INTO inventory(id,body,stock,price,order_visible,customer_visible,revision) VALUES '+group.map(()=>'(?,?,?,?,?,?,?)').join(',')).bind(...group.flatMap(p=>[p.id,JSON.stringify(p),p.stock,p.price,p.orderVisible?1:0,p.customerVisible?1:0,p.revision])));}await db.batch(batches);},
  async addProduct(p:Omit<Product,'id'>){
   // Allocate identity and visible number in one serialized batch; identities never change.
   const result=await db.batch([db.prepare("UPDATE catalog_state SET revision=revision+1 WHERE id='main'"),db.prepare(`INSERT INTO inventory(id,body,stock,price,order_price,order_visible,customer_visible,revision)
    SELECT 'p'||next,json_set(?,'$.id','p'||next,'$.displayNumber',(SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0)+1 FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL)),?,?,?,?,?,1 FROM
    (SELECT COALESCE(MAX(CAST(substr(id,2) AS INTEGER)),0)+1 AS next FROM inventory
     WHERE id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*') RETURNING *`)
    .bind(JSON.stringify(p),p.stock,p.price,p.orderPrice,p.orderVisible?1:0,p.customerVisible?1:0)]);
   return decode(result[1].results[0]);
  },
  async updateProduct(p:Product){const r=await db.prepare('UPDATE inventory SET body=?,stock=?,price=?,order_price=?,order_visible=?,customer_visible=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(p),p.stock,p.price,p.orderPrice,p.orderVisible?1:0,p.customerVisible?1:0,p.id,p.revision).run();if(!r.meta.changes)fail(409,'商品已在其他視窗更新，請重新整理');return product(p.id);},
  async findRequest(id:string):Promise<Order|null>{const row=await db.prepare('SELECT body FROM order_records WHERE request_id=?').bind(id).first<any>();return row?JSON.parse(row.body):null;},
  async place(o:Order,requestId:string){const batch=crypto.randomUUID(),statements:D1PreparedStatement[]=[];for(const [index,i]of o.items.entries()){if(i.custom)continue;statements.push(db.prepare(`UPDATE inventory SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-? END,revision=revision+1 WHERE id=? AND ${o.channel==='order'?'COALESCE(order_price,price)':'price'}=? AND ${o.channel==='order'?'order_visible':'customer_visible'}=1 AND (stock IS NULL OR stock>=?) AND COALESCE(json_extract(body,'$.${o.channel==='order'?'orderUnit':'customerUnit'}'),'件')=?`).bind(i.qty,i.id,i.price,i.qty,i.unit??'件'),guard(batch+'-'+index));}statements.push(db.prepare('INSERT INTO order_records VALUES(?,?,?,?)').bind(o.id,requestId,JSON.stringify(o),1),db.prepare('DELETE FROM mutation_guards WHERE id LIKE ?').bind(batch+'%'));await db.batch(statements);},
  async transition(o:Order,revision:number,restock:Item[]){const batch=crypto.randomUUID();const statements=[db.prepare('UPDATE order_records SET body=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(o),o.id,revision),guard(batch)];for(const i of restock.filter(i=>!i.custom))statements.push(db.prepare('UPDATE inventory SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock+? END,revision=revision+1 WHERE id=?').bind(i.qty,i.id));statements.push(db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(batch));try{await db.batch(statements);}catch{fail(409,'訂單已更新，請重新整理');}return order(o.id);},
 };
}
function validateProduct(b:any){if(b.image&&!(typeof b.image==='string'&&/^https:\/\//i.test(b.image)))fail(400,'圖片請使用 HTTPS 網址');if(!['冷凍','冷藏','乾貨'].includes(b.storage))fail(400,'請選擇保存方式');if(typeof b.orderVisible!=='boolean'||typeof b.customerVisible!=='boolean')fail(400,'請設定顯示狀態');return {name:text(b.name,120),category:text(b.category,80),type:text(b.type,80),storage:b.storage,image:typeof b.image==='string'?b.image.slice(0,3000):'',price:number(b.price),orderPrice:number(b.orderPrice??b.price),orderUnit:text(b.orderUnit??'件',20),customerUnit:text(b.customerUnit??'件',20),stock:b.stock===null?null:number(b.stock),orderVisible:b.orderVisible,customerVisible:b.customerVisible};}
export async function handleBackstage(request:Request,db:D1Database,config:AccessConfig={}){
 const reply=(status:number,data:unknown,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...corsHeaders(request),...headers}});
 try{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!allowedOrigin(request))fail(403,'不允許此來源操作');
  if(method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(request)});
  const admin=await isAdmin(request,db,config);
  if(path==='/api/health')return reply(200,{ok:true});
  if(path==='/api/auth/config'&&method==='GET')return reply(200,{provider:'google',configured:!!config.GOOGLE_CLIENT_ID});
  if(path.startsWith('/api/admin/')&&!admin)fail(401,'請先使用 Google 帳號登入');
  if(path==='/api/staff')return reply(200,{admin});
  if(path==='/api/login'&&method==='POST'){if(!admin)fail(401,'請使用 Google 帳號登入');return reply(200,{ok:true});}
  const repo=createRepository(db);if(!seeded)seeded=repo.seed().then(()=>repo.initialize()).catch(e=>{seeded=null;throw e;});await seeded;
  let b:any={};if(['POST','PATCH'].includes(method)){if(Number(request.headers.get('content-length')||0)>1024*1024)fail(413,'資料超過 1 MB');const raw=await request.text();if(new TextEncoder().encode(raw).length>1024*1024)fail(413,'資料超過 1 MB');try{b=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'資料格式錯誤');}
  if(path==='/api/auth/exchange')fail(410,'請改使用 Google 帳號登入');
  if(path==='/api/auth/google/start'&&method==='POST')return reply(200,await startGoogleLogin(db,config,b));
  if(path==='/api/auth/google'&&method==='POST'){const grant=await googleLogin(db,config,b);if(!grant)fail(401,'Google 登入憑證已失效，請重新登入');return reply(200,grant);}
  if(path==='/api/logout'&&method==='POST'){await revoke(request,db);return reply(200,{ok:true});}
  if(path==='/api/products'&&method==='GET'){const key=url.searchParams.get('channel')==='order'?'orderVisible':'customerVisible';return reply(200,(await repo.products()).filter(p=>p[key]).map(({orderPrice,orderUnit,customerUnit,...p})=>({...p,price:key==='orderVisible'?orderPrice:p.price,unit:key==='orderVisible'?orderUnit:customerUnit})));}
  if(path==='/api/admin/catalog'&&method==='GET')return reply(200,await repo.layout());
  if(path.startsWith('/api/admin/catalog/')&&method==='POST'){
   const current=await repo.layout();if(b.revision!==current.revision)fail(409,'商品目錄已更新，請重新整理');
   if(path==='/api/admin/catalog/reorder'){
    if(!Array.isArray(b.ids)||b.ids.some((id:any)=>typeof id!=='string')||!(b.afterId===null||typeof b.afterId==='string'))fail(400,'請選擇商品及插入位置');
    let ordered:Product[];try{ordered=movedCatalog(current.products,b.ids,b.afterId);}catch(e:any){fail(400,e.message);}return reply(200,await repo.arrange(ordered!,b.revision));
   }
   if(path==='/api/admin/catalog/delete'){
    if(!Array.isArray(b.ids)||!b.ids.length||new Set(b.ids).size!==b.ids.length||b.ids.some((id:any)=>!current.products.some(p=>p.id===id)))fail(400,'請選擇有效商品');
    return reply(200,await repo.arrange(current.products.filter(p=>!b.ids.includes(p.id)),b.revision,current.products.filter(p=>b.ids.includes(p.id))));
   }
   if(path==='/api/admin/catalog/restore'){
    const p=current.deletedProducts.find(p=>p.id===b.id)??fail(400,'找不到已刪除商品');return reply(200,await repo.arrange([...current.products,p],b.revision,[],p.id));
   }
   fail(404,'找不到目錄操作');
  }
  if(path==='/api/admin/products'&&method==='GET')return reply(200,await repo.products());
  if(path==='/api/admin/products'&&method==='POST')return reply(201,await repo.addProduct({...validateProduct(b),revision:1}));
  if(path.startsWith('/api/admin/products/')&&method==='PATCH'){const p=await repo.product(decodeURIComponent(path.split('/').at(-1)!));if(p.deletedAt)fail(409,'商品已刪除，請先還原');if(b.revision!==p.revision)fail(409,'商品已更新，請重新整理');return reply(200,await repo.updateProduct({...p,...validateProduct({...b,orderPrice:b.orderPrice??p.orderPrice,orderUnit:b.orderUnit??p.orderUnit,customerUnit:b.customerUnit??p.customerUnit})}));}
  if(path==='/api/orders'&&method==='POST'){
   const channel=b.channel==='order'?'order':'customer';
   const requestId=text(b.requestId,80),requestFingerprint=await digest(JSON.stringify({channel,name:b.name,phone:b.phone||'',note:b.note||'',items:Array.isArray(b.items)?b.items.map((i:any)=>({id:i?.id,qty:i?.qty,price:i?.price,...(i?.unit!==undefined?{unit:i.unit}:{}),custom:!!i?.custom,...(i?.custom?{name:i.name}:{})})):null}));
   const result=(o:Order)=>{if(o.requestFingerprint&&o.requestFingerprint!==requestFingerprint)fail(409,'這份訂單已送出；修改內容請開始另一張訂購單');return {id:o.id,total:o.submittedTotal??o.total,market:o.submittedMarket??o.market};};const existing=await repo.findRequest(requestId);if(existing)return reply(201,result(existing));
   const name=text(b.name,60),phone=typeof b.phone==='string'?b.phone.trim().slice(0,40):'';
   if(channel==='customer'&&!/^[\d+()\s-]{6,40}$/.test(phone))fail(400,'請填寫有效聯絡電話');if(!Array.isArray(b.items)||!b.items.length||b.items.length>300)fail(400,'請選擇 1 至 300 項商品');
   const ids=new Set<string>(),items:Item[]=[];for(const i of b.items){if(!i||typeof i!=='object')fail(400,'商品格式錯誤');if(i.custom){if(channel!=='order')fail(403,'顧客不能建立自訂價格品項');const qty=number(i.qty,9999);if(!qty||ids.has(i.id))fail(400,'自訂商品重複或數量為零');ids.add(i.id);items.push({id:text(i.id,80),name:text(i.name,120),price:number(i.price),market:i.price===0,qty,unit:text(i.unit??'件',20),custom:true,picked:false});continue;}const p=await repo.product(text(i.id,80)),qty=number(i.qty,9999);if(p.deletedAt)fail(409,`${p.name} 已刪除，請更新商品`);if(!qty||ids.has(p.id))fail(400,'商品重複或數量為零');ids.add(p.id);if(!p[channel==='order'?'orderVisible':'customerVisible'])fail(409,`${p.name} 已隱藏`);const unit=channel==='order'?p.orderUnit:p.customerUnit;if(i.unit!==undefined&&i.unit!==unit)fail(409,`${p.name} 販售單位已調整，請更新商品`);const price=channel==='order'?p.orderPrice:p.price;if(i.price!==price)fail(409,`${p.name} 價格已調整，請更新商品`);if(p.stock!==null&&p.stock<qty)fail(409,`${p.name} 庫存不足`);items.push({id:p.id,name:p.name,code:p.code,price,unit,market:price===0,qty,custom:false,picked:false});}
   const o:Order={id:'FY-'+crypto.randomUUID(),channel,name,phone,note:typeof b.note==='string'?b.note.slice(0,500):'',createdAt:new Date().toISOString(),status:'new',items,returns:[],total:items.reduce((s,i)=>s+i.price*i.qty,0),market:items.some(i=>i.market),revision:1,requestFingerprint,submittedTotal:items.reduce((s,i)=>s+i.price*i.qty,0),submittedMarket:items.some(i=>i.market)};
   try{await repo.place(o,requestId);}catch(e){const previous=await repo.findRequest(requestId);if(previous)return reply(201,result(previous));if(String(e).includes('CHECK constraint')||String(e).includes('UNIQUE constraint'))fail(409,'價格、單位、上下架或庫存已變更，請更新商品後重試');throw e;}return reply(201,result(o));
  }
  if((path==='/api/admin/orders'||path==='/api/staff/orders')&&method==='GET')return reply(200,await repo.orders());
  if((path.startsWith('/api/admin/orders/')||path.startsWith('/api/staff/orders/'))&&method==='PATCH'){
   const o=await repo.order(decodeURIComponent(path.split('/').at(-1)!));if(b.revision!==o.revision)fail(409,'訂單已更新，請重新整理');let restock:Item[]=[];
   if(b.action==='pick'&&['new','picking'].includes(o.status)){
    const item=o.items.find(i=>i.id===b.itemId)??fail(400,'揀貨品項錯誤');if(typeof b.picked!=='boolean')fail(400,'揀貨品項錯誤');item.picked=b.picked;o.status=o.items.some(i=>i.picked)?'picking':'new';
   }else if(b.action==='ship'&&['new','picking'].includes(o.status)){
    if(b.pickedIds!==undefined&&(!Array.isArray(b.pickedIds)||b.pickedIds.some((id:any)=>typeof id!=='string'||!o.items.some(i=>i.id===id))))fail(400,'出貨品項錯誤');
    const picked=new Set<string>(b.pickedIds??o.items.map(i=>i.id));o.items.forEach(i=>{i.picked=picked.has(i.id);});restock=o.items.filter(i=>!i.picked);o.status='shipped';o.shippedAt=new Date().toISOString();o.total=o.items.filter(i=>i.picked).reduce((s,i)=>s+i.price*i.qty,0);o.market=o.items.some(i=>i.picked&&i.market);
   }else if(b.action==='cancel'&&['new','picking'].includes(o.status)){o.status='cancelled';restock=o.items;}
   else if(b.action==='archive'&&!['new','picking'].includes(o.status)){o.archivedAt=new Date().toISOString();}
   else if(b.action==='closeReturn'&&['shipped','returned'].includes(o.status)){o.returnClosedAt=new Date().toISOString();}
   else if(b.action==='return'&&['shipped','returned'].includes(o.status)){
    if(!Array.isArray(b.items)||!b.items.length)fail(400,'請選擇退貨商品');const ids=new Set();
    restock=b.items.map((i:any)=>{if(!i||typeof i!=='object')fail(400,'退貨格式錯誤');const original=o.items.find(x=>x.id===i.id)??fail(400,'退貨品項錯誤');if(ids.has(i.id)||original.picked===false)fail(400,'未出貨或重複的品項不能退貨');ids.add(i.id);const qty=number(i.qty),returned=o.returns.filter(r=>r.id===i.id).reduce((s,r)=>s+r.qty,0);if(!qty||qty+returned>original.qty)fail(400,'退貨數量超過已出貨數量');return {...original,qty,returnedAt:new Date().toISOString()};});o.returns.push(...restock);o.status='returned';
    if(o.items.filter(i=>i.picked!==false).every(i=>o.returns.filter(r=>r.id===i.id).reduce((sum,r)=>sum+r.qty,0)>=i.qty))o.returnClosedAt=new Date().toISOString();
   }else fail(400,'此訂單狀態不允許這項操作');return reply(200,await repo.transition(o,b.revision,restock));
  }
  if(path==='/api/admin/backup'&&method==='GET')return reply(200,{schema:1,exportedAt:new Date().toISOString(),products:await repo.products(true),orders:await repo.orders()},{'Content-Disposition':'attachment; filename="backstage-backup.json"'});
  fail(404,'找不到 API');
 }catch(e:any){if(!e.status)console.error(e);return reply(e.status||500,{error:e.status?e.message:'伺服器發生錯誤，請稍後再試'});}
}
