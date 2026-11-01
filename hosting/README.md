# 福緣素食 Sites 線上版

來源：evil-deny/backstage。使用 Sites 擁有者私人存取與 Cloudflare D1。

入口：/、/order、/customer。私人發布期間三個入口僅擁有者可使用。沒有額外管理密碼。

執行 npm run db:generate 產生資料庫 migrations；透過 Sites 工具建置與發布。初始 197 項商品取自 data/catalog.json，實際營運前請盤點庫存。

商品、庫存與訂單保存在託管 D1。批次送單與取消、出貨、退貨使用 D1 batch 與版本檢查，發生衝突時整個批次回滾。

前端沿用本機版本，後端改用託管資料庫及 Sites 身份驗證。既有 order/customer repo 與網址不受影響。
