CREATE TABLE `billing_claims` (
	`order_id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `billing_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `billing_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
