-- The dictionary of locations offered while somebody adds one to a job, and
-- the icon a job's location is drawn with. Both additive: the column is
-- nullable with no default, so every location already on a job reads as it
-- did. The dictionary starts empty here; the seed puts the first set in, as it
-- does for contact positions.
ALTER TABLE "JobLocation" ADD COLUMN "icon" TEXT;

CREATE TABLE "KnownLocation" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnownLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnownLocation_label_key" ON "KnownLocation"("label");
CREATE INDEX "KnownLocation_active_order_idx" ON "KnownLocation"("active", "order");
