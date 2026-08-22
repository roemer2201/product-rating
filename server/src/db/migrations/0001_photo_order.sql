ALTER TABLE `photos` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `photos` SET `position` = (
  SELECT `ordered`.`rank` - 1 FROM (
    SELECT `id`, row_number() OVER (
      PARTITION BY `product_id` ORDER BY `is_primary` DESC, `created_at`, `id`
    ) AS `rank` FROM `photos`
  ) AS `ordered` WHERE `ordered`.`id` = `photos`.`id`
);--> statement-breakpoint
CREATE INDEX `photos_product_position_idx` ON `photos` (`product_id`,`position`);--> statement-breakpoint
ALTER TABLE `photos` DROP COLUMN `is_primary`;
