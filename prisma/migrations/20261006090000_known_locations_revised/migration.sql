-- The default locations as revised: front and back of house and the two
-- drive-thru lanes in, the sales floor, stockroom and break room out.
--
-- Only touches a list the seed has already written. On a database where the
-- table is still empty nothing here matches, and the seed writes the revised
-- list itself. Each change is made in the place of the one it replaces, so
-- the order somebody may already have set is kept, and none is made if an
-- entry with the new name is already there.
UPDATE "KnownLocation"
   SET "label" = 'FoH', "icon" = 'utensils-crossed', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "label" = 'Sales floor'
   AND NOT EXISTS (SELECT 1 FROM "KnownLocation" WHERE lower("label") = 'foh');

UPDATE "KnownLocation"
   SET "label" = 'BoH', "icon" = 'chef-hat', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "label" = 'Stockroom'
   AND NOT EXISTS (SELECT 1 FROM "KnownLocation" WHERE lower("label") = 'boh');

UPDATE "KnownLocation"
   SET "label" = 'DT Lane1', "icon" = 'car', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "label" = 'Break room'
   AND NOT EXISTS (SELECT 1 FROM "KnownLocation" WHERE lower("label") = 'dt lane1');

-- The second lane shares the first one's place; the list breaks the tie by
-- name, which puts it straight after.
INSERT INTO "KnownLocation" ("id", "label", "icon", "order", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'DT Lane2', 'car', "order", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "KnownLocation"
 WHERE "label" = 'DT Lane1'
   AND NOT EXISTS (SELECT 1 FROM "KnownLocation" WHERE lower("label") = 'dt lane2');
