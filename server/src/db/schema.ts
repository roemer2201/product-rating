import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The complete database schema.
 *
 * Products form a shared catalogue: an EAN exists exactly once, while ratings
 * and photos belong to a single user. Timestamps are stored as Unix epoch
 * milliseconds; that keeps comparisons cheap and the schema portable, since no
 * SQLite specific date handling is involved.
 *
 * Changes here are never applied with `db push`. Generate a migration with
 * `npm run db:generate`, review the SQL and commit it.
 */

/** Column helper for a required timestamp defaulting to "now". */
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Stored lower case; the service layer normalises before writing. */
    username: text('username').notNull().unique(),
    email: text('email'),
    /** argon2id hash including its parameters, never a plain password. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'user'] })
      .notNull()
      .default('user'),
    createdAt: createdAt(),
    /** Set instead of deleting an account, so its ratings stay attributable. */
    disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
  },
  (table) => [check('users_username_lower', sql`${table.username} = lower(${table.username})`)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /**
     * SHA-256 of the cookie token, not the token itself. Someone reading the
     * database cannot turn a row back into a usable cookie.
     */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const invites = sqliteTable(
  'invites',
  {
    /** The code as handed out; admins have to be able to read it again. */
    code: text('code').primaryKey(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [index('invites_created_by_idx').on(table.createdBy)],
);

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    /** Normalised to EAN-13; UPC-A and EAN-8 are widened before writing. */
    ean: text('ean').notNull().unique(),
    name: text('name').notNull(),
    brand: text('brand'),
    category: text('category'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('products_name_idx').on(table.name),
    index('products_brand_idx').on(table.brand),
    index('products_category_idx').on(table.category),
  ],
);

export const ratings = sqliteTable(
  'ratings',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('ratings_product_user_unique').on(table.productId, table.userId),
    index('ratings_user_id_idx').on(table.userId),
    check('ratings_stars_range', sql`${table.stars} between 0 and 5`),
  ],
);

export const photos = sqliteTable(
  'photos',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Generated on the server; the client supplied name is never trusted. */
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index('photos_product_id_idx').on(table.productId),
    index('photos_user_id_idx').on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type RatingRow = typeof ratings.$inferSelect;
export type NewRatingRow = typeof ratings.$inferInsert;
export type PhotoRow = typeof photos.$inferSelect;
export type NewPhotoRow = typeof photos.$inferInsert;
