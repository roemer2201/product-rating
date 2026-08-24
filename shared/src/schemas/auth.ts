import { z } from 'zod';

/**
 * Validation schemas for everything around accounts, sessions and invites.
 *
 * The server validates every request with these, the web client reuses them
 * for form validation. The password length is only bounded here; the actual
 * minimum comes from `auth.min_password_length` and is checked server side.
 */

/** Bounds a username has to satisfy regardless of configuration. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/** Bounds the display name, which is longer than a username may be. */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** Upper bound on passwords, so a huge body cannot tie up the hasher. */
export const PASSWORD_MAX_LENGTH = 200;

/** Letters, digits, dot, dash and underscore; stored lower case. */
export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[a-zA-Z0-9._-]+$/, 'only letters, digits, dot, dash and underscore are allowed')
  .transform((value) => value.toLowerCase());

/**
 * The name other accounts see: free text, not an identifier.
 *
 * A username is technical — lower case, no spaces, and the thing that is typed
 * at the login. The display name is what a household calls each other, so it
 * allows spaces, umlauts and capitals, and it is deliberately not unique: two
 * people may call themselves "Oma" without one of them losing.
 *
 * Control characters are the only thing that is refused. They would let a name
 * carry line breaks or bidirectional overrides into a list where every other
 * entry is one line.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH)
  .max(DISPLAY_NAME_MAX_LENGTH)
  .regex(/^[^\p{C}]+$/u, 'control characters are not allowed');

export const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const emailSchema = z.email().max(254);

/** Codes are handed out upper case in groups of four, e.g. `A1B2-C3D4-E5F6`. */
export const inviteCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .transform((value) => value.toUpperCase());

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  email: emailSchema.nullish(),
  displayName: displayNameSchema.nullish(),
  invite: inviteCodeSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export const createInviteSchema = z.object({
  /** Free text reminder of who the code is meant for. */
  note: z.string().trim().max(200).nullish(),
  /** Overrides `auth.invite_ttl_days` for this single code. */
  ttlDays: z.int().min(1).max(365).optional(),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  email: emailSchema.nullish(),
  displayName: displayNameSchema.nullish(),
  role: z.enum(['admin', 'user']).default('user'),
});

export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    disabled: z.boolean().optional(),
    email: emailSchema.nullable().optional(),
    displayName: displayNameSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no changes given' });

/**
 * Body of `PATCH /api/v1/auth/profile`: what an account may change about
 * itself without an administrator. `null` gives the display name up again, and
 * the username is shown from then on.
 */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema.nullable(),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

/** Bounds a reset token; 32 random bytes as base64url are 43 characters. */
export const resetTokenSchema = z.string().trim().min(20).max(200);

/**
 * Body of `POST /api/v1/auth/reset`: the token out of the link plus the
 * password to set. No current password — whoever holds the link is the proof,
 * which is exactly why the link is short lived and single use.
 */
export const redeemResetSchema = z.object({
  token: resetTokenSchema,
  newPassword: passwordSchema,
});

/** Body of `POST /api/v1/users/:id/reset-link`; everything is optional. */
export const createResetLinkSchema = z.object({
  /** Overrides `auth.password_reset_ttl_hours` for this single link. */
  ttlHours: z.int().min(1).max(720).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RedeemResetInput = z.infer<typeof redeemResetSchema>;
export type CreateResetLinkInput = z.infer<typeof createResetLinkSchema>;
