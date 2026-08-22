CREATE TABLE `prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cents` integer NOT NULL,
	`currency` text NOT NULL,
	`shop` text,
	`note` text,
	`purchased_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prices_cents_positive" CHECK("prices"."cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `prices_product_purchased_idx` ON `prices` (`product_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `prices_user_id_idx` ON `prices` (`user_id`);--> statement-breakpoint
CREATE INDEX `prices_shop_idx` ON `prices` (`shop`);