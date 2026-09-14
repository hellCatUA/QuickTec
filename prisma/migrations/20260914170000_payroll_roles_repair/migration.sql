-- Undoes a self-inflicted wound in 20260914120000_payroll_roles.
--
-- That migration inserts ADMINISTRATOR grants for five pay permissions. On an
-- existing deployment that is exactly right. On a FRESH one it is a trap:
-- `prisma migrate deploy` runs before `prisma db seed`, and the seed
-- deliberately only seeds a permission that has no rows at all — that is what
-- stops it overwriting a matrix a manager owns. So the five rows the migration
-- had just written made the seed skip those permissions entirely, and a brand
-- new install came up with export.pay, pay.edit_rates, payroll.run,
-- payroll.approve and payroll.mark_received granted to ADMINISTRATOR and to
-- nobody else. A manager could not run payroll on their own deployment.
--
-- The repair is to put the table back to "never heard of this permission" in
-- exactly that case, and let the seed apply DEFAULT_ROLE_GRANTS, which is the
-- single source of truth and already carries the new administrator scopes.
--
-- Conditioned on the row being the one the earlier migration wrote (its ids are
-- constructed, not random) and on it being the ONLY grant for that permission.
-- On a deployment that was already running, every other role still holds these,
-- so nothing here matches and the earlier migration's effect stands untouched.

DELETE FROM "RoleGrant" AS solitary
WHERE solitary."id" LIKE 'mig20260914-admin-%'
  AND solitary."role" = 'ADMINISTRATOR'
  AND NOT EXISTS (
    SELECT 1 FROM "RoleGrant" AS other
    WHERE other."permission" = solitary."permission"
      AND other."id" <> solitary."id"
  );
