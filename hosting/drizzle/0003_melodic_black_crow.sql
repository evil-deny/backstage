CREATE TABLE `google_login_challenges` (
	`hash` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `api_grants` ADD `provider` text DEFAULT 'chatgpt' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_grants` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `api_grants` ADD `email` text;--> statement-breakpoint
ALTER TABLE `api_grants` ADD `audience` text;