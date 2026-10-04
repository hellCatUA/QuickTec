import "dotenv/config";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { canSignInWithPassword, hashPassword } from "@/lib/password";
import { BaseRole } from "@prisma-client";

/**
 * The way back in when nobody can sign in at all.
 *
 * Every part of an OIDC sign-in is a domain name: the issuer, the discovery
 * document, the redirect URI. A site that has lost its route to NextCloud
 * therefore cannot let anybody in — including the administrator who would
 * grant somebody a password, which is the one thing that would fix it. That is
 * a deadlock, and this is the key kept outside the building.
 *
 * It runs against the database with no session and no network of its own:
 *
 *     docker compose run --rm migrate npm run signin:local -- --email bo@…
 *     docker compose run --rm migrate npm run signin:local -- --all
 *     docker compose run --rm migrate npm run signin:local -- \
 *         --create --email break-glass@… --name "Break glass"
 *
 * Every password it sets is generated here, different for each person, printed
 * once and never stored in readable form. There is deliberately no option to
 * put one password on everybody: a password the whole company knows is on
 * every account the whole company can reach, including the ones that approve
 * payroll, and it stays that way on any account whose owner never signs in to
 * change it.
 */

/**
 * No l/1/I, no O/0. These get read off a screen and typed on a phone at the
 * side of a road, and a password somebody cannot transcribe is a password they
 * will write down.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** 16 characters out of 31, which is about 79 bits. Dashes are for the eye. */
function generatePassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group++) {
    let chunk = "";
    for (let index = 0; index < GROUP_LENGTH; index++) {
      chunk += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return groups.join("-");
}

type Options = {
  email: string | null;
  all: boolean;
  create: boolean;
  name: string | null;
  role: BaseRole;
};

function parseArgs(argv: string[]): Options | string {
  const options: Options = {
    email: null,
    all: false,
    create: false,
    name: null,
    role: "ADMINISTRATOR",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[++index];

    switch (arg) {
      case "--email":
        options.email = (next() ?? "").trim().toLowerCase();
        break;
      case "--name":
        options.name = (next() ?? "").trim();
        break;
      case "--role": {
        const value = (next() ?? "").trim().toUpperCase();
        if (!(value in BaseRole)) {
          return `--role must be one of ${Object.keys(BaseRole).join(", ")}.`;
        }
        options.role = value as BaseRole;
        break;
      }
      case "--all":
        options.all = true;
        break;
      case "--create":
        options.create = true;
        break;
      default:
        return `I do not know what ${arg} means.`;
    }
  }

  if (!options.all && !options.email) {
    return "Give me --email <address>, or --all, or --create --email <address> --name <name>.";
  }
  if (options.create && !options.name) {
    return "--create needs --name as well, because the account has to be called something.";
  }
  if (options.all && (options.email || options.create)) {
    return "--all is on its own: it grants to every account that has no password.";
  }

  return options;
}

/** What was done to one account, for the table at the end. */
type Granted = { name: string; email: string; password: string };

/**
 * Gives one account a password it can sign in with.
 *
 * `passwordChangedAt` is deliberately left alone. It exists to cut off
 * sessions older than a change, and the people it would cut off here are
 * whoever is signed in right now through SSO — who have done nothing wrong and
 * would simply find themselves signed out. Revoking is where somebody needs
 * cutting off, and that path stamps it.
 */
async function grant(
  user: { id: string; name: string; email: string; signInMethod: string },
): Promise<Granted> {
  const password = generatePassword();

  await db.user.update({
    where: { id: user.id },
    data: {
      // Harmless on an account that is already LOCAL, and the whole point on
      // one that is not.
      passwordFallback: user.signInMethod === "SSO" ? true : undefined,
      passwordHash: await hashPassword(password),
      // Somebody else chose it, so it is good for exactly one sign-in: the
      // app sends them to /set-password and will not let them past it.
      mustChangePassword: true,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

  // Anything outstanding stops working. Two ways to set the same password is
  // two people who can take the account.
  await db.passwordSetupToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await recordAudit({
    // Nobody is signed in — that is the situation this exists for. Said as
    // null rather than attributed to the account it was run against, which
    // would read as that person having done it to themselves.
    actorId: null,
    entityType: "User",
    entityId: user.id,
    action: "password_fallback_granted",
    detail: {
      who: user.name,
      field: "Sign-in",
      to: "a QuickTec password, set from the command line",
      reason: "No route to NextCloud",
    },
  });

  return { name: user.name, email: user.email, password };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === "string") {
    console.error(parsed);
    process.exit(1);
  }
  const options = parsed;
  const done: Granted[] = [];

  if (options.create) {
    const existing = await db.user.findUnique({
      where: { email: options.email! },
      select: { id: true },
    });
    if (existing) {
      console.error(
        `${options.email} already has an account. Run this without --create to give it a password.`,
      );
      process.exit(1);
    }

    const password = generatePassword();
    const user = await db.user.create({
      data: {
        name: options.name!,
        email: options.email!,
        baseRole: options.role,
        // A password is the only way into this one, so it is LOCAL outright
        // rather than an SSO account with a fallback: there is no NextCloud
        // account behind it to fall back *from*.
        signInMethod: "LOCAL",
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
      select: { id: true, name: true, email: true },
    });

    await recordAudit({
      actorId: null,
      entityType: "User",
      entityId: user.id,
      action: "outside_account_created",
      detail: {
        who: user.name,
        field: "Sign-in",
        to: `${options.role}, password set from the command line`,
      },
    });

    done.push({ name: user.name, email: user.email, password });
  } else if (options.all) {
    const users = await db.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        signInMethod: true,
        passwordFallback: true,
        passwordHash: true,
        passwordSetupTokens: {
          where: { usedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
          take: 1,
        },
      },
    });

    for (const user of users) {
      // Additive only. Somebody who already has a working password keeps the
      // one they chose — replacing it would lock out the outside accounts
      // this is not about, and hand their replacement to whoever is reading
      // the terminal.
      if (canSignInWithPassword(user) && user.passwordHash) {
        console.log(`  skipped  ${user.email} — already has a password`);
        continue;
      }
      // A link already on its way to them. Granting here would spend it, and
      // the first they would know is that it had stopped working.
      if (user.passwordSetupTokens.length > 0) {
        console.log(`  skipped  ${user.email} — has a live invite link`);
        continue;
      }
      done.push(await grant(user));
    }
  } else {
    const user = await db.user.findUnique({
      where: { email: options.email! },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        signInMethod: true,
      },
    });
    if (!user) {
      console.error(`No account for ${options.email}.`);
      process.exit(1);
    }
    if (!user.active) {
      console.error(
        `${options.email} is deactivated. Reactivate it before giving it a password.`,
      );
      process.exit(1);
    }
    done.push(await grant(user));
  }

  if (done.length === 0) {
    console.log("\nNothing to do — everybody already has a way in.");
  } else {
    console.log(
      `\n${done.length} account${done.length === 1 ? "" : "s"} can now sign in with a password.`,
    );
    console.log("Shown once. Hand each one to its owner and to nobody else.\n");
    for (const entry of done) {
      console.log(`  ${entry.email}`);
      console.log(`  ${entry.name}: ${entry.password}\n`);
    }
    console.log(
      "Each is good for one sign-in: the app asks for a new password before it",
    );
    console.log("will show anything else.");
  }

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
