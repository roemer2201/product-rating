-- The two foreign_keys pragmas drizzle-kit adds are no-ops inside the
-- migrator's transaction; runMigrations() switches enforcement off around it,
-- which is what keeps DROP TABLE from cascading into ratings, photos, prices
-- and category assignments.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'product' NOT NULL,
	`ean` text,
	`name` text NOT NULL,
	`variant` text,
	`brand` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_kind_valid" CHECK("__new_products"."kind" in ('product', 'dish')),
	CONSTRAINT "products_dish_without_ean" CHECK("__new_products"."kind" = 'product' or "__new_products"."ean" is null)
);
--> statement-breakpoint
-- Hand written: drizzle-kit selects `kind` from the old table, which does not
-- have it yet; every existing row is a scanned product and takes the default.
-- The rowid is carried over explicitly: `products_fts` is keyed by it, and a
-- plain INSERT ... SELECT would number the rows afresh.
INSERT INTO `__new_products`("rowid", "id", "ean", "name", "variant", "brand", "notes", "created_by", "created_at", "updated_at", "deleted_at", "deleted_by") SELECT "rowid", "id", "ean", "name", "variant", "brand", "notes", "created_by", "created_at", "updated_at", "deleted_at", "deleted_by" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_ean_unique` ON `products` (`ean`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `products_brand_idx` ON `products` (`brand`);--> statement-breakpoint
CREATE INDEX `products_deleted_at_idx` ON `products` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `products_kind_idx` ON `products` (`kind`);--> statement-breakpoint
-- Hand written: the search triggers went with the old table. They come back
-- with `coalesce()` around the EAN, which may be NULL now, and the index is
-- refilled so it cannot disagree with the table whatever happened before.
DELETE FROM `products_fts`;--> statement-breakpoint
INSERT INTO `products_fts` (`rowid`, `name`, `variant`, `brand`, `ean`, `product_id`)
  SELECT `rowid`, `name`, coalesce(`variant`, ''), coalesce(`brand`, ''), coalesce(`ean`, ''), `id`
  FROM `products`;--> statement-breakpoint
CREATE TRIGGER `products_fts_insert` AFTER INSERT ON `products` BEGIN
  INSERT INTO `products_fts` (`rowid`, `name`, `variant`, `brand`, `ean`, `product_id`)
    VALUES (new.`rowid`, new.`name`, coalesce(new.`variant`, ''), coalesce(new.`brand`, ''), coalesce(new.`ean`, ''), new.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `products_fts_delete` AFTER DELETE ON `products` BEGIN
  DELETE FROM `products_fts` WHERE `rowid` = old.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `products_fts_update` AFTER UPDATE ON `products` BEGIN
  DELETE FROM `products_fts` WHERE `rowid` = old.`rowid`;
  INSERT INTO `products_fts` (`rowid`, `name`, `variant`, `brand`, `ean`, `product_id`)
    VALUES (new.`rowid`, new.`name`, coalesce(new.`variant`, ''), coalesce(new.`brand`, ''), coalesce(new.`ean`, ''), new.`id`);
END;
