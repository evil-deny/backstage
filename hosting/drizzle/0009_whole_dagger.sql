CREATE TABLE `order_tombstones` (
	`request_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`purged_at` text NOT NULL
);
