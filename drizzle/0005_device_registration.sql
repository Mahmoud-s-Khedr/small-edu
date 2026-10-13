ALTER TABLE `account_deletion_jobs` ADD `device_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device` text;--> statement-breakpoint
ALTER TABLE `users` ADD `device_released_at` integer;