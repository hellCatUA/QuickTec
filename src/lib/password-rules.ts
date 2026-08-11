/**
 * What makes a password acceptable.
 *
 * Split from the hashing on purpose: this is the half the browser needs, and
 * password.ts pulls in node:crypto, which in a client bundle fails at import
 * time with "The 'original' argument must be of type Function" and takes the
 * whole page down with it.
 */

/** Long enough to matter, short enough that people will not write it down. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string): string | null {
  if (!password.trim()) return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "That is longer than 200 characters.";
  // No character-class rules on purpose: they push people towards Passw0rd!
  // and away from four words they will actually remember.
  return null;
}
