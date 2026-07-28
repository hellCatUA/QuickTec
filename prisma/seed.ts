import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { DEFAULT_ROLE_GRANTS } from "../src/lib/permissions";

/**
 * Idempotent. Safe to run on every deploy.
 *
 * Role grants are seeded only when the table is empty: once a Manager has
 * tuned the matrix in the UI, re-running the seed must not undo their work.
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

  const existingGrants = await db.roleGrant.count();
  if (existingGrants > 0) {
    console.log(
      `role grants already customised (${existingGrants} rows) — left untouched`,
    );
  } else {
    const rows = Object.entries(DEFAULT_ROLE_GRANTS).flatMap(
      ([role, grants]) =>
        Object.entries(grants).map(([permission, scope]) => ({
          role: role as never,
          permission,
          scope: scope as never,
        })),
    );

    await db.roleGrant.createMany({ data: rows, skipDuplicates: true });
    console.log(`seeded ${rows.length} role grants`);
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
