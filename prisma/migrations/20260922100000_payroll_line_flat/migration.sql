-- The flat half of a Flat + Hourly line, on the snapshot that is supposed to
-- be able to stand alone.
--
-- Both nullable, so Postgres writes them into the catalogue without rewriting
-- the table and every line already recorded reads exactly as it did. Nothing
-- is back-filled: a line written before this migration was written from terms
-- that had no flat half, so null is the truth about it.
ALTER TABLE "PayrollLine"
    ADD COLUMN "payFlat" DECIMAL(10,2),
    ADD COLUMN "payFlatHours" DECIMAL(6,2);
