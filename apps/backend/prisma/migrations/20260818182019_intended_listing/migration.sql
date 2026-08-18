-- The price the seller set, held from the deposit request until the bot
-- receives the item. See the model comment in schema.prisma.

-- CreateTable
CREATE TABLE "IntendedListing" (
    "id" TEXT NOT NULL,
    "tradeOfferId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntendedListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntendedListing_tradeOfferId_idx" ON "IntendedListing"("tradeOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "IntendedListing_tradeOfferId_assetId_key" ON "IntendedListing"("tradeOfferId", "assetId");

-- AddForeignKey
ALTER TABLE "IntendedListing" ADD CONSTRAINT "IntendedListing_tradeOfferId_fkey" FOREIGN KEY ("tradeOfferId") REFERENCES "TradeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HAND-WRITTEN: Prisma does not generate CHECK constraints.
-- If this block disappears from a future migration, it was deleted by
-- mistake.
--
-- A listing priced at zero or below is not a sale, it is a giveaway, and
-- the whole ledger is built on a sale moving money. The API refuses it
-- too, but the API is one caller: a script, a fixture or a future worker
-- writing straight to the table would slip past that, and this is the
-- price a buyer will be charged.
ALTER TABLE "IntendedListing"
  ADD CONSTRAINT "IntendedListing_price_positive" CHECK ("price" > 0);
