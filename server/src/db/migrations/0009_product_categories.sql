CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`frequent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `product_categories` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_categories_category_id_idx` ON `product_categories` (`category_id`);--> statement-breakpoint
-- Hand written: the free text categories become entries of the list before
-- the column goes. Spellings that differ only in case are one category, named
-- after the spelling most products used (ties: the first in byte order).
-- `pr_lower()` is the Unicode aware folding every connection of the
-- application registers; SQLite's own `lower()` leaves umlauts alone. The
-- identifier has the layout of a version 4 UUID like every other in the schema.
INSERT INTO `categories` (`id`, `name`, `frequent`, `created_at`, `updated_at`)
  SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-' ||
      substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
      lower(hex(randomblob(6))),
    `spelling`,
    0,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM (
    SELECT
      trim(`category`) AS `spelling`,
      row_number() OVER (
        PARTITION BY pr_lower(trim(`category`))
        ORDER BY count(*) DESC, trim(`category`) ASC
      ) AS `rank`
    FROM `products`
    WHERE `category` IS NOT NULL AND trim(`category`) <> ''
    GROUP BY trim(`category`)
  )
  WHERE `rank` = 1;--> statement-breakpoint
INSERT INTO `product_categories` (`product_id`, `category_id`)
  SELECT `products`.`id`, `categories`.`id`
  FROM `products`
  JOIN `categories` ON pr_lower(`categories`.`name`) = pr_lower(trim(`products`.`category`))
  WHERE `products`.`category` IS NOT NULL AND trim(`products`.`category`) <> '';--> statement-breakpoint
DROP INDEX `products_category_idx`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `category`;