-- A password an SSO account may also sign in with.
--
-- Additive and off for everybody. Granting it is a decision an administrator
-- makes per person, so there is deliberately no back-fill here: a migration
-- that opened a second door into every account in the company would be the
-- opposite of what this is for.
ALTER TABLE "User" ADD COLUMN "passwordFallback" BOOLEAN NOT NULL DEFAULT false;
