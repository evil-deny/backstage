# 福緣共用資料服務

正式入口：<https://evil-deny.github.io/backstage/>、<https://evil-deny.github.io/order/>、<https://evil-deny.github.io/customer/>。此 Sites 服務提供共用 API 與 Cloudflare D1；Sites 的既有發布整合保留，管理員身份改由店家指定的 Google Identity Services 驗證。

管理後台採 Google 帳號登入。正式環境必須設定 `GOOGLE_CLIENT_ID` 及 `ADMIN_EMAILS`；未設定則拒絕管理存取。請在 Google Cloud 的網頁應用程式用戶端設定兩個 JavaScript 來源：`https://evil-deny.github.io` 與 `https://fuyuan-backstage.syrupydock1.chatgpt.site`。使用 popup callback，不需要 redirect URI 或用戶端密鑰。測試模式須把允許登入的管理員加入 Google Auth Platform 的測試使用者。

伺服器透過 jose 與 Google JWKS 驗證簽章、issuer、audience、有效時間及已驗證 email，再檢查管理員白名單。以 sub 識別 Google 帳號，nonce 綁定瀏覽器的 PKCE verifier 並原子性消耗。八小時的 API 授權僅儲存雜湊，並綁定 Google subject、email、client ID；原始 token 僅存在當前分頁 sessionStorage。白名單異動、換 client ID、授權過期或登出會使舊授權失效。舊 ChatGPT token、平台身份標頭及 `/api/auth/exchange` 都不再授予管理權限。

`/api/auth/google/start` 產生短效挑戰，`/api/auth/google` 驗證 Google 憑證並發出管理授權。Google client ID 是公開識別碼；不要把任何 Gmail 密碼或用戶端密鑰放進原始碼。此登入流程沒有要求 Gmail 郵件權限。

員工訂購、全部訂單、揀貨、出貨與退貨，依店家要求免登入；顧客送單共用同一待出貨清單。商品價格／庫存設定、分析與備份需要管理員 Google 登入。跨來源只允許此 Site 與 GitHub 網域。

已發布 Drizzle migrations 不可修改。新增 schema 先執行 `npm run db:generate`；`0003` 保留歷史資料並使舊授權無法通過新的 provider 檢查。`node --test test/hosted.test.mjs` 驗證身份、庫存與訂單流程；建置及部署沿用 Sites 工作流程。
