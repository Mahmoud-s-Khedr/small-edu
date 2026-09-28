PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_subject` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" IN ('USER', 'ADMIN', 'SUPER_ADMIN'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "external_subject", "email", "name", "role", "created_at", "updated_at") SELECT "id", "external_subject", "email", "name", "role", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_external_subject_unique` ON `users` (`external_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);