-- The brand assets are uploaded files now, not addresses.
--
-- The company logo, the header wordmark and the app icon were typed into
-- Settings as links to somewhere else, and they showed only as reliably as
-- that somewhere else: a share that moved or expired, a host that refused to
-- be embedded, and — for the app icon — a fetch back from inside the container
-- through the app's own Tailscale name, which it cannot count on reaching.
-- Each is now a file on the uploads volume, named by these columns, and served
-- by the app itself.
--
-- The old addresses are dropped rather than carried over: there is nothing to
-- carry them to until somebody uploads the file, and a link left in a column
-- nothing reads would only look like a setting. Upload the three files again
-- in Settings → Company after this runs.
ALTER TABLE "CompanySettings"
  DROP COLUMN "logoUrl",
  DROP COLUMN "headerLogoUrl",
  DROP COLUMN "appIconUrl",
  ADD COLUMN "logoPath" TEXT,
  ADD COLUMN "headerLogoPath" TEXT,
  ADD COLUMN "appIconPath" TEXT;
