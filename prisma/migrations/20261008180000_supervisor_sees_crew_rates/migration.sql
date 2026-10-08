-- Supervisors see the rates of the crews on their projects: the WM Form each
-- tech sends carries their pay, and supervisors send it. Only the old default
-- is changed — a role somebody set to anything else in Settings → Roles keeps
-- what they set. Rows only: a fresh install has none yet, and its seed writes
-- the new default for every role.
UPDATE "RoleGrant"
SET "scope" = 'PROJECT'
WHERE "role" = 'SUPERVISOR'
  AND "permission" = 'pay.view_rates'
  AND "scope" = 'OWN';
