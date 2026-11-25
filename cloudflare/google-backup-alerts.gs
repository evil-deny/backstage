// 私人 Google Apps Script。只查備份狀態，不存取或寄送商品、訂單及客戶資料。
const RECIPIENT = 'gooddenny931213@gmail.com';
const HEALTH_URL = 'https://fuyuan-api.fuyuan-gooddenny.workers.dev/api/backup-health';
const ADMIN_URL = 'https://evil-deny.github.io/backstage/';

function setupBackupAlerts() {
  MailApp.sendEmail({
    to: RECIPIENT,
    subject: '福緣備份通知已啟用',
    body: '這是備份警示測試信。系統會每小時檢查一次；發現備份失敗、超過 36 小時沒有成功備份，或無法連線時，會寄信通知。異常未恢復時每 24 小時提醒一次，恢復後會寄出恢復通知。\n\n後台：' + ADMIN_URL,
    name: '福緣備份監控'
  });
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'checkBackupHealth')) {
    ScriptApp.newTrigger('checkBackupHealth').timeBased().everyHours(1).create();
  }
  checkBackupHealth();
}

function checkBackupHealth() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const state = PropertiesService.getScriptProperties();
    let healthy = false;
    let reason = '無法連線或取得備份狀態';
    try {
      const response = UrlFetchApp.fetch(HEALTH_URL, {muteHttpExceptions: true, followRedirects: false});
      const data = JSON.parse(response.getContentText());
      healthy = response.getResponseCode() === 200 && data.ok === true && data.code === 'ok';
      const reasons = {failed: '最近一次備份失敗', stale: '超過 36 小時沒有成功備份', running_too_long: '備份執行超過 30 分鐘', unavailable: '備份服務無法讀取'};
      if (reasons[data.code]) reason = reasons[data.code];
    } catch (error) {
      reason = '網站連線失敗或備份狀態回應異常';
    }
    const active = state.getProperty('ALERT_ACTIVE') === 'true';
    const lastSent = Number(state.getProperty('LAST_ALERT_SENT') || 0);
    if (!healthy && (!active || Date.now() - lastSent >= 24 * 3600000)) {
      MailApp.sendEmail({to: RECIPIENT, subject: '【福緣備份警示】請檢查資料備份', body: reason + '\n檢查時間：' + new Date().toISOString() + '\n\n請登入後台的「資料備份」查看原因，並視需要立即備份。\n' + ADMIN_URL, name: '福緣備份監控'});
      state.setProperties({ALERT_ACTIVE: 'true', LAST_ALERT_SENT: String(Date.now())});
    } else if (healthy && active) {
      MailApp.sendEmail({to: RECIPIENT, subject: '【福緣備份】備份狀態已恢復正常', body: '備份監控已確認恢復正常。\n\n' + ADMIN_URL, name: '福緣備份監控'});
      state.deleteProperty('ALERT_ACTIVE');
      state.deleteProperty('LAST_ALERT_SENT');
    }
  } finally {
    lock.releaseLock();
  }
}
