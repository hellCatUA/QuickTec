import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

export {
  MIN_PASSWORD_LENGTH,
  passwordProblem,
} from "@/lib/password-rules";

/**
 * Passwords for the people who are not in NextCloud.
 *
 * scrypt rather than bcrypt or argon2 because it is in Node and they are not.
 * A password hash is a thing you want to still be able to build in five years
 * without a native module that stopped compiling, and scrypt is memory-hard,
 * which is the property that matters against somebody with a GPU and a copy of
 * the database.
 *
 * The parameters travel inside the stored string. Raising them later is then a
 * matter of changing the constants: old hashes keep verifying against the
 * numbers they were made with, and `needsRehash` says which ones to replace
 * next time their owner signs in and the plaintext is briefly in hand.
 */

// promisify picks the overload without options, which is the only one this
// file does not use.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** 2^15. About 100ms and 32 MB per hash on the hardware this runs on. */
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * 128 * COST * BLOCK_SIZE is exactly 32 MB, which is also Node's default cap,
 * and hitting it exactly fails rather than fits.
 */
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Never throws and never says why it failed.
 *
 * A malformed stored hash and a wrong password are the same answer here: no.
 * Telling them apart is the caller's business only in that a stored hash which
 * cannot be parsed is a bug worth logging, and it is logged rather than
 * surfaced, because the person typing has no use for it.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const [scheme, cost, blockSize, parallelism, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) {
    console.error("[password] stored hash is not in a shape this can read");
    return false;
  }

  const expected = Buffer.from(key, "base64");

  let actual: Buffer;
  try {
    actual = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64"),
      expected.length,
      {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelism),
        maxmem: MAX_MEMORY,
      },
    );
  } catch (error) {
    console.error("[password] could not verify against the stored hash:", error);
    return false;
  }

  // Length is public; the bytes are not. timingSafeEqual throws on a mismatch
  // in length, which would itself be a signal, so it is checked first.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Whether this hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, cost, blockSize, parallelism] = stored.split("$");
  return (
    scheme !== "scrypt" ||
    Number(cost) < COST ||
    Number(blockSize) < BLOCK_SIZE ||
    Number(parallelism) !== PARALLELISM
  );
}

// ---------------------------------------------------------------------------
// One-time links
// ---------------------------------------------------------------------------

/** How long an administrator's link stays good for. */
export const SETUP_TOKEN_HOURS = 72;

/**
 * A link is a password until it is used, so only its hash is kept.
 *
 * SHA-256 rather than scrypt: the secret is 32 random bytes rather than
 * something a person chose, so there is no dictionary to run against it and
 * nothing for a slow hash to buy.
 */
export function newSetupToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSetupToken(token) };
}

export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Too many wrong answers
// ---------------------------------------------------------------------------

/** Wrong passwords in a row before the account closes for a while. */
export const MAX_FAILED_SIGN_INS = 8;

/** How long it stays closed. Long enough to ruin a script, short enough to wait out. */
export const LOCKOUT_MINUTES = 15;

export function lockoutUntil(failures: number): Date | null {
  if (failures < MAX_FAILED_SIGN_INS) return null;
  return new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
}

/** Minutes left on a lock, or 0 when it has expired or was never set. */
export function lockRemaining(lockedUntil: Date | null, now = new Date()): number {
  if (!lockedUntil) return 0;
  const left = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000);
  return left > 0 ? left : 0;
}
