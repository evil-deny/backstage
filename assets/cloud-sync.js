/* Shared connection for the three Fuyuan GitHub Pages interfaces. No secrets. */
(() => {
  'use strict';
  const API='https://fuyuan-backstage.syrupydock1.chatgpt.site';
  const ADMIN='https://evil-deny.github.io/backstage/';
  const SESSION='fuyuan-api-grant-v1',PENDING='fuyuan-connect-pkce-v1',RETURN='fuyuan-return-path-v1';
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function grant(){try{const s=JSON.parse(sessionStorage.getItem(SESSION)||'null');if(s&&s.expires>Date.now())return s;sessionStorage.removeItem(SESSION);}catch{}return null;}
  async function request(path,method='GET',body){
    const session=grant(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch(API+'/api'+path,{method,credentials:'same-origin',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(session?{Authorization:'Bearer '+session.token}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      let data;try{data=await r.json();}catch{throw Error('共用資料服務暫時無法回應，請稍後重試。');}
      if(!r.ok){if(r.status===401)sessionStorage.removeItem(SESSION);throw Object.assign(Error(data.error||'同步失敗'),{status:r.status});}return data;
    }catch(e){if(e.name==='AbortError')throw Error('連線逾時，請檢查網路後重試；相同訂單重送不會重複建立。');throw e;}finally{clearTimeout(timer);}
  }
  async function connect(){
    const verifier=random(),state=random();sessionStorage.setItem(PENDING,JSON.stringify({verifier,state}));
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    const challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    location.assign(API+'/connect?challenge='+encodeURIComponent(challenge)+'&state='+state);
  }
  function notice(message){let el=document.getElementById('fuyuan-sync-notice');if(!el){el=document.createElement('div');el.id='fuyuan-sync-notice';el.setAttribute('role','status');el.style.cssText='padding:10px 16px;background:#e8f3ed;color:#205d45;text-align:center;font:600 14px/1.6 sans-serif;position:fixed;bottom:110px;left:50%;transform:translateX(-50%);width:min(94vw,680px);border-radius:10px;box-shadow:0 5px 25px #0002;z-index:9999';document.body.prepend(el);}el.textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.remove(),10000);}
  function block(message,action,label='重新連線'){
    let el=document.getElementById('fuyuan-sync-block');if(!el){el=document.createElement('section');el.id='fuyuan-sync-block';el.style.cssText='position:fixed;inset:0;z-index:10000;background:#f5f8f5;display:grid;place-items:center;padding:24px';document.body.append(el);}
    el.innerHTML='<div style="max-width:460px;padding:32px;border:1px solid #d6e5dc;background:white;border-radius:16px;font:18px/1.7 sans-serif;color:#194a36"><h1 style="font-size:26px">福緣共用資料服務</h1><p>'+esc(message)+'</p><button style="background:#20745d;color:white;border:0;border-radius:8px;padding:14px 24px;font:inherit;cursor:pointer">'+esc(label)+'</button></div>';
    el.querySelector('button').onclick=action;
  }
  const ready=(async()=>{
    const params=new URLSearchParams(location.hash.slice(1)),code=params.get('code');if(!code)return;
    const state=params.get('state');history.replaceState(null,'',location.pathname+location.search);
    const pending=JSON.parse(sessionStorage.getItem(PENDING)||'null');sessionStorage.removeItem(PENDING);
    if(!pending||state!==pending.state)throw Error('登入連接狀態不符，請重新按管理員登入。');
    const s=await request('/auth/exchange','POST',{code,verifier:pending.verifier});sessionStorage.setItem(SESSION,JSON.stringify(s));
    const returnTo=sessionStorage.getItem(RETURN);sessionStorage.removeItem(RETURN);
    if(returnTo==='/order/'&&location.pathname!=='/order/')location.replace('https://evil-deny.github.io/order/');
  })();
  ready.catch(e=>{notice(e.message);});
  async function requireStaff(){
    await ready;try{if((await request('/staff')).admin)return;}catch{}
    block('員工開單與訂單紀錄需要管理員登入。顧客可直接使用 customer 訂購頁。',()=>{sessionStorage.setItem(RETURN,'/order/');location.assign(ADMIN);},'前往管理員登入');
    return new Promise(()=>{});
  }
  async function products(channel='customer'){return request(channel==='all'?'/admin/products':'/products?channel='+channel);}
  async function loadProducts(channel){for(;;){try{await ready;const data=await products(channel);document.getElementById('fuyuan-sync-block')?.remove();return data;}catch(e){await new Promise(resolve=>block(e.message,resolve));}}}
  async function signOut(){const hadGrant=!!grant();try{await request('/logout','POST',{});}finally{sessionStorage.removeItem(SESSION);if(!hadGrant&&location.origin===API)location.assign(API+'/signout-with-chatgpt?return_to=/');}}
  window.FuyuanCloud={API,ADMIN,ready,request,connect,requireStaff,products,loadProducts,orders:()=>request('/admin/orders'),place:b=>request('/orders','POST',b),transition:(id,b)=>request('/admin/orders/'+encodeURIComponent(id),'PATCH',b),notice,random,signOut};
})();
