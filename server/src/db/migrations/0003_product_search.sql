CREATE VIRTUAL TABLE `products_fts` USING fts5(
  `name`,
  `brand`,
  `ean`,
  `product_id` UNINDEXED,
  tokenize='trigram remove_diacritics 1'
);--> statement-breakpoint
INSERT INTO `products_fts` (`rowid`, `name`, `brand`, `ean`, `product_id`)
  SELECT `rowid`, `name`, coalesce(`brand`, ''), `ean`, `id` FROM `products`;--> statement-breakpoint
CREATE TRIGGER `products_fts_insert` AFTER INSERT ON `products` BEGIN
  INSERT INTO `products_fts` (`rowid`, `name`, `brand`, `ean`, `product_id`)
    VALUES (new.`rowid`, new.`name`, coalesce(new.`brand`, ''), new.`ean`, new.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `products_fts_delete` AFTER DELETE ON `products` BEGIN
  DELETE FROM `products_fts` WHERE `rowid` = old.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `products_fts_update` AFTER UPDATE ON `products` BEGIN
  DELETE FROM `products_fts` WHERE `rowid` = old.`rowid`;
  INSERT INTO `products_fts` (`rowid`, `name`, `brand`, `ean`, `product_id`)
    VALUES (new.`rowid`, new.`name`, coalesce(new.`brand`, ''), new.`ean`, new.`id`);
END;
