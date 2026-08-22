ALTER TABLE `products` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `deleted_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `products_deleted_at_idx` ON `products` (`deleted_at`);