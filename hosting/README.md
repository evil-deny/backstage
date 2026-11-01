# 福緣共用資料服務

三個操作入口位於 GitHub Pages：

- https://evil-deny.github.io/backstage/
- https://evil-deny.github.io/order/
- https://evil-deny.github.io/customer/

此 Sites 服務提供共用 API、Cloudflare D1 與既有 ChatGPT 身份驗證。顧客可公開讀取上架商品並送單；商品修改、訂單資料與員工操作需要管理員權限。

管理員由伺服器環境變數 ADMIN_EMAILS 指定，沒有白名單時一律拒絕。GitHub 前端的登入連接沿用 Sites 的 signin-with-chatgpt，透過固定回呼、一次性碼與 PKCE 取得八小時 API 委派授權。授權雜湊保存在 D1，原始授權只放在該分頁 sessionStorage，不依賴跨站 cookie。公開 Site 不等於公開後台。

跨來源僅允許 https://evil-deny.github.io 與此 Site。部署順序須先發布包含管理員白名單的受保護版本及新增資料表，再開放 Site 公開讀取／顧客送單；不要公開舊版的僅憑登入就允許管理的版本。

商品與訂單原有資料表保留。drizzle 的已發布 migrations 不可修改；新增 schema 先執行 npm run db:generate。測試執行 node --test test/hosted.test.mjs，建置與部署使用 Sites 工作流程。

共用資料包含歷史名稱／單價快照、預留庫存、出貨、部分退貨、取消與封存。舊版僅存於使用者瀏覽器的訂單不會自動搬入。初始 197 項商品的庫存是原 repo 預設值，營運前需盤點校正。
