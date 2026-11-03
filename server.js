import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(fileURLToPath(import.meta.url));
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const text=(v,max=200)=>typeof v==='string'&&v.trim().length&&v.length<=max?v.trim():fail(400,'文字欄位未填或過長');
const number=(v,max=1e8)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:fail(400,'價格與數量必須是有效的非負整數');
const hash=s=>createHash('sha256').update(s).digest();
export function createApp({dbPath=process.env.DB_PATH||join(ROOT,'data','backstage.sqlite'),password=process.env.ADMIN_PASSWORD,secure=process.env.COOKIE_SECURE==='true'}={}){
 if(!password||password.length<12)throw new Error('請設定至少 12 字元的 ADMIN_PASSWORD');
 mkdirSync(dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, request_id TEXT UNIQUE, body TEXT NOT NULL);');
 const sessions=new Map(),attempts=new Map();
 if(!db.prepare('SELECT id FROM products LIMIT 1').get())for(const p of JSON.parse(readFileSync(join(ROOT,'data','catalog.json'),'utf8')))db.prepare('INSERT INTO products VALUES(?,?)').run(p.id,JSON.stringify(p));
 const decodeProduct=body=>{const p=JSON.parse(body);return {...p,orderPrice:p.orderPrice??p.price};};
 const products=()=>db.prepare('SELECT body FROM products').all().map(r=>decodeProduct(r.body));
 const orders=()=>db.prepare('SELECT body FROM orders ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));
 const product=id=>{const row=db.prepare('SELECT body FROM products WHERE id=?').get(id);return row?decodeProduct(row.body):fail(404,'找不到商品');};
 const order=id=>{const row=db.prepare('SELECT body FROM orders WHERE id=?').get(id);return row?JSON.parse(row.body):fail(404,'找不到訂單');};
 const saveProduct=p=>db.prepare('INSERT OR REPLACE INTO products VALUES(?,?)').run(p.id,JSON.stringify({...p,revision:(p.revision||0)+1}));
 const saveOrder=o=>db.prepare('UPDATE orders SET body=? WHERE id=?').run(JSON.stringify(o),o.id);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const restock=(items)=>{for(const i of items){if(!i.qty)continue;const p=product(i.id);if(p.stock!==null){p.stock+=i.qty;saveProduct(p);}}};
 const checkProduct=b=>{
  const image=typeof b.image==='string'?b.image:'';if(image&&!/^https:\/\//i.test(image))fail(400,'圖片請使用 HTTPS 網址');
  if(!['冷凍','冷藏','乾貨'].includes(b.storage))fail(400,'請選擇保存方式');
  if(typeof b.orderVisible!=='boolean'||typeof b.customerVisible!=='boolean')fail(400,'請設定顯示狀態');
  return {name:text(b.name,120),category:text(b.category,80),type:text(b.type,80),storage:b.storage,image:image.slice(0,3000),price:number(b.price),orderPrice:number(b.orderPrice??b.price),stock:b.stock===null?null:number(b.stock),orderVisible:b.orderVisible,customerVisible:b.customerVisible};
 };
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)fail(403,'不允許跨站操作');
   const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
   const session=sessions.get(token),admin=Boolean(session&&session>Date.now());
   if(path.startsWith('/api/admin/')&&!admin)fail(401,'請先登入後台');
   let body={};
   if(['POST','PATCH'].includes(req.method)){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)fail(413,'資料超過 1 MB');chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'JSON 格式錯誤');}
    if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'資料格式錯誤');
   }
   if(path==='/api/login'&&req.method==='POST'){
    const key=req.socket.remoteAddress,entry=attempts.get(key)||{count:0,until:Date.now()+15*60e3};if(entry.until<Date.now()){entry.count=0;entry.until=Date.now()+15*60e3;}if(entry.count>=10)fail(429,'登入嘗試過多，請稍後再試');
    if(typeof body.password!=='string'||!timingSafeEqual(hash(body.password),hash(password))){entry.count++;attempts.set(key,entry);fail(401,'密碼錯誤');}
    attempts.delete(key);for(const [key,expiry] of sessions)if(expiry<Date.now())sessions.delete(key);const t=randomBytes(32).toString('hex');sessions.set(t,Date.now()+8*3600e3);return reply(200,{ok:true},{'Set-Cookie':`session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`});
   }
   if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);return reply(200,{ok:true},{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
   if(path==='/api/products'&&req.method==='GET'){const channel=url.searchParams.get('channel')==='order'?'order':'customer';return reply(200,products().filter(p=>p[channel+'Visible']).map(({orderPrice,...p})=>({...p,price:channel==='order'?orderPrice:p.price})));}
   if(path==='/api/admin/products'&&req.method==='GET')return reply(200,products());
   if(path==='/api/admin/products'&&req.method==='POST'){const p={...checkProduct(body),id:'p-'+randomUUID(),revision:0};saveProduct(p);return reply(201,product(p.id));}
   if(path.startsWith('/api/admin/products/')&&req.method==='PATCH')return reply(200,transaction(()=>{const p=product(decodeURIComponent(path.split('/').at(-1)));if(body.revision!==p.revision)fail(409,'此商品已在其他視窗更新，請重新整理後編輯');saveProduct({...p,...checkProduct({...body,orderPrice:body.orderPrice??p.orderPrice})});return product(p.id);}));
   if(path==='/api/orders'&&req.method==='POST')return reply(201,transaction(()=>{
    const requestId=text(body.requestId,80),existing=db.prepare('SELECT body FROM orders WHERE request_id=?').get(requestId);if(existing){const o=JSON.parse(existing.body);return {id:o.id,total:o.total,market:o.market};}
    const channel=body.channel==='order'?'order':'customer';
    const name=text(body.name,60),phone=typeof body.phone==='string'?body.phone.trim().slice(0,40):'';if(channel==='customer'&&!/^[\d+()\s-]{6,40}$/.test(phone))fail(400,'請填寫有效聯絡電話');
    if(!Array.isArray(body.items)||!body.items.length||body.items.length>300)fail(400,'請選擇 1 至 300 項商品');
    const ids=new Set();const items=body.items.map(i=>{if(!i||typeof i!=='object')fail(400,'商品格式錯誤');const p=product(text(i.id,80)),qty=number(i.qty,9999);if(!qty||ids.has(p.id))fail(400,'商品重複或數量為零');ids.add(p.id);if(!p[channel+'Visible'])fail(409,`${p.name} 已隱藏，請重新整理`);const price=channel==='order'?p.orderPrice:p.price;if(i.price!==price)fail(409,`${p.name} 價格已調整，請重新整理確認`);if(p.stock!==null&&p.stock<qty)fail(409,`${p.name} 庫存不足（剩 ${p.stock}）`);return {id:p.id,name:p.name,price,market:price===0,qty};});
    for(const i of items){const p=product(i.id);if(p.stock!==null){p.stock-=i.qty;saveProduct(p);}}
    const o={id:'FY-'+randomUUID(),channel,name,phone,note:typeof body.note==='string'?body.note.slice(0,500):'',createdAt:new Date().toISOString(),status:'new',items,returns:[],total:items.reduce((s,i)=>s+i.price*i.qty,0),market:items.some(i=>i.market),revision:1};
    db.prepare('INSERT INTO orders VALUES(?,?,?)').run(o.id,requestId,JSON.stringify(o));return {id:o.id,total:o.total,market:o.market};
   }));
   if(path==='/api/admin/orders'&&req.method==='GET')return reply(200,orders());
   if(path.startsWith('/api/admin/orders/')&&req.method==='PATCH')return reply(200,transaction(()=>{
    const o=order(decodeURIComponent(path.split('/').at(-1)));if(body.revision!==o.revision)fail(409,'訂單已更新，請重新整理');
    if(body.action==='ship'&&o.status==='new'){o.status='shipped';o.shippedAt=new Date().toISOString();}
    else if(body.action==='cancel'&&o.status==='new'){restock(o.items);o.status='cancelled';}
    else if(body.action==='return'&&['shipped','returned'].includes(o.status)){
     if(!Array.isArray(body.items)||!body.items.length)fail(400,'請選擇退貨商品');const ids=new Set();
     const returns=body.items.map(i=>{const original=o.items.find(x=>x.id===i.id);if(!original||ids.has(i.id))fail(400,'退貨品項錯誤');ids.add(i.id);const qty=number(i.qty),returned=o.returns.filter(x=>x.id===i.id).reduce((s,x)=>s+x.qty,0);if(!qty||qty+returned>original.qty)fail(400,'退貨數量超過已出貨數量');return {...original,qty,returnedAt:new Date().toISOString()};});restock(returns);o.returns.push(...returns);o.status='returned';
    }else fail(400,'此訂單狀態不允許這項操作');o.revision++;saveOrder(o);return o;
   }));
   if(path==='/api/admin/backup'&&req.method==='GET')return reply(200,{schema:1,exportedAt:new Date().toISOString(),products:products(),orders:orders()},{'Content-Disposition':'attachment; filename="backstage-backup.json"'});
   if(path==='/api/staff'&&req.method==='GET')return reply(200,{admin});
   if(path==='/api/health'&&req.method==='GET')return reply(200,{ok:true});
   if(path.startsWith('/api/'))fail(404,'找不到 API');
   if(!['GET','HEAD'].includes(req.method))fail(405,'不支援的操作');
   const files={'/':'index.html','/order':'shop.html','/customer':'shop.html','/app.js':'app.js','/shop.js':'shop.js','/metrics.js':'metrics.js','/style.css':'style.css','/logo.jpg':'logo.jpg'};const file=files[path];if(!file)fail(404,'找不到頁面');
   const data=readFileSync(join(ROOT,'public',file)),mime={'html':'text/html','js':'text/javascript','css':'text/css','jpg':'image/jpeg'}[file.split('.').at(-1)];
   res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(!e.status)console.error(e);if(!res.headersSent)reply(e.status||500,{error:e.status?e.message:'伺服器發生錯誤，請稍後再試'});else res.end();}
 });
 server.on('close',()=>db.close());return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const server=createApp();server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Backstage listening on port ${server.address().port}`));}
