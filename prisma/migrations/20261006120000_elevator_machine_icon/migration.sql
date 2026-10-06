-- The elevator machine room is drawn with its traction machine rather than a
-- plain gear. Only where the seed's own choice is still in place: an icon
-- somebody picked in settings is theirs and stays.
UPDATE "KnownLocation"
   SET "icon" = 'elevator-machine', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "label" = 'Elevator machine room'
   AND "icon" = 'cog';
