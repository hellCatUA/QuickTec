-- An unfinished new-job form.
--
-- Deliberately not a Job. A Job row is load-bearing — job lists, the dashboard,
-- calendar sync, exports and payroll queries all read it, and every one would
-- have to tolerate a half-filled one. And allocateIntWo *consumes* a counter,
-- so a number given to a draft that is then abandoned leaves a hole in a
-- sequence that reaches client paperwork.
--
-- Purely additive: one new table, one foreign key to User. Nothing existing is
-- read, written or locked beyond the brief catalogue change on User's side,
-- which is none — the FK is declared on this table.
--
-- One draft per person (unique on userId). The form is a single place, and two
-- drafts would need a picker to choose between them; a draft that ought to be
-- handed to somebody else is a Job, not a draft.
--
-- ON DELETE CASCADE: a draft belongs to the person who typed it and is worth
-- nothing without them.

-- CreateTable
CREATE TABLE "JobDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDraft_userId_key" ON "JobDraft"("userId");

-- AddForeignKey
ALTER TABLE "JobDraft" ADD CONSTRAINT "JobDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
