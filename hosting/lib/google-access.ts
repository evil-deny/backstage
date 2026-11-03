import {createRemoteJWKSet,jwtVerify} from 'jose';
export type AccessConfig={ADMIN_EMAILS?:string;GOOGLE_CLIENT_ID?:string};
export const GITHUB_ORIGIN='https://evil-deny.github.io';
export const GITHUB_ADMIN=GITHUB_ORIGIN+'/backstage/';
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function pkce(value:string){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
const emailAllowed=(email:string,config:AccessConfig)=>(config.ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
export async function isAdmin(request:Request,db:D1Database,config:AccessConfig){
 if(!config.GOOGLE_CLIENT_ID)return false;
 const bearer=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!bearer)return false;
 const grant=await db.prepare("SELECT subject,email FROM api_grants WHERE hash=? AND expires>? AND provider='google' AND audience=?").bind(await digest(bearer),Date.now(),config.GOOGLE_CLIENT_ID).first<{subject:string;email:string}>();
 return !!grant?.subject&&!!grant?.email&&emailAllowed(grant.email,config);
}
export function allowedOrigin(request:Request){
 const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin||origin===GITHUB_ORIGIN;
}
export function corsHeaders(request:Request):Record<string,string>{
 const origin=request.headers.get('origin');return origin&&allowedOrigin(request)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}:{};
}
export async function startGoogleLogin(db:D1Database,config:AccessConfig,body:any){
 if(!config.GOOGLE_CLIENT_ID)throw Object.assign(Error('Google 登入尚未完成設定'),{status:503});
 if(typeof body.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.challenge))throw Object.assign(Error('登入連接資料無效，請重新載入'),{status:400});
 const nonce=randomToken(),expires=Date.now()+10*60000;
 await db.batch([db.prepare('DELETE FROM google_login_challenges WHERE expires<=?').bind(Date.now()),db.prepare('INSERT INTO google_login_challenges VALUES(?,?,?)').bind(await digest(nonce),body.challenge,expires)]);
 return {nonce,expires,clientId:config.GOOGLE_CLIENT_ID};
}
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:8000});
export async function googleLogin(db:D1Database,config:AccessConfig,body:any){
 if(!config.GOOGLE_CLIENT_ID)throw Object.assign(Error('Google 登入尚未完成設定'),{status:503});
 if(typeof body.credential!=='string'||body.credential.length>16000||typeof body.verifier!=='string'||!/^[a-f0-9]{64}$/.test(body.verifier))return null;
 let payload;
 try{({payload}=await jwtVerify(body.credential,googleKeys,{algorithms:['RS256'],audience:config.GOOGLE_CLIENT_ID,issuer:['accounts.google.com','https://accounts.google.com'],requiredClaims:['sub','email','email_verified','nonce','iat','exp'],maxTokenAge:'10m',clockTolerance:5}));}catch{return null;}
 if(typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||payload.email_verified!==true||typeof payload.nonce!=='string'||!/^[a-f0-9]{64}$/.test(payload.nonce))return null;
 const email=payload.email.toLowerCase();
 if(!emailAllowed(email,config))throw Object.assign(Error('此 Google 帳號沒有管理權限，請改用管理員的 Gmail 帳號'),{status:403});
 const challenge=await db.prepare('DELETE FROM google_login_challenges WHERE hash=? AND challenge=? AND expires>? RETURNING hash').bind(await digest(payload.nonce),await pkce(body.verifier),Date.now()).first();
 if(!challenge)return null;
 const token=randomToken(),expires=Date.now()+8*3600000;
 await db.batch([db.prepare('DELETE FROM api_grants WHERE expires<=?').bind(Date.now()),db.prepare('INSERT INTO api_grants(hash,expires,provider,subject,email,audience) VALUES(?,?,?,?,?,?)').bind(await digest(token),expires,'google',payload.sub,email,config.GOOGLE_CLIENT_ID)]);
 return {token,expires,email};
}
export async function revoke(request:Request,db:D1Database){const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(token)await db.prepare('DELETE FROM api_grants WHERE hash=?').bind(await digest(token)).run();}
