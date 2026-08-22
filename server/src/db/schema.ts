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
    /**
     * Set when the account has no password anybody could know — after an
     * import, or after an administrator locked it. The stored hash is the
     * locked marker then, so no login can succeed until somebody follows a
     * reset link.
     */
    passwordResetRequired: integer('password_reset_required', { mode: 'boolean' })
      .notNull()
      .default(false),
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

export const passwordResets = sqliteTable(
  'password_resets',
  {
    /**
     * SHA-256 of the token in the link, not the token itself — the same rule
     * the session table follows. An invite code may be stored in clear text
     * because it only allows creating a new account; a reset link takes over
     * an existing one, so a stolen database must not hand one out.
     */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The administrator who issued it; `null` once that account is gone. */
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('password_resets_user_id_idx').on(table.userId),
    index('password_resets_expires_at_idx').on(table.expiresAt),
  ],
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
    /**
     * Set when a product goes into the trash. The row stays where it is, with
     * its ratings and photos, so restoring is one statement — and the EAN
     * stays claimed, which is what keeps a scan from silently creating a
     * second product beside the one somebody just deleted.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('products_name_idx').on(table.name),
    index('products_brand_idx').on(table.brand),
    index('products_category_idx').on(table.category),
    index('products_deleted_at_idx').on(table.deletedAt),
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
    /**
     * Place of the photo in the gallery of its product, counted from zero and
     * kept dense. Position zero is the picture on the card, so "primary" is a
     * consequence of the order instead of a second, separately stored truth
     * that could disagree with it.
     */
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('photos_product_id_idx').on(table.productId),
    index('photos_product_position_idx').on(table.productId, table.position),
    index('photos_user_id_idx').on(table.userId),
  ],
);

export const prices = sqliteTable(
  'prices',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The amount in the smallest unit of the currency. Money is never a
     * floating point number: 1.10 + 2.20 is not 3.30 in binary, and a price
     * history that adds up wrongly is worse than none.
     */
    cents: integer('cents').notNull(),
    /**
     * Copied from `app.currency` when the entry is written, not read from the
     * configuration afterwards: what was paid in a currency stays paid in that
     * currency, even if the instance is switched over later.
     */
    currency: text('currency').notNull(),
    /** Where it was bought. Free text — a household knows its own shops. */
    shop: text('shop'),
    note: text('note'),
    /** The day of the purchase, which is rarely the day of the entry. */
    purchasedAt: integer('purchased_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('prices_product_purchased_idx').on(table.productId, table.purchasedAt),
    index('prices_user_id_idx').on(table.userId),
    index('prices_shop_idx').on(table.shop),
    check('prices_cents_positive', sql`${table.cents} >= 0`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type NewPasswordResetRow = typeof passwordResets.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type RatingRow = typeof ratings.$inferSelect;
export type NewRatingRow = typeof ratings.$inferInsert;
export type PhotoRow = typeof photos.$inferSelect;
export type NewPhotoRow = typeof photos.$inferInsert;
export type PriceRow = typeof prices.$inferSelect;
export type NewPriceRow = typeof prices.$inferInsert;
