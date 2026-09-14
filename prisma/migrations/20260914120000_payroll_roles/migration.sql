-- Who pays, and who can be asked to.
--
-- The Direct Supervisor is not a job title, it is the person who approves and
-- pays a tech's week. The picker offered anybody who was not a tech, so a week
-- could be routed to somebody with no payroll reach at all — a supervisor, or a
-- system account — and would then sit forever reading "Waiting on 417 System"
-- with nobody able to act on it. From here only Managers and Administrators can
-- be picked, which is enforced in the action as well as the picker.
--
-- That rule forces two grant changes, applied here rather than left to the seed
-- because the seed deliberately never overwrites a matrix a manager owns, and
-- these are a change of policy rather than a new permission.
--
--   ADMINISTRATOR gains the whole payroll cycle. An administrator who may be
--   somebody's Direct Supervisor but may not approve their week is a dead end
--   with no way out of it.
--
--   SUPERVISOR drops to own money only. With supervisors no longer able to be
--   anybody's Direct Supervisor, REPORTS resolved to nothing but themselves —
--   which is not "a supervisor pays their techs", it is "a supervisor sets
--   their own pay rate". Running a project stays untouched.
--
-- Existing supervision links are left exactly as they are. Reassigning who
-- signs off somebody's money is a decision, not a migration; Settings → Users
-- names the ones that need one.

-- Administrators run the money.
-- The id is constructed rather than random so a row added here is recognisable
-- as having come from a migration and not from somebody editing the matrix.
INSERT INTO "RoleGrant" ("id", "role", "permission", "scope")
SELECT 'mig20260914-admin-' || permission, 'ADMINISTRATOR', permission, 'ALL'
FROM (VALUES
  ('export.pay'),
  ('pay.edit_rates'),
  ('payroll.run'),
  ('payroll.approve'),
  ('payroll.mark_received')
) AS wanted(permission)
ON CONFLICT ("role", "permission") DO UPDATE SET "scope" = 'ALL';

-- Supervisors keep only their own.
UPDATE "RoleGrant" SET "scope" = 'OWN'
WHERE "role" = 'SUPERVISOR'
  AND "permission" IN ('export.pay', 'pay.view_rates', 'payroll.view', 'payroll.mark_received');

DELETE FROM "RoleGrant"
WHERE "role" = 'SUPERVISOR'
  AND "permission" IN ('pay.edit_rates', 'payroll.run', 'payroll.approve');
