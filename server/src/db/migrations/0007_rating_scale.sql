PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`stars` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ratings_stars_range" CHECK("__new_ratings"."stars" between 0 and 10)
);
--> statement-breakpoint
INSERT INTO `__new_ratings`("id", "product_id", "user_id", "stars", "comment", "created_at", "updated_at") SELECT "id", "product_id", "user_id", "stars", "comment", "created_at", "updated_at" FROM `ratings`;--> statement-breakpoint
DROP TABLE `ratings`;--> statement-breakpoint
ALTER TABLE `__new_ratings` RENAME TO `ratings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_product_user_unique` ON `ratings` (`product_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `ratings_user_id_idx` ON `ratings` (`user_id`);