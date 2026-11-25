# 福緣素食：自行持有的 Cloudflare 後端

正式前端維持 GitHub Pages；API 與兩個私人 D1 資料庫由店家自己的 Cloudflare 帳號管理，運行不需要 ChatGPT Plus、Sites 或本機電腦保持開機。

- API： https://fuyuan-api.fuyuan-gooddenny.workers.dev
- `DB`：`fuyuan-production`，正式營運資料。
- `BACKUPS`：`fuyuan-backups`，獨立的備份資料庫。
- 未啟用 R2，未升級 Workers Paid。免費方案仍有容量、請求與讀寫額度；達上限可能停止服務，不會由本程式自動升級付費。
- 管理員：`gooddenny931213@gmail.com`；員工由後台白名單管理。顧客仍免登入。

## 每日備份

Cloudflare Cron：`10 19 * * *`，每天台灣時間 03:10，保留最近 30 天。排程由 Cloudflare 執行，與 ChatGPT、自動化聊天及本機排程無關。

備份包含商品（含已刪除）、原始訂單與重送識別、結帳及抵扣關聯、退貨、批發人、員工白名單，以及已永久刪除訂單的最小防重送紀錄。登入權杖、Google 登入挑戰不備份，還原後重新登入。

後台「資料備份」可立即備份、下載當前完整資料、下載最近備份；營運總覽顯示成功時間。最近備份失敗或超過 36 小時沒有成功備份時會顯示警示。此警示在開啟後台時查詢，沒有另外寄送 Email。

每份備份以 SHA-256 校驗並確認全部分段寫入，才標記成功。下載歷史備份時再次驗證校驗碼。只有成功保存新備份後，才清理超過保留期的備份。

備份與正式資料雖在不同資料庫，仍屬同一 Cloudflare 帳號，不能代替離線備份。請至少每週下載一份到自己保管的裝置或私人儲存空間；不要提交到公開 GitHub。

應用程式 JSON 快照設有 24 MB 的單份上限，避免超過 Worker 記憶體限制；達此上限會記錄失敗並在後台提示改用 D1 SQL 匯出。這個上限與 D1 單庫 500 MB 的免費容量不同。資料增加前需調整為分段／SQL 匯出備份。D1 自帶的 Time Travel 另依 Cloudflare 方案保留（Free 為 7 天），並不代替下載保存。

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

只有管理員能從「已刪除訂單」操作，需明確確認。已含批發退貨、已納入結帳或抵扣的訂單不可永久刪除。刪除不會再次回補庫存；僅保留不含明細的 request tombstone，避免舊裝置重送同一請求而重新開單。舊備份依保留期存在，永久刪除不代表立刻抹除既有備份。

## 舊 Sites 相容連線

舊 Sites API 目前只轉送到此 Cloudflare API，讓未重新載入的舊頁面暫時可用。三個正式 GitHub 前端已直接連線 Cloudflare；Sites 停用後，重新整理正式 GitHub 頁面即可使用，不依賴該轉送服務。前端網址、Google JavaScript 來源和同一瀏覽器的顧客本機明細紀錄不變。
