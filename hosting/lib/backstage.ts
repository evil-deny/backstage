import catalog from '../data/catalog.json';
type Product={id:string;name:string;category:string;type:string;storage:string;image:string;price:number;stock:number|null;orderVisible:boolean;customerVisible:boolean;revision:number};
type Item={id:string;name:string;price:number;qty:number;market:boolean;returnedAt?:string};
type Order={id:string;channel:string;name:string;phone:string;note:string;createdAt:string;status:string;items:Item[];returns:Item[];total:number;market:boolean;revision:number;shippedAt?:string};
const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
const text=(v:unknown,max=200):string=>typeof v==='string'&&v.trim().length&&v.length<=max?v.trim():fail(400,'文字欄位未填或過長');
const number=(v:unknown,max=1e8):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:fail(400,'價格與數量必須是非負整數');
let seeded:Promise<void>|null=null;
function decode(row:any):Product{return {...JSON.parse(row.body),stock:row.stock,price:row.price,revision:row.revision,orderVisible:!!row.order_visible,customerVisible:!!row.customer_visible};}
export function createRepository(db:D1Database){
 const product=async(id:string)=>{const row=await db.prepare('SELECT * FROM inventory WHERE id=?').bind(id).first();return row?decode(row):fail(404,'找不到商品');};
 const products=async()=> (await db.prepare('SELECT * FROM inventory ORDER BY rowid').all()).results.map(decode);
 const orders=async():Promise<Order[]>=> (await db.prepare('SELECT body,revision FROM order_records ORDER BY rowid DESC').all<any>()).results.map(row=>({...JSON.parse(row.body),revision:row.revision}));
 const order=async(id:string):Promise<Order>=>{const row=await db.prepare('SELECT body,revision FROM order_records WHERE id=?').bind(id).first<any>();return row?{...JSON.parse(row.body),revision:row.revision}:fail(404,'找不到訂單');};
 const guard=(id:string)=>db.prepare('INSERT INTO mutation_guards(id,ok) VALUES(?,changes())').bind(id);
 return {product,products,orders,order,
  async seed(){if(await db.prepare('SELECT id FROM inventory LIMIT 1').first())return;const batches:D1PreparedStatement[]=[];for(let start=0;start<catalog.length;start+=10){const group=catalog.slice(start,start+10);batches.push(db.prepare('INSERT OR IGNORE INTO inventory VALUES '+group.map(()=>'(?,?,?,?,?,?,?)').join(',')).bind(...group.flatMap(p=>[p.id,JSON.stringify(p),p.stock,p.price,p.orderVisible?1:0,p.customerVisible?1:0,p.revision])));}await db.batch(batches);},
  async addProduct(p:Product){await db.prepare('INSERT INTO inventory VALUES(?,?,?,?,?,?,?)').bind(p.id,JSON.stringify(p),p.stock,p.price,p.orderVisible?1:0,p.customerVisible?1:0,1).run();return product(p.id);},
  async updateProduct(p:Product){const r=await db.prepare('UPDATE inventory SET body=?,stock=?,price=?,order_visible=?,customer_visible=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(p),p.stock,p.price,p.orderVisible?1:0,p.customerVisible?1:0,p.id,p.revision).run();if(!r.meta.changes)fail(409,'商品已在其他視窗更新，請重新整理');return product(p.id);},
  async findRequest(id:string):Promise<Order|null>{const row=await db.prepare('SELECT body FROM order_records WHERE request_id=?').bind(id).first<any>();return row?JSON.parse(row.body):null;},
  async place(o:Order,requestId:string){const batch=crypto.randomUUID(),statements:D1PreparedStatement[]=[];for(const [index,i]of o.items.entries()){statements.push(db.prepare(`UPDATE inventory SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-? END,revision=revision+1 WHERE id=? AND price=? AND ${o.channel==='order'?'order_visible':'customer_visible'}=1 AND (stock IS NULL OR stock>=?)`).bind(i.qty,i.id,i.price,i.qty),guard(batch+'-'+index));}statements.push(db.prepare('INSERT INTO order_records VALUES(?,?,?,?)').bind(o.id,requestId,JSON.stringify(o),1),db.prepare('DELETE FROM mutation_guards WHERE id LIKE ?').bind(batch+'%'));await db.batch(statements);},
  async transition(o:Order,revision:number,restock:Item[]){const batch=crypto.randomUUID();const statements=[db.prepare('UPDATE order_records SET body=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(o),o.id,revision),guard(batch)];for(const i of restock)statements.push(db.prepare('UPDATE inventory SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock+? END,revision=revision+1 WHERE id=?').bind(i.qty,i.id));statements.push(db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(batch));try{await db.batch(statements);}catch{fail(409,'訂單已更新，請重新整理');}return order(o.id);},
 };
}
function validateProduct(b:any){if(b.image&&!(typeof b.image==='string'&&/^https:\/\//i.test(b.image)))fail(400,'圖片請使用 HTTPS 網址');if(!['冷凍','冷藏','乾貨'].includes(b.storage))fail(400,'請選擇保存方式');if(typeof b.orderVisible!=='boolean'||typeof b.customerVisible!=='boolean')fail(400,'請設定顯示狀態');return {name:text(b.name,120),category:text(b.category,80),type:text(b.type,80),storage:b.storage,image:typeof b.image==='string'?b.image.slice(0,3000):'',price:number(b.price),stock:b.stock===null?null:number(b.stock),orderVisible:b.orderVisible,customerVisible:b.customerVisible};}
export async function handleBackstage(request:Request,db:D1Database){
 const reply=(status:number,data:unknown,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
 try{
  const url=new URL(request.url),path=url.pathname,method=request.method,admin=!!request.headers.get('oai-authenticated-user-id');
  if(path==='/api/health')return reply(200,{ok:true});
  if(!['GET','HEAD'].includes(method)&&request.headers.get('origin')&&new URL(request.headers.get('origin')!).host!==url.host)fail(403,'不允許跨站操作');
  if(path.startsWith('/api/admin/')&&!admin)fail(401,'請先使用 ChatGPT 登入');
  if(path==='/api/staff')return reply(200,{admin});
  if(path==='/api/login'&&method==='POST'){if(!admin)fail(401,'請使用 ChatGPT 登入');return reply(200,{ok:true});}
  const repo=createRepository(db);if(!seeded)seeded=repo.seed().catch(e=>{seeded=null;throw e;});await seeded;
  let b:any={};if(['POST','PATCH'].includes(method)){if(Number(request.headers.get('content-length')||0)>1024*1024)fail(413,'資料超過 1 MB');const raw=await request.text();if(new TextEncoder().encode(raw).length>1024*1024)fail(413,'資料超過 1 MB');try{b=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'資料格式錯誤');}
  if(path==='/api/products'&&method==='GET'){const key=url.searchParams.get('channel')==='order'?'orderVisible':'customerVisible';return reply(200,(await repo.products()).filter(p=>p[key]));}
  if(path==='/api/admin/products'&&method==='GET')return reply(200,await repo.products());
  if(path==='/api/admin/products'&&method==='POST')return reply(201,await repo.addProduct({...validateProduct(b),id:'p-'+crypto.randomUUID(),revision:1}));
  if(path.startsWith('/api/admin/products/')&&method==='PATCH'){const p=await repo.product(decodeURIComponent(path.split('/').at(-1)!));if(b.revision!==p.revision)fail(409,'商品已更新，請重新整理');return reply(200,await repo.updateProduct({...p,...validateProduct(b)}));}
  if(path==='/api/orders'&&method==='POST'){
   if(!admin)fail(401,'請先登入本站');const requestId=text(b.requestId,80),existing=await repo.findRequest(requestId);const result=(o:Order)=>({id:o.id,total:o.total,market:o.market});if(existing)return reply(201,result(existing));
   const channel=b.channel==='order'?'order':'customer',name=text(b.name,60),phone=typeof b.phone==='string'?b.phone.trim().slice(0,40):'';
   if(channel==='customer'&&!/^[\d+()\s-]{6,40}$/.test(phone))fail(400,'請填寫有效聯絡電話');if(!Array.isArray(b.items)||!b.items.length||b.items.length>300)fail(400,'請選擇 1 至 300 項商品');
   const ids=new Set<string>(),items:Item[]=[];for(const i of b.items){if(!i||typeof i!=='object')fail(400,'商品格式錯誤');const p=await repo.product(text(i.id,80)),qty=number(i.qty,9999);if(!qty||ids.has(p.id))fail(400,'商品重複或數量為零');ids.add(p.id);if(!p[channel==='order'?'orderVisible':'customerVisible'])fail(409,`${p.name} 已隱藏`);if(i.price!==p.price)fail(409,`${p.name} 價格已調整，請更新商品`);if(p.stock!==null&&p.stock<qty)fail(409,`${p.name} 庫存不足`);items.push({id:p.id,name:p.name,price:p.price,market:p.price===0,qty});}
   const o:Order={id:'FY-'+crypto.randomUUID(),channel,name,phone,note:typeof b.note==='string'?b.note.slice(0,500):'',createdAt:new Date().toISOString(),status:'new',items,returns:[],total:items.reduce((s,i)=>s+i.price*i.qty,0),market:items.some(i=>i.market),revision:1};
   try{await repo.place(o,requestId);}catch(e){const previous=await repo.findRequest(requestId);if(previous)return reply(201,result(previous));if(String(e).includes('CHECK constraint')||String(e).includes('UNIQUE constraint'))fail(409,'價格、上下架或庫存已變更，請更新商品後重試');throw e;}return reply(201,result(o));
  }
  if(path==='/api/admin/orders'&&method==='GET')return reply(200,await repo.orders());
  if(path.startsWith('/api/admin/orders/')&&method==='PATCH'){
   const o=await repo.order(decodeURIComponent(path.split('/').at(-1)!));if(b.revision!==o.revision)fail(409,'訂單已更新，請重新整理');let restock:Item[]=[];
   if(b.action==='ship'&&o.status==='new'){o.status='shipped';o.shippedAt=new Date().toISOString();}
   else if(b.action==='cancel'&&o.status==='new'){o.status='cancelled';restock=o.items;}
   else if(b.action==='return'&&['shipped','returned'].includes(o.status)){if(!Array.isArray(b.items)||!b.items.length)fail(400,'請選擇退貨商品');const ids=new Set();restock=b.items.map((i:any)=>{if(!i||typeof i!=='object')fail(400,'退貨格式錯誤');const original=o.items.find(x=>x.id===i.id)??fail(400,'退貨品項錯誤');if(ids.has(i.id))fail(400,'退貨品項錯誤');ids.add(i.id);const qty=number(i.qty),returned=o.returns.filter(r=>r.id===i.id).reduce((s,r)=>s+r.qty,0);if(!qty||qty+returned>original.qty)fail(400,'退貨數量超過已出貨數量');return {...original,qty,returnedAt:new Date().toISOString()};});o.returns.push(...restock);o.status='returned';}
   else fail(400,'此訂單狀態不允許這項操作');return reply(200,await repo.transition(o,b.revision,restock));
  }
  if(path==='/api/admin/backup'&&method==='GET')return reply(200,{schema:1,exportedAt:new Date().toISOString(),products:await repo.products(),orders:await repo.orders()},{'Content-Disposition':'attachment; filename="backstage-backup.json"'});
  fail(404,'找不到 API');
 }catch(e:any){if(!e.status)console.error(e);return reply(e.status||500,{error:e.status?e.message:'伺服器發生錯誤，請稍後再試'});}
}
