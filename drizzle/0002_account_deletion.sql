CREATE TABLE `account_deletion_jobs` (
	`firebase_uid` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`firebase_deleted_at` integer,
	`completed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `account_deletion_jobs_retry_idx` ON `account_deletion_jobs` (`completed_at`,`next_attempt_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`module_id` text NOT NULL,
	`receipt_key` text NOT NULL,
	`receipt_filename` text NOT NULL,
	`receipt_content_type` text NOT NULL,
	`receipt_size_bytes` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "booking_status_check" CHECK("__new_booking_requests"."status" IN ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
INSERT INTO `__new_booking_requests`("id", "user_id", "module_id", "receipt_key", "receipt_filename", "receipt_content_type", "receipt_size_bytes", "status", "created_at", "updated_at") SELECT "id", "user_id", "module_id", "receipt_key", "receipt_filename", "receipt_content_type", "receipt_size_bytes", "status", "created_at", "updated_at" FROM `booking_requests`;--> statement-breakpoint
DROP TABLE `booking_requests`;--> statement-breakpoint
ALTER TABLE `__new_booking_requests` RENAME TO `booking_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_requests_receipt_key_unique` ON `booking_requests` (`receipt_key`);--> statement-breakpoint
CREATE INDEX `bookings_admin_list_idx` ON `booking_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_one_active_per_user_module` ON `booking_requests` (`user_id`,`module_id`) WHERE "booking_requests"."status" IN ('PENDING', 'ACCEPTED');--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_at` integer;