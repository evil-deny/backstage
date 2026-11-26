-- 每日叫貨：僅員工批發可見；無庫存上限。可重跑，不覆蓋後台後續修改。

INSERT INTO inventory(id,body,stock,price,order_price,order_visible,customer_visible,revision)
SELECT 'p'||next,json_set('{"name": "白豆腐", "category": "每日叫貨", "type": "豆製品", "storage": "冷藏", "image": "", "orderUnit": "板", "customerUnit": "板", "creationToken": "daily-supply-20261126-1"}','$.id','p'||next,'$.displayNumber',(SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0)+1 FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL)),NULL,0,210,1,0,1
FROM (SELECT COALESCE(MAX(CAST(substr(id,2) AS INTEGER)),0)+1 AS next FROM inventory WHERE id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*')
WHERE NOT EXISTS(SELECT 1 FROM inventory WHERE json_extract(body,'$.creationToken')='daily-supply-20261126-1' OR (json_extract(body,'$.category')='每日叫貨' AND json_extract(body,'$.name')='白豆腐'));
UPDATE catalog_state SET revision=revision+changes() WHERE id='main';

INSERT INTO inventory(id,body,stock,price,order_price,order_visible,customer_visible,revision)
SELECT 'p'||next,json_set('{"name": "炸四角", "category": "每日叫貨", "type": "豆製品", "storage": "冷藏", "image": "", "orderUnit": "籃", "customerUnit": "籃", "creationToken": "daily-supply-20261126-2"}','$.id','p'||next,'$.displayNumber',(SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0)+1 FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL)),NULL,0,310,1,0,1
FROM (SELECT COALESCE(MAX(CAST(substr(id,2) AS INTEGER)),0)+1 AS next FROM inventory WHERE id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*')
WHERE NOT EXISTS(SELECT 1 FROM inventory WHERE json_extract(body,'$.creationToken')='daily-supply-20261126-2' OR (json_extract(body,'$.category')='每日叫貨' AND json_extract(body,'$.name')='炸四角'));
UPDATE catalog_state SET revision=revision+changes() WHERE id='main';

INSERT INTO inventory(id,body,stock,price,order_price,order_visible,customer_visible,revision)
SELECT 'p'||next,json_set('{"name": "黃豆干", "category": "每日叫貨", "type": "豆製品", "storage": "冷藏", "image": "", "orderUnit": "包", "customerUnit": "包", "creationToken": "daily-supply-20261126-3"}','$.id','p'||next,'$.displayNumber',(SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0)+1 FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL)),NULL,0,215,1,0,1
FROM (SELECT COALESCE(MAX(CAST(substr(id,2) AS INTEGER)),0)+1 AS next FROM inventory WHERE id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*')
WHERE NOT EXISTS(SELECT 1 FROM inventory WHERE json_extract(body,'$.creationToken')='daily-supply-20261126-3' OR (json_extract(body,'$.category')='每日叫貨' AND json_extract(body,'$.name')='黃豆干'));
UPDATE catalog_state SET revision=revision+changes() WHERE id='main';

INSERT INTO inventory(id,body,stock,price,order_price,order_visible,customer_visible,revision)
SELECT 'p'||next,json_set('{"name": "Ng干", "category": "每日叫貨", "type": "豆製品", "storage": "冷藏", "image": "", "orderUnit": "包", "customerUnit": "包", "creationToken": "daily-supply-20261126-4"}','$.id','p'||next,'$.displayNumber',(SELECT COALESCE(MAX(CAST(json_extract(body,'$.displayNumber') AS INTEGER)),0)+1 FROM inventory WHERE json_extract(body,'$.deletedAt') IS NULL)),NULL,0,100,1,0,1
FROM (SELECT COALESCE(MAX(CAST(substr(id,2) AS INTEGER)),0)+1 AS next FROM inventory WHERE id GLOB 'p[0-9]*' AND substr(id,2) NOT GLOB '*[^0-9]*')
WHERE NOT EXISTS(SELECT 1 FROM inventory WHERE json_extract(body,'$.creationToken')='daily-supply-20261126-4' OR (json_extract(body,'$.category')='每日叫貨' AND json_extract(body,'$.name')='Ng干'));
UPDATE catalog_state SET revision=revision+changes() WHERE id='main';
