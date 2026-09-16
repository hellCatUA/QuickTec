-- Two brands in one header, and a square that is neither.
--
-- logoUrl is the company that owns the deployment. The product's own wordmark
-- was a hardcoded string beside it, so there was nowhere to put a real one, and
-- the favicon was a placeholder committed to public/icons. Both get a field,
-- kept apart from logoUrl and from each other because they are three different
-- jobs: whose deployment this is, what it is running, and what survives being
-- 16 pixels wide in a browser tab.

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN "headerLogoUrl" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "appIconUrl" TEXT;
