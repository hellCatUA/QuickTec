-- What a site contact does, and the words to offer while somebody types it.
--
-- Both additive. The column is nullable with no default, which Postgres writes
-- into the catalogue alone — no table rewrite, and every contact already on a
-- job keeps reading exactly as it did. The dictionary starts empty here; the
-- seed puts the first set in, and it is only ever a list of suggestions, so a
-- deployment that never runs the seed loses nothing but the typing.
ALTER TABLE "PointOfContact" ADD COLUMN "position" TEXT;

CREATE TABLE "ContactPosition" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactPosition_label_key" ON "ContactPosition"("label");
CREATE INDEX "ContactPosition_active_order_idx" ON "ContactPosition"("active", "order");
