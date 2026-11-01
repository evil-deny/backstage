CREATE TABLE `mutation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	CONSTRAINT "mutation_must_succeed" CHECK("mutation_guards"."ok" = 1)
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`stock` integer,
	`price` integer NOT NULL,
	`order_visible` integer NOT NULL,
	`customer_visible` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT "stock_nonnegative" CHECK("inventory"."stock" IS NULL OR "inventory"."stock" >= 0),
	CONSTRAINT "price_nonnegative" CHECK("inventory"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE `order_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_records_request_id_unique` ON `order_records` (`request_id`);