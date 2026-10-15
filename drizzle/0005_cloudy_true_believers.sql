-- Replace only the column so D1 foreign keys remain enabled and lecture children survive.
ALTER TABLE `lectures` ADD COLUMN `video_url_nullable` text;
--> statement-breakpoint
UPDATE `lectures` SET `video_url_nullable` = `video_url`;
--> statement-breakpoint
ALTER TABLE `lectures` DROP COLUMN `video_url`;
--> statement-breakpoint
ALTER TABLE `lectures` RENAME COLUMN `video_url_nullable` TO `video_url`;
