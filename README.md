# 福緣素食 Backstage

在此 repo 集中管理 order 與 customer 的商品、價格、可售庫存、上下架與商品銷售分析。正式介面使用 GitHub Pages，並連接共用雲端 API／D1 資料庫；另保留 Node.js 24 內建 SQLite 的獨立自架版本。

## GitHub Pages 與共用資料服務

正式入口保留在 GitHub Pages：

- 營運後台：<https://evil-deny.github.io/backstage/>
- 員工開單：<https://evil-deny.github.io/order/>
- 顧客訂購：<https://evil-deny.github.io/customer/>

三個前端都連到同一個雲端 API 與 D1 資料庫。後台儲存價格、品項、可售庫存、order/customer 各自的顯示狀態後，order 每 15 秒、customer 每 20 秒更新，切回頁面也會更新；送單時一律由伺服器再驗證。日常商品維護不需要修改或推送三個 repo。

員工與顧客訂購皆免登入，員工頁保留原本訂購／出貨／退貨流程，不含商品管理入口。正式後台使用 Google Identity Services「使用 Google 帳號登入」，伺服器以 Google 公鑰驗證 RS256 簽章、issuer、GOOGLE_CLIENT_ID audience、有效時間、已驗證的 email 與 ADMIN_EMAILS 管理員白名單。Google 的 sub 為帳號識別，nonce 與瀏覽器 PKCE verifier 綁定並一次性消耗，阻擋重播與登入 CSRF。

登入後取得八小時 API 授權，伺服器只儲存 token 雜湊及 Google 帳號／用戶端關聯，原始 token 僅存於當前分頁 sessionStorage。登出會撤銷 API 授權；舊版 ChatGPT 授權及平台登入標頭不再授予管理權限。Google 用戶端只需身分登入，沒有 Gmail 郵件存取權，也不使用 OAuth 用戶端密鑰。

公開範圍為各入口商品目錄與員工／顧客送單。員工免登入入口不驗證身份，任何取得網址的人都可查看批發價及以員工來源送單。依店家要求，員工訂單清單、聯絡資料及出貨／退貨操作透過公開 `/api/staff/orders` 提供；商品修改、備份、分析與 `/api/admin/*` 一律需要管理權限。API 只允許此 Site 與 `https://evil-deny.github.io` 的瀏覽器來源；公開跨來源不代表後台管理權限。

`index.html` 與 `assets/` 是 GitHub Pages 後台；`shared/cloud-sync.js` 是三個 repo 共用的連線來源。`hosting/` 保存 Sites API 部署的完整來源，雲端資料庫跨版本保存。API 網址仍是 <https://fuyuan-backstage.syrupydock1.chatgpt.site>，但使用者操作入口保留在原本 GitHub 網址；直接造訪 API 網址也保留管理介面。

`hosting/` 修改須透過 Sites 建置／發布，單純推送 GitHub 不會更新 API。前端 GitHub Pages 從 main 根目錄發布。部署需先讓受保護的 API 版本與新增資料表生效，再公開 API，避免公開舊版管理權限。

原先瀏覽器內的舊訂單與庫存調整不會自動匯入或覆寫雲端。既有資料保留於原瀏覽器；分析以共用資料庫中實際記錄的訂單為準。根目錄 Node.js 版本使用獨立本機 SQLite，供獨立自架與測試，與正式共用資料庫不同步。

雲端版測試：在 `hosting/` 安裝依賴後執行 `node --test test/hosted.test.mjs`；根目錄 `npm test` 測試原本 Node.js 版本。

## 三個入口

| 路徑 | 用途 | 權限 |
| --- | --- | --- |
| `/` | 營運總覽、商品管理、訂單、商品分析、CSV、備份 | 管理員登入 |
| `/order` | 員工開單 | 訂購、全部訂單、出貨與退貨免登入 |
| `/customer` | 顧客訂購、確認明細、送單、複製與 LINE 聯絡 | 公開訂購；顧客畫面不提供其他訂單清單 |

兩個整合入口使用相同商品與庫存；可獨立控制商品是否在 order、customer 顯示。修改後，新開頁面、切回頁面或按「更新商品」即可讀取；送單時伺服器再次驗證價格、上下架與庫存。後台按「重新整理」取得其他裝置的新資料。

原本 order／customer repo 已接上共用資料服務；員工頁保留原操作流程，僅商品清單採顧客式排版。正式使用請走上方三個 GitHub Pages 網址；下面本機啟動說明適用獨立 Node.js 版本。

## 本機啟動

需求：Node.js 24 以上。

```powershell
Copy-Item .env.example .env
# 編輯 .env，將 ADMIN_PASSWORD 換成自己的密碼（至少 12 字元）
node --env-file=.env server.js
```

開啟 `http://127.0.0.1:3000/` 登入。`.env` 不會被提交；程式沒有預設管理密碼，未設定時不會啟動。使用 `npm start` 前請先將環境變數設定至作業系統。

```powershell
npm test
```

## 資料來源與庫存

初始目錄擷取自兩 repo 的 `index.html`，共 **197 項**，來源 commit 記錄於 `data/sources.json`。

- ID、名稱、價格、初始庫存與圖片：order 的 PRODUCTS。
- 商品類別、冷凍／冷藏／乾貨：customer 的 PRODUCTS。
- 批發價 `orderPrice` 與顧客價 `price` 可分別設定，既有商品的兩種價格初始沿用原價。未設定批發價的舊資料會安全沿用原價，第一次儲存後獨立保存；歷史單價不變。
- 初始庫存是原始碼預設值，**不是店家現場盤點值**。第一次營運前請在後台校正可售庫存。
- `stock: null` 為不控管，`stock: 0` 為售完；`price: 0` 為時價。
- 商品新增／編輯／隱藏寫入 SQLite；seed 檔只在新建空資料庫時載入。日常維護請使用後台，直接修改 seed 不會覆寫既有資料庫。
- 舊站瀏覽器儲存的訂單與商品調整不在 GitHub 原始碼中，因此無法從 clone 自動取得。本服務不含舊站歷史訂單；分析從整合入口的新訂單開始累積。
- 圖片沿用原 repo 提供的 HTTPS 外部網址，可能因原站圖片下架而無法顯示；後台可更換網址。

## 訂單與分析規則

送出訂單時，伺服器在同一 SQLite transaction 驗證商品與扣除可售庫存。重送相同 requestId 會取得同一筆訂單，不會重複扣庫存；價格過期、已隱藏或庫存不足時整單拒絕，顧客須更新商品後重新確認。

訂單由「待出貨」轉為「已出貨」，或在待出貨時取消。出貨不再扣第二次庫存，取消回補庫存；出貨後可登記分次部分退貨，每次回補對應件數，累計不可超過原單數量。商品採隱藏而非刪除，以保留訂單關聯。

每個訂單品項保留成交時的名稱、單價與數量。日後改價不會重算舊單，避免歷史營業額漂移。分析只計已出貨／有退貨訂單，扣除退貨，依台灣時區下單日期與訂購來源篩選。退貨歸回原始訂單的下單期間，並非退貨當日現金流報表。時價商品尚未定價的部分不計金額；此版沒有時價議價、付款、發票或毛利功能。

## 部署

**GitHub Pages 只能提供靜態檔案，不能執行本服務或保存 SQLite。** 將此 repo 部署到支援 Node.js 24 或 Docker 且有永久磁碟的主機。此 repo 的程式碼推送不等於正式服務已上線。

直接執行時設定：

| 變數 | 正式環境設定 |
| --- | --- |
| `ADMIN_PASSWORD` | 自訂長密碼，由主機 secret 管理，不放進 repo |
| `HOST` | `0.0.0.0`（本機預設 `127.0.0.1`） |
| `PORT` | 主機提供的埠號，預設 3000 |
| `DB_PATH` | 永久磁碟上的 SQLite 檔案完整路徑 |
| `COOKIE_SECURE` | 使用 HTTPS 時設為 `true` |

啟動命令 `node server.js`，健康檢查 `GET /api/health`。在 HTTPS 反向代理後執行，代理應保留外部 Host header，以便來源檢查正確運作。採單一服務實例與本機永久磁碟；不要在多個無共用磁碟的副本各自啟動 SQLite。

Docker 範例（先在終端環境設定 ADMIN_PASSWORD）：

```sh
docker build -t fuyuan-backstage .
docker volume create fuyuan-data
docker run -d --name fuyuan-backstage --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env ADMIN_PASSWORD \
  -v fuyuan-data:/var/lib/backstage \
  fuyuan-backstage
```

Docker 預設 `COOKIE_SECURE=true`，請透過正式 HTTPS 代理進入；本機 HTTP 測試時才加 `--env COOKIE_SECURE=false`。永久磁碟必須保留；刪除磁碟後資料無法由 repo 還原。Docker 設定已提供，尚未在此環境實際執行 Docker build。

## 備份與維運

後台「下載資料備份」會匯出商品與訂單 JSON，含顧客個資，請妥善保存且不要提交至公開 repo。這份 JSON 供檢視／資料搬移，**此版沒有 JSON 一鍵還原介面**。

完整災難還原請使用 SQLite 原生備份，或停機後備份整個 DB_PATH 所在資料目錄（包含可能存在的 WAL 檔案）。還原時先停機，再放回備份的資料目錄，確認 `DB_PATH` 與檔案權限後重啟。正式環境應由主機安排固定備份，這個 repo 不會自行建立排程。

獨立 Node.js 版本登入使用 HttpOnly、SameSite=Strict cookie，8 小時過期，伺服器重啟須重新登入。API 會檢查後台權限、跨站來源、資料格式與商品／訂單版本，避免多個編輯頁面互相覆寫。後台採單一管理員密碼，沒有多人帳號／操作稽核；分享密碼代表分享全部後台權限。

## 檔案

- `server.js`：API、身份驗證、SQLite transaction、靜態頁面。
- `public/`：後台、員工與顧客訂購、共用樣式與分析。
- `data/catalog.json`：初始商品目錄；`data/sources.json`：來源版本。
- `test/integration.test.js`：權限、上下架、庫存競爭、防重送、歷史單價、取消退貨、重啟持久性與分析測試。
- `Dockerfile`：Node.js 24 容器部署。

訂單卡片與近期訂單使用簡短單號（例如 FY-A12AB5B7），員工開單／顧客訂購以不同顏色標籤呈現。簡短單號僅供顯示與搜尋；資料及所有出退貨請求持續使用完整 ID，既有訂單不改號。


商品支援獨立的批發單位（`orderUnit`）與顧客單位（`customerUnit`），舊商品預設為「件」。公開商品依入口只回傳該入口的 `price` 與 `unit`。新訂單保存價格與單位快照，出貨與退貨沿用原單位；分析依商品與單位分列。單位是販售標示，共用庫存仍按數量扣除，不會自動換算箱／包。後台點擊商品縮圖可放大，支援關閉按鈕與 Esc。

新增商品使用伺服器分配的連續固定編號（p198、p199…），隱藏商品仍保留編號，既有商品與歷史單據不改號。目錄共用 catalog-order.js，依冷凍／冷藏／乾貨、既有類別順序、中文商品名稱（含數字自然排序）排列；新增或修改分類後自動排入，新增類別排在既有類別之後。
