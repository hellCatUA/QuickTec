-- The total tech budget, and the shares that add up to it.
--
-- Entirely additive. Every column is nullable or carries a default, so
-- Postgres writes them into the catalogue without rewriting either table, and
-- nothing already recorded moves.
--
-- Nothing is back-filled on purpose. "budgetType" null means this job predates
-- budgets: its crew keep the rates frozen onto their assignments and the old
-- resolution still applies. Copying "payType"/"payRate" across would look
-- tempting and be wrong — the old field is a rate applied to everybody, the new
-- one is a total shared between them, so a two-tech job would silently halve.
ALTER TYPE "PayType" ADD VALUE 'FLAT_HOURLY';

CREATE TYPE "SplitMode" AS ENUM ('EVEN', 'BY_TECH_RATE', 'MANUAL');

ALTER TABLE "Job"
    ADD COLUMN "budgetType" "PayType",
    ADD COLUMN "budgetFlat" DECIMAL(10,2),
    ADD COLUMN "budgetFlatHours" DECIMAL(6,2),
    ADD COLUMN "budgetHourly" DECIMAL(10,2),
    ADD COLUMN "budgetSplit" "SplitMode" NOT NULL DEFAULT 'EVEN';

ALTER TABLE "JobAssignment"
    ADD COLUMN "payFlat" DECIMAL(10,2),
    ADD COLUMN "payFlatHours" DECIMAL(6,2),
    ADD COLUMN "shareBasisPoints" INTEGER;
