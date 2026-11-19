-- One request waiting per person per field. Filing a new one replaces the one
-- waiting, but two sent at the same moment — a double tap — both found
-- nothing to replace and both stayed; approving the older one later put it
-- over the newer. A partial index says "one while pending", which a plain
-- unique constraint cannot.
--
-- Any pair already waiting keeps its newest, as filing it would have; the
-- older one's picture file is left on the volume, and is not shown anywhere.
DELETE FROM "ProfileRequest" AS older
 USING "ProfileRequest" AS newer
 WHERE older."status" = 'PENDING'
   AND newer."status" = 'PENDING'
   AND older."userId" = newer."userId"
   AND older."field" = newer."field"
   AND (older."createdAt", older."id") < (newer."createdAt", newer."id");

CREATE UNIQUE INDEX "ProfileRequest_userId_field_pending_key"
  ON "ProfileRequest"("userId", "field")
  WHERE "status" = 'PENDING';
