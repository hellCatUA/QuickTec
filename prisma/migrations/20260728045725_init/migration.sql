-- CreateEnum
CREATE TYPE "BaseRole" AS ENUM ('ADMINISTRATOR', 'MANAGER', 'SUPERVISOR', 'TECH', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'REPORTS', 'PROJECT', 'ALL');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_MANAGER', 'SUPERVISOR', 'TECH');

-- CreateEnum
CREATE TYPE "JobLifecycle" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_REVIEW', 'APPROVED');

-- CreateEnum
CREATE TYPE "JobOutcome" AS ENUM ('COMPLETED', 'INCOMPLETE', 'FAIL', 'CANCEL');

-- CreateEnum
CREATE TYPE "JobInternalStatus" AS ENUM ('REVISIT_REQUIRED', 'RESCHEDULED', 'RESCHEDULE_CANCELLED');

-- CreateEnum
CREATE TYPE "ClockSource" AS ENUM ('NOW', 'ADJUSTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('MOD', 'NOC', 'PM_PC');

-- CreateEnum
CREATE TYPE "SignatureKind" AS ENUM ('MOD', 'TECH');

-- CreateEnum
CREATE TYPE "DeliverableCategory" AS ENUM ('PRE_INSTALL', 'POST_INSTALL', 'SIGN_OFF', 'ISSUES', 'ADDITIONAL_INFO', 'OLD_SERIALS', 'NEW_SERIALS', 'RETURN_LABELS', 'EQUIPMENT_LEFT_ON_SITE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReimbursementType" AS ENUM ('MATERIAL', 'PARKING', 'TOLL', 'HOTEL');

-- CreateEnum
CREATE TYPE "MileageCategory" AS ENUM ('IN_ROUTE_TO_WO', 'RETURNING_HOME', 'OFFCLOCK_TOOLS_SUPPLIES', 'ONCLOCK_TOOLS_SUPPLIES', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'FLAT', 'NON_BILLABLE');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'RECEIVED', 'REDUCED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nextcloudSub" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "baseRole" "BaseRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "directSupervisorId" TEXT,
    "calendarUrl" TEXT,
    "calendarName" TEXT,
    "defaultPayType" "PayType",
    "defaultPayRate" DECIMAL(10,2),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleGrant" (
    "id" TEXT NOT NULL,
    "role" "BaseRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "scope" "PermissionScope",
    "projectId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT 'QuickTec',
    "logoUrl" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'USA',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "intWoLabel" TEXT NOT NULL DEFAULT 'INT WO ID',
    "defaultTimeZone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timeRoundingMinutes" INTEGER NOT NULL DEFAULT 5,
    "techTimeAdjustLimit" INTEGER NOT NULL DEFAULT 30,
    "breakPaidByDefault" BOOLEAN NOT NULL DEFAULT true,
    "mileageRate" DECIMAL(10,4) NOT NULL DEFAULT 0.70,
    "payLagWeeks" INTEGER NOT NULL DEFAULT 3,
    "maxPhotosPerJob" INTEGER NOT NULL DEFAULT 30,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteNumber" TEXT NOT NULL,
    "name" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'USA',
    "timeZone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalProjectId" TEXT,
    "clientId" TEXT NOT NULL,
    "customerId" TEXT,
    "managerId" TEXT,
    "generalScopeOfWork" TEXT,
    "travelReimbursement" DECIMAL(10,2),
    "breakPaid" BOOLEAN NOT NULL DEFAULT true,
    "intWoCounter" INTEGER NOT NULL DEFAULT 0,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'TECH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "intWoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "projectId" TEXT,
    "ticketNumber" TEXT,
    "incNumber" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "estimateMinutes" INTEGER,
    "techsRequired" INTEGER NOT NULL DEFAULT 1,
    "scopeOfWork" TEXT,
    "breakPaid" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle" "JobLifecycle" NOT NULL DEFAULT 'DRAFT',
    "outcome" "JobOutcome",
    "internalStatus" "JobInternalStatus",
    "releaseCode" TEXT,
    "noReleaseCode" BOOLEAN NOT NULL DEFAULT false,
    "returnTrackingNumber" TEXT,
    "workPerformedMerged" TEXT,
    "parentJobId" TEXT,
    "revisitNumber" INTEGER,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "calendarSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAssignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalAssignmentId" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "supervisorId" TEXT,
    "payType" "PayType" NOT NULL,
    "payRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payRateNote" TEXT,
    "travelReimbursement" DECIMAL(10,2),
    "workPerformed" TEXT,
    "checkoutPrefilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockInSource" "ClockSource" NOT NULL DEFAULT 'NOW',
    "clockInRawAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "clockOutSource" "ClockSource",
    "clockOutRawAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakPeriod" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "paid" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobScopeCheck" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "JobScopeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchContact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "projectId" TEXT,
    "label" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DispatchContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointOfContact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PointOfContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "SignatureKind" NOT NULL,
    "pointOfContactId" TEXT,
    "assignmentId" TEXT,
    "signerName" TEXT NOT NULL,
    "attachmentId" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skippedReason" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableRequirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "category" "DeliverableCategory" NOT NULL,
    "customLabel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT true,
    "requiresText" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliverableRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "category" "DeliverableCategory" NOT NULL,
    "customLabel" TEXT,
    "textValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverableItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "ReimbursementType" NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileageEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "MileageCategory" NOT NULL,
    "jobId" TEXT,
    "reference" TEXT,
    "startOdometer" DECIMAL(10,1) NOT NULL,
    "endOdometer" DECIMAL(10,1) NOT NULL,
    "miles" DECIMAL(10,1) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "startPhotoId" TEXT,
    "endPhotoId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "payrollLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MileageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "payType" "PayType" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "travelReimbursement" DECIMAL(10,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "supervisorId" TEXT,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receivedAmount" DECIMAL(12,2),
    "receivedDate" TIMESTAMP(3),
    "expectedPayDate" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedAsFallback" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "payRate" DECIMAL(10,2) NOT NULL,
    "paidMinutes" INTEGER NOT NULL DEFAULT 0,
    "laborAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "travelReimb" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "parkingTollsReimb" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "hotelReimb" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "materialsReimb" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalExpected" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overrideAmount" DECIMAL(10,2),
    "overrideNote" TEXT,
    "receivedAmount" DECIMAL(10,2),
    "payStatus" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedDate" TIMESTAMP(3),
    "payNote" TEXT,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliverableItemId" TEXT,
    "reimbursementId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "jobId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntWoCounter" (
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IntWoCounter_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_nextcloudSub_key" ON "User"("nextcloudSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_baseRole_active_idx" ON "User"("baseRole", "active");

-- CreateIndex
CREATE INDEX "User_directSupervisorId_idx" ON "User"("directSupervisorId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleGrant_role_permission_key" ON "RoleGrant"("role", "permission");

-- CreateIndex
CREATE INDEX "PermissionOverride_userId_idx" ON "PermissionOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionOverride_userId_permission_projectId_key" ON "PermissionOverride"("userId", "permission", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Site_siteNumber_idx" ON "Site"("siteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Site_customerId_siteNumber_key" ON "Site"("customerId", "siteNumber");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_intWoId_key" ON "Job"("intWoId");

-- CreateIndex
CREATE INDEX "Job_lifecycle_idx" ON "Job"("lifecycle");

-- CreateIndex
CREATE INDEX "Job_siteId_idx" ON "Job"("siteId");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "Job_scheduledStart_idx" ON "Job"("scheduledStart");

-- CreateIndex
CREATE INDEX "JobAssignment_userId_idx" ON "JobAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobAssignment_jobId_userId_key" ON "JobAssignment"("jobId", "userId");

-- CreateIndex
CREATE INDEX "Visit_assignmentId_idx" ON "Visit"("assignmentId");

-- CreateIndex
CREATE INDEX "Visit_clockInAt_idx" ON "Visit"("clockInAt");

-- CreateIndex
CREATE INDEX "BreakPeriod_visitId_idx" ON "BreakPeriod"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "JobScopeCheck_jobId_lineKey_key" ON "JobScopeCheck"("jobId", "lineKey");

-- CreateIndex
CREATE INDEX "DispatchContact_jobId_idx" ON "DispatchContact"("jobId");

-- CreateIndex
CREATE INDEX "DispatchContact_projectId_idx" ON "DispatchContact"("projectId");

-- CreateIndex
CREATE INDEX "PointOfContact_jobId_type_idx" ON "PointOfContact"("jobId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_attachmentId_key" ON "Signature"("attachmentId");

-- CreateIndex
CREATE INDEX "Signature_jobId_idx" ON "Signature"("jobId");

-- CreateIndex
CREATE INDEX "DeliverableRequirement_projectId_idx" ON "DeliverableRequirement"("projectId");

-- CreateIndex
CREATE INDEX "DeliverableRequirement_jobId_idx" ON "DeliverableRequirement"("jobId");

-- CreateIndex
CREATE INDEX "DeliverableItem_jobId_category_idx" ON "DeliverableItem"("jobId", "category");

-- CreateIndex
CREATE INDEX "Reimbursement_jobId_type_idx" ON "Reimbursement"("jobId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MileageEntry_startPhotoId_key" ON "MileageEntry"("startPhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "MileageEntry_endPhotoId_key" ON "MileageEntry"("endPhotoId");

-- CreateIndex
CREATE INDEX "MileageEntry_userId_startedAt_idx" ON "MileageEntry"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "MileageEntry_jobId_idx" ON "MileageEntry"("jobId");

-- CreateIndex
CREATE INDEX "PayRate_userId_idx" ON "PayRate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayRate_userId_projectId_clientId_key" ON "PayRate"("userId", "projectId", "clientId");

-- CreateIndex
CREATE INDEX "PayrollPeriod_supervisorId_weekStart_idx" ON "PayrollPeriod"("supervisorId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_userId_weekStart_key" ON "PayrollPeriod"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_payrollPeriodId_assignmentId_key" ON "PayrollLine"("payrollPeriodId", "assignmentId");

-- CreateIndex
CREATE INDEX "ChangeRequest_jobId_status_idx" ON "ChangeRequest"("jobId", "status");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_idx" ON "ChangeRequest"("status");

-- CreateIndex
CREATE INDEX "Attachment_deliverableItemId_idx" ON "Attachment"("deliverableItemId");

-- CreateIndex
CREATE INDEX "Attachment_reimbursementId_idx" ON "Attachment"("reimbursementId");

-- CreateIndex
CREATE INDEX "AuditEvent_jobId_createdAt_idx" ON "AuditEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_directSupervisorId_fkey" FOREIGN KEY ("directSupervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionOverride" ADD CONSTRAINT "PermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionOverride" ADD CONSTRAINT "PermissionOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakPeriod" ADD CONSTRAINT "BreakPeriod_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScopeCheck" ADD CONSTRAINT "JobScopeCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScopeCheck" ADD CONSTRAINT "JobScopeCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchContact" ADD CONSTRAINT "DispatchContact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchContact" ADD CONSTRAINT "DispatchContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointOfContact" ADD CONSTRAINT "PointOfContact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_pointOfContactId_fkey" FOREIGN KEY ("pointOfContactId") REFERENCES "PointOfContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableRequirement" ADD CONSTRAINT "DeliverableRequirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableRequirement" ADD CONSTRAINT "DeliverableRequirement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableItem" ADD CONSTRAINT "DeliverableItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableItem" ADD CONSTRAINT "DeliverableItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_startPhotoId_fkey" FOREIGN KEY ("startPhotoId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_endPhotoId_fkey" FOREIGN KEY ("endPhotoId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_deliverableItemId_fkey" FOREIGN KEY ("deliverableItemId") REFERENCES "DeliverableItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "Reimbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
