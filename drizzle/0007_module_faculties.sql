-- Preserve existing modules with an unassigned name; admins can assign it via PATCH.
DROP INDEX `modules_year_semester_number_unique`;--> statement-breakpoint
ALTER TABLE `modules` ADD `faculty_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `modules_faculty_year_semester_number_unique` ON `modules` (`faculty_name`,`academic_year`,`semester`,`number`);
