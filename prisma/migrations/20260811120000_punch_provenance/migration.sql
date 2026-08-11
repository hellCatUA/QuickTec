-- A punch written by hand is a reconstruction, not a record, and the screen
-- should say which. ADJUSTED does not answer it: a real punch corrected
-- afterwards is ADJUSTED too.
ALTER TABLE "Visit" ADD COLUMN "addedManually" BOOLEAN NOT NULL DEFAULT false;

-- A late start and an overrun happened whether or not anybody minds. Once a
-- reviewer has accepted one it stops being a warning and becomes a note, and
-- the one they did not accept keeps its colour.
ALTER TABLE "Visit" ADD COLUMN "lateAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Visit" ADD COLUMN "lateAcceptedById" TEXT;
ALTER TABLE "Visit" ADD COLUMN "overAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Visit" ADD COLUMN "overAcceptedById" TEXT;
