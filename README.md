# 福緣素食 Backstage

在此 repo 集中管理 order 與 customer 的商品、價格、可售庫存、上下架與商品銷售分析。採用 Node.js 24 內建 SQLite，沒有額外 npm 套件，也不需要建置前端。

## 三個入口

| 路徑 | 用途 | 權限 |
| --- | --- | --- |
| `/` | 營運總覽、商品管理、訂單、商品分析、CSV、備份 | 管理員登入 |
| `/order` | 員工開單 | 送單須已登入 |
| `/customer` | 顧客訂購、確認明細、送單、複製與 LINE 聯絡 | 公開訂購；不能查詢其他顧客訂單 |

兩個整合入口使用相同商品與庫存；可獨立控制商品是否在 order、customer 顯示。修改後，新開頁面、切回頁面或按「更新商品」即可讀取；送單時伺服器再次驗證價格、上下架與庫存。後台按「重新整理」取得其他裝置的新資料。

**本次不修改 `evil-deny/order`、`evil-deny/customer`。既有 GitHub Pages 網址仍使用原本各自的資料，不會自動受到此後台控制。使用整合功能須改用本服務的 `/order`、`/customer` 網址。** 此版將商品資料與訂購流程整合重建，沒有嵌入舊站的密碼 `0000` 或直接操控舊站 localStorage。

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
- 兩 repo 此版本的價格相同；本次沒有變更商品價格。
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

登入使用 HttpOnly、SameSite=Strict cookie，8 小時過期，伺服器重啟須重新登入。API 會檢查後台權限、跨站來源、資料格式與商品／訂單版本，避免多個編輯頁面互相覆寫。後台採單一管理員密碼，沒有多人帳號／操作稽核；分享密碼代表分享全部後台權限。

## 檔案

- `server.js`：API、身份驗證、SQLite transaction、靜態頁面。
- `public/`：後台、員工與顧客訂購、共用樣式與分析。
- `data/catalog.json`：初始商品目錄；`data/sources.json`：來源版本。
- `test/integration.test.js`：權限、上下架、庫存競爭、防重送、歷史單價、取消退貨、重啟持久性與分析測試。
- `Dockerfile`：Node.js 24 容器部署。
