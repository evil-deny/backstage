# 福緣素食：自行持有的 Cloudflare 後端

正式前端維持 GitHub Pages；API 與兩個私人 D1 資料庫由店家自己的 Cloudflare 帳號管理，運行不需要 ChatGPT Plus、Sites 或本機電腦保持開機。

- API： https://fuyuan-api.fuyuan-gooddenny.workers.dev
- `DB`：`fuyuan-production`，正式營運資料。
- `BACKUPS`：`fuyuan-backups`，獨立的備份資料庫。
- 未啟用 R2，未升級 Workers Paid。免費方案仍有容量、請求與讀寫額度；達上限可能停止服務，不會由本程式自動升級付費。
- 管理員：`gooddenny931213@gmail.com`；員工由後台白名單管理。顧客仍免登入。

## 每日備份

Cloudflare Cron：`10 19 * * *`，每天台灣時間 03:10，保留最近 30 天。排程由 Cloudflare 執行，與 ChatGPT、自動化聊天及本機排程無關。

備份包含商品（含已刪除）、原始訂單與重送識別、結帳及抵扣關聯、退貨、批發人、員工白名單及信箱綁定的大名，以及已永久刪除訂單的最小防重送紀錄。登入權杖、Google 登入挑戰不備份，還原後重新登入。

後台「資料備份」可立即備份、下載當前完整資料、下載最近備份；營運總覽顯示成功時間。最近備份失敗或超過 36 小時沒有成功備份時會顯示警示。此畫面警示在開啟後台時查詢；另由下述 Google 排程寄送 Email。

每份備份以 SHA-256 校驗並確認全部分段寫入，才標記成功。下載歷史備份時再次驗證校驗碼。只有成功保存新備份後，才清理超過保留期的備份。

備份與正式資料雖在不同資料庫，仍屬同一 Cloudflare 帳號，不能代替離線備份。請至少每週下載一份到自己保管的裝置或私人儲存空間；不要提交到公開 GitHub。

應用程式 JSON 快照設有 24 MB 的單份上限，避免超過 Worker 記憶體限制；達此上限會記錄失敗並在後台提示改用 D1 SQL 匯出。這個上限與 D1 單庫 500 MB 的免費容量不同。資料增加前需調整為分段／SQL 匯出備份。D1 自帶的 Time Travel 另依 Cloudflare 方案保留（Free 為 7 天），並不代替下載保存。

## Email 備份警示

私人 [Google Apps Script 專案](https://script.google.com/home/projects/12XrAe7m3FNtVrlNmPNzm2Xjqm59_gz6-LtySfXJS6DubrJhVFrE1jzjK/edit) 由 `gooddenny931213@gmail.com` 持有，已建立每小時執行 `checkBackupHealth` 的觸發條件，首次設定及測試寄信已執行完成。原始碼為 `google-backup-alerts.gs`。

監控只讀取公開的 `/api/backup-health` 彙總狀態，不讀取、寄出商品、訂單或顧客資料。最近備份失敗、執行超過 30 分鐘、超過 36 小時沒有成功備份，或網站無法連線時，寄到 `gooddenny931213@gmail.com`；異常持續時每 24 小時提醒一次，恢復後再寄一封通知。正常時不寄信。

不需購買網域或啟用付費寄信服務。排程在 Google 端執行，不需本機開機；仍受 Apps Script 的免費服務額度及 Gmail 投遞影響，請保留後台警示與定期下載備份。Google 觸發條件自身失敗通知維持每天通知擁有者。重新設定時，在自己的 Apps Script 專案貼入原始碼、審查 Google 權限後執行一次 `setupBackupAlerts`（會寄測試信並避免重複建立排程）。

## 本機維護與發布

需要 Node.js 24 以上與自己的 Cloudflare 帳號。從此目錄執行：

```sh
npm ci
npx wrangler login
npm test
npx wrangler deploy --dry-run
npm run deploy
```

程式重用 `../hosting/lib/` 的業務邏輯；Wrangler 的 `jose` alias 指向本目錄依賴。`wrangler.jsonc` 保存資源綁定與公開 Google Client ID，不包含 API Token 或 Google 用戶端密鑰。不要把登入憑證、`.dev.vars`、資料匯出檔提交到 Git。

`MIGRATION_READ_ONLY=true` 會暫停業務 API；平常必須保持 `false`。先套用新的資料表 migration 再發布使用新資料表的程式。新空資料庫可依序套用 `../hosting/drizzle/*.sql`；現有資料庫只套用尚未執行的新增 migration，不要重跑全部。

## 還原驗證

`restore.mjs` 只產生 SQL 並在本機記憶體中的空 SQLite 實際還原及核對資料，不會改動雲端：

```sh
node restore.mjs /private/backup.json /private/restore.sql
```

之後先在新的空 D1 匯入這份 SQL，核對商品、庫存、訂單、結帳與白名單，再切換 `DB` 綁定。不要直接對有營運資料的資料庫匯入；這些 SQL 使用 INSERT 而非覆寫，避免誤覆蓋。正式切換前必須暫停舊資料寫入，避免漏單。

手動 SQL 匯出：

```sh
npx wrangler d1 export DB --remote --output /private/fuyuan.sql
```

匯出可能短暫阻擋資料庫請求，請選低流量時段。Wrangler 會顯示短效下載連結，請勿公開分享。

## 永久刪除訂單

只有管理員能從「已刪除訂單」操作。先顯示受影響結帳單、手填退貨及其他訂單數量，再明確確認。正式訂單及自身退貨內容直接 DELETE，不可還原。包含該訂單或其退貨抵扣的整張結帳單、相依手填退貨與抵扣結帳單會一併刪除，包含已收款及已軟刪除的紀錄；其他訂單仍保留，釋放結帳占用後可重新結帳，不悄悄改寫已收款單的金額。結帳 revision 與訂單 revision 在同一 D1 transaction 檢查，並行變更時拒絕操作。庫存不會再次回補。

僅保留 SHA-256 單向雜湊的 request／order 識別及刪除時間，避免舊裝置重送恢復訂單，並能比對舊備份清理目標；不保留原始訂單編號、請求編號、姓名、商品或金額。此雜湊不會出現在訂單清單。

前端接著逐份清理 BACKUPS 的完整備份：清除目標訂單與相依帳款後，原子替換分段、校驗碼、大小與筆數，保留無關資料；失敗備份的殘留分段也清除。中途斷線時不顯示全部成功，資料備份頁持續警示並提供「繼續清理舊備份」。下載 API 會先套用最新刪除雜湊，尚未完成實體清理的備份也不會下載出已刪除的訂單。新建備份完成前再核對刪除標記，避免與永久刪除同時操作時漏清理。

此處清理範圍為程式管理的正式資料與 BACKUPS 快照。先前已下載到裝置／另行匯出的檔案需自行刪除；Cloudflare D1 平台自帶、始終啟用的 Time Travel 歷史由平台依免費方案保留 7 天，不能透過本功能逐筆抹除。不要使用刪除前的 Time Travel 或離線檔案還原正式資料，否則會帶回舊資料。

## 舊 Sites 相容連線

舊 Sites API 目前只轉送到此 Cloudflare API，讓未重新載入的舊頁面暫時可用。三個正式 GitHub 前端已直接連線 Cloudflare；Sites 停用後，重新整理正式 GitHub 頁面即可使用，不依賴該轉送服務。前端網址、Google JavaScript 來源和同一瀏覽器的顧客本機明細紀錄不變。

## 員工帳號大名

`0010_staff_profiles.sql` 新增 `staff_profiles`，以實際登入信箱為主鍵。員工只能透過 `/api/staff/profile` 讀寫自己的大名，請求指定的其他信箱不會被採用。前端修改大名離開欄位時儲存，成功開單也在同一個交易保存；重新登入或換裝置會自動帶入，送單後不再清空大名。歷史訂單姓名不回寫。

完整備份升為版本 2，包含帳號大名；舊版本 1 備份仍可讀取及還原（沒有帳號大名的舊檔以空表補齊）。部署前先套用此新增 migration。
