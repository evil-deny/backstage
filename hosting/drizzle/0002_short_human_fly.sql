ALTER TABLE `inventory` ADD `order_price` integer CONSTRAINT `order_price_nonnegative` CHECK (`order_price` IS NULL OR `order_price` >= 0);
