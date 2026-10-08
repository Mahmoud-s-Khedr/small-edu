CREATE TABLE `uploads` (
	`object_key` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`uploader_id` text NOT NULL,
	`lecture_id` text,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`completed_at` integer,
	`attached_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_pending_attachment_idx` ON `uploads` (`purpose`,`lecture_id`,`completed_at`,`attached_at`);