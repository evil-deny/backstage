// Public monitor output contains status only, never order data, errors or backup downloads.
export async function backupHealth(db,now=Date.now()){
 const results=await db.batch([
  db.prepare('SELECT status,started_at FROM backup_runs ORDER BY started_at DESC LIMIT 1'),
  db.prepare("SELECT completed_at FROM backup_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1")
 ]);
 const latest=results[0].results[0],success=results[1].results[0];
 let code='ok';
 if(latest?.status==='failed')code='failed';
 else if(latest?.status==='running'&&now-Date.parse(latest.started_at)>30*60000)code='running_too_long';
 else if(!success||!Number.isFinite(Date.parse(success.completed_at))||now-Date.parse(success.completed_at)>36*3600000)code='stale';
 return {ok:code==='ok',code};
}
