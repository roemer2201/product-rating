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
  role: z.enum(['admin', 'user']).default('user'),
});

export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    disabled: z.boolean().optional(),
    email: emailSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no changes given' });

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
