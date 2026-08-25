-- Details that belong to the person rather than to their sign-in.
--
-- Everything the app knew about somebody came from NextCloud: a name, an email
-- and a photo. Payroll and anything with a signature line need more than that,
-- and none of it has anywhere to live.
--
-- nameOverridden guards the display name. NextCloud refreshes `name` on every
-- sign-in, so a correction made here would last until that person next signed
-- in and then quietly revert — which is worse than not being able to correct it
-- at all, because nobody would know it had gone.
ALTER TABLE "User"
  ADD COLUMN "nameOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "legalName"    TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city"         TEXT,
  ADD COLUMN "state"        TEXT,
  ADD COLUMN "postalCode"   TEXT,
  ADD COLUMN "country"      TEXT DEFAULT 'USA';
