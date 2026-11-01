export type AccessConfig={ADMIN_EMAILS?:string};
export const GITHUB_ORIGIN='https://evil-deny.github.io';
export const GITHUB_ADMIN=GITHUB_ORIGIN+'/backstage/';
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function pkce(value:string){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function isNativeAdmin(request:Request,config:AccessConfig){
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email')?.toLowerCase();
 return !!id&&!!email&&(config.ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean).includes(email);
}
export async function isAdmin(request:Request,db:D1Database,config:AccessConfig){
 if(isNativeAdmin(request,config))return true;
 const bearer=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!bearer)return false;
 return !!await db.prepare('SELECT hash FROM api_grants WHERE hash=? AND expires>?').bind(await digest(bearer),Date.now()).first();
}
export function allowedOrigin(request:Request){
 const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin||origin===GITHUB_ORIGIN;
}
export function corsHeaders(request:Request):Record<string,string>{
 const origin=request.headers.get('origin');return origin&&allowedOrigin(request)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}:{};
}
export async function connectGithub(request:Request,db:D1Database,config:AccessConfig){
 const url=new URL(request.url),challenge=url.searchParams.get('challenge')||'',state=url.searchParams.get('state')||'';
 if(!/^[A-Za-z0-9_-]{43}$/.test(challenge)||!/^[a-f0-9]{64}$/.test(state))return new Response('請從 GitHub 後台按「管理員登入」開始連接。',{status:400});
 if(!request.headers.get('oai-authenticated-user-id'))return Response.redirect(new URL('/signin-with-chatgpt?return_to='+encodeURIComponent(url.pathname+url.search),url.origin),302);
 if(!isNativeAdmin(request,config))return new Response('此帳號沒有福緣後台管理權限。請使用網站擁有者帳號。',{status:403});
 const code=randomToken();await db.batch([db.prepare('DELETE FROM connection_tickets WHERE expires<=?').bind(Date.now()),db.prepare('DELETE FROM api_grants WHERE expires<=?').bind(Date.now()),db.prepare('INSERT INTO connection_tickets VALUES(?,?,?)').bind(await digest(code),challenge,Date.now()+120000)]);
 return new Response(null,{status:302,headers:{Location:GITHUB_ADMIN+'#code='+code+'&state='+state,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
export async function exchange(request:Request,db:D1Database,body:any){
 if(typeof body.code!=='string'||!/^[a-f0-9]{64}$/.test(body.code)||typeof body.verifier!=='string'||!/^[a-f0-9]{64}$/.test(body.verifier))return null;
 const row=await db.prepare('DELETE FROM connection_tickets WHERE hash=? AND challenge=? AND expires>? RETURNING hash').bind(await digest(body.code),await pkce(body.verifier),Date.now()).first();
 if(!row)return null;
 const token=randomToken(),expires=Date.now()+8*3600000;await db.prepare('INSERT INTO api_grants VALUES(?,?)').bind(await digest(token),expires).run();return {token,expires};
}
export async function revoke(request:Request,db:D1Database){const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(token)await db.prepare('DELETE FROM api_grants WHERE hash=?').bind(await digest(token)).run();}
