-- What every job raised under a project starts with, beyond what it already
-- carried: a total tech budget, the rooms, and which company blanks.

ALTER TABLE "Project" ADD COLUMN "defaultBudgetType" "PayType";
ALTER TABLE "Project" ADD COLUMN "defaultBudgetFlat" DECIMAL(10,2);
ALTER TABLE "Project" ADD COLUMN "defaultBudgetFlatHours" DECIMAL(6,2);
ALTER TABLE "Project" ADD COLUMN "defaultBudgetHourly" DECIMAL(10,2);
ALTER TABLE "Project" ADD COLUMN "defaultBudgetSplit" "SplitMode" NOT NULL DEFAULT 'EVEN';
ALTER TABLE "Project" ADD COLUMN "ownTemplates" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProjectLocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectLocation_projectId_idx" ON "ProjectLocation"("projectId");
CREATE UNIQUE INDEX "ProjectLocation_projectId_name_key" ON "ProjectLocation"("projectId", "name");
-- "MDF" and "mdf" are one room, as on a job.
CREATE UNIQUE INDEX "ProjectLocation_projectId_lower_name_key" ON "ProjectLocation"("projectId", lower("name"));

ALTER TABLE "ProjectLocation" ADD CONSTRAINT "ProjectLocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Implicit many-to-many: Project <-> ClientDocumentTemplate ("ProjectTemplates").
CREATE TABLE "_ProjectTemplates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProjectTemplates_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_ProjectTemplates_B_index" ON "_ProjectTemplates"("B");

ALTER TABLE "_ProjectTemplates" ADD CONSTRAINT "_ProjectTemplates_A_fkey" FOREIGN KEY ("A") REFERENCES "ClientDocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProjectTemplates" ADD CONSTRAINT "_ProjectTemplates_B_fkey" FOREIGN KEY ("B") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
