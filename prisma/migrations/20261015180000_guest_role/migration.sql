-- Somebody outside the company: a vendor, a partner, a buyer, a client. No
-- grants are seeded for it — a guest starts with no permissions at all.
ALTER TYPE "BaseRole" ADD VALUE 'GUEST';
