/**
 * How an account is named towards the others.
 *
 * Two names exist side by side: the username is the identifier — lower case,
 * unique, typed at the login — and the display name is what the household
 * calls the person. Everything that shows an account to somebody else goes
 * through here, so the answer is the same on the product page, in the price
 * history and in the trash.
 */

/** The two names any account carries, as the API hands them out. */
export interface NamedAccount {
  /** `null` where the account behind a row no longer exists. */
  username: string | null;
  /** `null` while the account has not chosen one. */
  displayName: string | null;
}

/**
 * The name to show for an account: the display name, otherwise the username.
 *
 * `null` only when there is no account left at all — a caller decides for
 * itself what to write instead, because "deleted account" reads differently
 * next to a rating than next to a price.
 */
export function accountName(account: NamedAccount): string | null {
  return account.displayName ?? account.username;
}
