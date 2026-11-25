import {handleBackstage} from '../hosting/lib/backstage';
import {isAdmin,allowedOrigin,corsHeaders,type AccessConfig} from '../hosting/lib/google-access';
import {createBackup,readBackup,snapshotDatabase,pendingBackupCleanup,sanitizeBackup} from './snapshot.mjs';
import {backupHealth} from './backup-health.mjs';

type Env=AccessConfig&{DB:D1Database;BACKUPS:D1Database;MIGRATION_READ_ONLY?:string};
const reply=(request:Request,data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...corsHeaders(request),...headers}});
const worker={
 async fetch(request:Request,env:Env){
  const url=new URL(request.url),path=url.pathname;
  if(!allowedOrigin(request))return reply(request,{error:'不允許此來源操作'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(request)});
  if(path==='/api/backup-health'&&request.method==='GET'){
   try{const health=await backupHealth(env.BACKUPS);return reply(request,health,health.ok?200:503);}
   catch{return reply(request,{ok:false,code:'unavailable'},503);}
  }
  if(path==='/api/health'){const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory').first<{n:number}>();return reply(request,{ok:true,host:'owner-cloudflare',databaseReady:!!row?.n});}
  if(path.startsWith('/api/admin/backups')||path==='/api/admin/backup/full'){
   if(!await isAdmin(request,env.DB,env))return reply(request,{error:'請先使用 Google 帳號登入'},401);
   try{
    if(path==='/api/admin/backups'&&request.method==='GET'){
     const recent=(await env.BACKUPS.prepare('SELECT id,started_at,completed_at,status,byte_length,counts,error FROM backup_runs ORDER BY started_at DESC LIMIT 10').all()).results;
     const lastSuccess=await env.BACKUPS.prepare("SELECT id,completed_at,byte_length FROM backup_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").first();
     const cleanup=await pendingBackupCleanup(env.DB,env.BACKUPS);
     return reply(request,{cleanupPending:cleanup.ids.length,schedule:'每天凌晨 03:10（台灣時間）',retentionDays:30,lastSuccess,recent,warning:cleanup.ids.length?'永久刪除訂單的舊備份尚待清理，請按「繼續清理舊備份」。':recent[0]?.status==='failed'?'最近一次備份失敗，請檢查資料備份頁的原因。':!lastSuccess||Date.now()-Date.parse(String(lastSuccess.completed_at))>36*3600000?'尚無最近 36 小時內的成功備份，請立即檢查。':null});
    }
    if(path==='/api/admin/backups/cleanup'&&request.method==='GET')return reply(request,await pendingBackupCleanup(env.DB,env.BACKUPS));
    if(path==='/api/admin/backups/cleanup'&&request.method==='POST'){
     const body:any=await request.json();
     await env.BACKUPS.prepare("DELETE FROM backup_chunks WHERE backup_id IN (SELECT id FROM backup_runs WHERE status='failed')").run();
     if(body.finalize===true)return reply(request,await pendingBackupCleanup(env.DB,env.BACKUPS));
     if(typeof body.id!=='string'||body.id.length>120)return reply(request,{error:'請指定有效備份'},400);
     return reply(request,await sanitizeBackup(env.DB,env.BACKUPS,body.id));
    }
    if(path==='/api/admin/backups/create'&&request.method==='POST')return reply(request,await createBackup(env.DB,env.BACKUPS),201);
    if(path==='/api/admin/backup/full'&&request.method==='GET')return reply(request,await snapshotDatabase(env.DB),200,{'Content-Disposition':'attachment; filename="fuyuan-full-backup.json"'});
    if(path==='/api/admin/backups/download'&&request.method==='GET')return reply(request,await readBackup(env.BACKUPS,url.searchParams.get('id')||'',env.DB),200,{'Content-Disposition':'attachment; filename="fuyuan-daily-backup.json"'});
    return reply(request,{error:'找不到備份操作'},404);
   }catch(error:any){return reply(request,{error:error.message||'備份失敗'},500);}
  }
  if(path.startsWith('/api/')){
   if(env.MIGRATION_READ_ONLY==='true')return reply(request,{error:'資料搬遷驗證中，請稍後再試'},503,{'Retry-After':'60'});
   return handleBackstage(request,env.DB,env);
  }
  if(path==='/'||path==='/connect')return Response.redirect('https://evil-deny.github.io/backstage/',302);
  if(path==='/order')return Response.redirect('https://evil-deny.github.io/order/',302);
  if(path==='/customer')return Response.redirect('https://evil-deny.github.io/customer/',302);
  return new Response('Not found',{status:404});
 },
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){
  if(env.MIGRATION_READ_ONLY==='true')return;
  ctx.waitUntil(createBackup(env.DB,env.BACKUPS).then(result=>{console.log('Daily backup complete',result.id);}).catch(error=>{console.error('Daily backup failed',error.message);throw error;}));
 }
};
export default worker;
