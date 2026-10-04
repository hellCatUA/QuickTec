/**
 * What makes a password acceptable.
 *
 * Split from the hashing on purpose: this is the half the browser needs, and
 * password.ts pulls in node:crypto, which in a client bundle fails at import
 * time with "The 'original' argument must be of type Function" and takes the
 * whole page down with it.
 */

/**
 * Whether this account may sign in with a password held here.
 *
 * Two different situations, one answer. A LOCAL account has no other method —
 * there is no NextCloud account behind it to go to. An SSO account normally
 * has no password at all, and gets one only where an administrator granted the
 * fallback, so that a site cut off from NextCloud is not a site nobody can
 * work from.
 *
 * Every door reads this rather than testing `signInMethod` itself: the four
 * places that ask (the credentials provider, the one-time link, the forced
 * first change, an administrator's reset) are four chances for the rule to
 * drift, and the one that drifts open is a way into somebody's account.
 */
export function canSignInWithPassword(user: {
  signInMethod: string;
  passwordFallback: boolean;
}): boolean {
  return user.signInMethod === "LOCAL" || user.passwordFallback;
}

/** Long enough to matter, short enough that people will not write it down. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * No password here can be longer than this, so nothing longer is worth
 * checking.
 *
 * It was enforced only when a password was *set*. Checking one ran Unicode
 * normalisation over whatever arrived, on the main thread, before scrypt — and
 * a server action takes a body up to 25 MB. Twenty of those megabytes held
 * the event loop for over half a second, during which the server answered
 * nobody, and the form doing it needs no account. Every place that compares a
 * password now refuses anything longer than could ever have been stored.
 */
export const MAX_PASSWORD_LENGTH = 200;

/** Too long to be anybody's password, and too long to spend time on. */
export function tooLongToCheck(password: string): boolean {
  return password.length > MAX_PASSWORD_LENGTH;
}

export function passwordProblem(password: string): string | null {
  if (!password.trim()) return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That is longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }
  // No character-class rules on purpose: they push people towards Passw0rd!
  // and away from four words they will actually remember.
  return null;
}
