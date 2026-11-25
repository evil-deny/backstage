export function initBackups({api,run,toast,download}){
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚無成功備份';
 async function refresh(){
  try{const data=await api('admin/backups');$('backupHealth').textContent=data.warning||'每日自動備份正常';$('backupHealth').className=data.warning?'backup-warning':'backup-ok';$('backupLastSuccess').textContent='最近成功：'+time(data.lastSuccess?.completed_at);$('backupSchedule').textContent=data.schedule+'，保留最近 '+data.retentionDays+' 天。';
   $('backupRecords').innerHTML=data.recent.map(record=>`<tr><td>${esc(time(record.started_at))}</td><td>${record.status==='complete'?'成功':record.status==='running'?'處理中':'失敗'}</td><td>${record.byte_length?Math.ceil(record.byte_length/1024)+' KB':'—'}</td><td>${record.status==='complete'?`<button data-download-backup="${esc(record.id)}">下載備份</button>`:esc(record.error||'')}</td></tr>`).join('')||'<tr><td colspan="4">尚無備份紀錄</td></tr>';
  }catch(error){$('backupHealth').textContent='無法確認備份狀態，請開啟資料備份頁重試';$('backupHealth').className='backup-warning';throw error;}
 }
 $('createBackup').onclick=()=>run(async()=>{const button=$('createBackup');button.disabled=true;button.textContent='正在備份…';try{await api('admin/backups/create','POST',{});await refresh();toast('備份成功，完整性校驗已通過');}finally{button.disabled=false;button.textContent='立即備份';}});
 $('refreshBackups').onclick=()=>run(refresh);
 document.addEventListener('click',event=>{const button=event.target.closest('[data-download-backup]');if(button)run(async()=>{button.disabled=true;try{const data=await api('admin/backups/download?id='+encodeURIComponent(button.dataset.downloadBackup));download('福緣每日備份-'+data.exportedAt.slice(0,10)+'.json',JSON.stringify(data));}finally{button.disabled=false;}});});
 return {refresh};
}
