-- A size knob for each of the two logos.
--
-- Not a matter of taste. A supplied logo file carries padding of its own, and
-- how much is invisible from the outside: one lockup fills its canvas edge to
-- edge, the next leaves a fifth of it empty, and dropped into the same box the
-- second reads noticeably smaller than the first. Without a knob the only fix
-- is to re-cut the artwork, which is not something a deployment can do.
--
-- Percent against a base the code owns rather than a pixel height, so the
-- default is 100 everywhere and the header and the sign-in page keep their own
-- sizes while still moving together.
--
-- The app icon gets no such column on purpose: a favicon is drawn by the
-- browser and the home screen by the OS, and neither takes our opinion.

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN "logoScale" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "CompanySettings" ADD COLUMN "headerLogoScale" INTEGER NOT NULL DEFAULT 100;
