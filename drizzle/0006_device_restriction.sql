CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_enabled_check" CHECK("app_settings"."enabled" IN (0, 1))
);
--> statement-breakpoint
ALTER TABLE `account_deletion_jobs` ADD `device_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_released_at` integer;
--> statement-breakpoint
INSERT INTO app_settings (key, enabled, updated_at) VALUES ('DEVICE_RESTRICTION_ENABLED', 0, 0);
