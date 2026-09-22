ALTER TABLE `boards` ADD COLUMN `public_id` text;
CREATE UNIQUE INDEX `boards_public_id_unique` ON `boards` (`public_id`);
