CREATE TABLE `api_grants` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connection_tickets` (
	`hash` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`expires` integer NOT NULL
);
