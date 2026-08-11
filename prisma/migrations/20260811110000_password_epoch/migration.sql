-- Sessions are JWTs, so a reset had nothing to revoke: whoever had learned the
-- old password stayed signed in until their token expired. Comparing the
-- token's issue time against this cuts them off at the moment of the reset.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
