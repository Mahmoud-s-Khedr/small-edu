CREATE TABLE `booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`receipt_key` text NOT NULL,
	`receipt_filename` text NOT NULL,
	`receipt_content_type` text NOT NULL,
	`receipt_size_bytes` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "booking_status_check" CHECK("booking_requests"."status" IN ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_requests_receipt_key_unique` ON `booking_requests` (`receipt_key`);--> statement-breakpoint
CREATE INDEX `bookings_admin_list_idx` ON `booking_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_one_active_per_user_module` ON `booking_requests` (`user_id`,`module_id`) WHERE "booking_requests"."status" IN ('PENDING', 'ACCEPTED');--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` text PRIMARY KEY NOT NULL,
	`lecture_id` text NOT NULL,
	`front_text` text,
	`front_image_key` text,
	`back_text` text,
	`back_image_key` text,
	`ordering` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flashcards_front_present" CHECK("flashcards"."front_text" IS NOT NULL OR "flashcards"."front_image_key" IS NOT NULL),
	CONSTRAINT "flashcards_back_present" CHECK("flashcards"."back_text" IS NOT NULL OR "flashcards"."back_image_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `flashcards_lecture_order_idx` ON `flashcards` (`lecture_id`,`ordering`);--> statement-breakpoint
CREATE TABLE `lecture_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`lecture_id` text NOT NULL,
	`object_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lecture_materials_object_key_unique` ON `lecture_materials` (`object_key`);--> statement-breakpoint
CREATE INDEX `materials_lecture_idx` ON `lecture_materials` (`lecture_id`);--> statement-breakpoint
CREATE TABLE `lectures` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`subject` text NOT NULL,
	`lecture_date` integer NOT NULL,
	`video_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lectures_module_idx` ON `lectures` (`module_id`);--> statement-breakpoint
CREATE INDEX `lectures_subject_date_idx` ON `lectures` (`subject`,`lecture_date`);--> statement-breakpoint
CREATE TABLE `mcq_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`mcq_id` text NOT NULL,
	`choice_text` text NOT NULL,
	`ordering` integer NOT NULL,
	`is_correct` integer NOT NULL,
	FOREIGN KEY (`mcq_id`) REFERENCES `mcqs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcq_choices_question_idx` ON `mcq_choices` (`mcq_id`,`ordering`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcq_choice_order_unique` ON `mcq_choices` (`mcq_id`,`ordering`);--> statement-breakpoint
CREATE TABLE `mcqs` (
	`id` text PRIMARY KEY NOT NULL,
	`lecture_id` text NOT NULL,
	`question_text` text NOT NULL,
	`ordering` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lecture_id`) REFERENCES `lectures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcqs_lecture_order_idx` ON `mcqs` (`lecture_id`,`ordering`);--> statement-breakpoint
CREATE TABLE `module_access` (
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `module_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`number` text NOT NULL,
	`academic_year` text NOT NULL,
	`semester` text NOT NULL,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "modules_price_nonnegative" CHECK("modules"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modules_year_semester_number_unique` ON `modules` (`academic_year`,`semester`,`number`);--> statement-breakpoint
CREATE INDEX `modules_filter_idx` ON `modules` (`academic_year`,`semester`,`number`);--> statement-breakpoint
CREATE TABLE `user_flashcard_state` (
	`user_id` text NOT NULL,
	`flashcard_id` text NOT NULL,
	`knowledge` text,
	`hidden` integer DEFAULT false NOT NULL,
	`viewed_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `flashcard_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flashcard_knowledge_check" CHECK("user_flashcard_state"."knowledge" IS NULL OR "user_flashcard_state"."knowledge" IN ('KNOWN', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_subject` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('USER', 'ADMIN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_external_subject_unique` ON `users` (`external_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);