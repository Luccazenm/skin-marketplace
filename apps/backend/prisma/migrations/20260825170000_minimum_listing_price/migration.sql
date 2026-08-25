-- Hand-written. Prisma does not generate CHECK constraints — if this
-- block disappears from a future migration, it was deleted by mistake.
--
-- A listing has to be worth more than the commission that will be taken
-- from it. We never charge less than a cent, so a one-cent listing pays
-- the seller nothing: the fee is the whole price. Two cents is the
-- first price that leaves them something.
--
-- **This is a floor, not the policy.** The live minimum is derived from
-- PLATFORM_FEE_PERCENT and served on GET /api/config, and it can only
-- ever be higher than this. What the constraint stops is the case the
-- API cannot: a script, a fixture or a future worker writing straight to
-- the table.
--
-- Replaces IntendedListing_price_positive, which allowed 0.01. Dropped
-- deliberately and by name, not lost.
ALTER TABLE "IntendedListing"
  DROP CONSTRAINT IF EXISTS "IntendedListing_price_positive";

ALTER TABLE "IntendedListing"
  ADD CONSTRAINT "IntendedListing_price_minimum" CHECK ("price" >= 0.02);

-- Listing had no constraint at all: the price the seller opens at was
-- guarded, the price a buyer is actually charged was not. Same rule, on
-- the table that decides what somebody pays.
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_price_minimum" CHECK ("price" >= 0.02);

-- An order freezes what was charged, what we kept and what the seller
-- receives. None of the three may be negative, and the arithmetic has to
-- close: a row where payout + fee is not the price is a row nobody can
-- reconcile six months from now.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_are_consistent" CHECK (
    "price" >= 0.02
    AND "feeAmount" >= 0
    AND "sellerPayout" >= 0
    AND "sellerPayout" + "feeAmount" = "price"
  );
