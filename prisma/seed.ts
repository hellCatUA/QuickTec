import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { DEFAULT_ROLE_GRANTS, PERMISSION_KEYS } from "../src/lib/permissions";

/**
 * Idempotent. Safe to run on every deploy.
 *
 * The permission matrix belongs to Managers once they have touched it, so the
 * seed never rewrites a permission the database already knows about. It only:
 *
 *   - seeds defaults for permissions that appear in no grant at all, which is
 *     both the empty-database case and the "this release added a permission"
 *     case. Without the second, a new permission would ship granted to nobody.
 *   - deletes grants for permissions the app has since retired.
 *
 * The one thing this gets wrong is a permission a manager has deliberately
 * revoked from every single role: the next deploy restores its defaults. That
 * is rare, visible in the matrix, and one click to undo — worth trading for
 * upgrades that actually deliver new permissions.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  await db.companySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  console.log("company settings ready");

  const known = new Set(
    (
      await db.roleGrant.findMany({
        distinct: ["permission"],
        select: { permission: true },
      })
    ).map((grant) => grant.permission),
  );

  const rows = Object.entries(DEFAULT_ROLE_GRANTS).flatMap(([role, grants]) =>
    Object.entries(grants)
      .filter(([permission]) => !known.has(permission))
      .map(([permission, scope]) => ({
        role: role as never,
        permission,
        scope: scope as never,
      })),
  );

  if (rows.length > 0) {
    await db.roleGrant.createMany({ data: rows, skipDuplicates: true });
    const added = new Set(rows.map((row) => row.permission));
    console.log(
      `seeded ${rows.length} grants across ${added.size} new permission(s): ${[...added].join(", ")}`,
    );
  } else {
    console.log("role grants up to date — nothing to seed");
  }

  // Permissions get renamed and retired between versions. Grants for names the
  // app no longer knows about are dead weight that still shows up in queries,
  // so clear them out on every deploy — this touches nothing a manager set for
  // a permission that still exists.
  const pruned = await db.roleGrant.deleteMany({
    where: { permission: { notIn: PERMISSION_KEYS } },
  });
  if (pruned.count > 0) {
    console.log(`pruned ${pruned.count} grants for retired permissions`);
  }

  const prunedOverrides = await db.permissionOverride.deleteMany({
    where: { permission: { notIn: PERMISSION_KEYS } },
  });
  if (prunedOverrides.count > 0) {
    console.log(
      `pruned ${prunedOverrides.count} user overrides for retired permissions`,
    );
  }

  const currentYear = new Date().getFullYear();
  await db.intWoCounter.upsert({
    where: { scope: `global:${currentYear}` },
    update: {},
    create: { scope: `global:${currentYear}`, value: 0 },
  });
  console.log(`INT WO counter ready for ${currentYear}`);

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
