CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`email_at_link` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_authenticated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_identities_issuer_sub` ON `auth_identities` (`issuer`,`subject`);
--> statement-breakpoint
CREATE INDEX `idx_auth_identities_user_id` ON `auth_identities` (`user_id`);
