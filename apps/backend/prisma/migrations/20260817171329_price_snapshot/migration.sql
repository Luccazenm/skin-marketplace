-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('CS2SH', 'STEAMWEBAPI', 'INTERNO');

-- CreateEnum
CREATE TYPE "PriceMarket" AS ENUM ('BUFF163', 'YOUPIN', 'CSFLOAT', 'SKINPORT', 'C5GAME', 'DMARKET', 'WAXPEER', 'BITSKINS', 'STEAM', 'NEXTSKINS');

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "skinTemplateId" TEXT NOT NULL,
    "source" "PriceSource" NOT NULL,
    "market" "PriceMarket" NOT NULL,
    "price" DECIMAL(14,4) NOT NULL,
    "bid" DECIMAL(14,4),
    "ask" DECIMAL(14,4),
    "volume24h" INTEGER,
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceSnapshot_skinTemplateId_market_quotedAt_idx" ON "PriceSnapshot"("skinTemplateId", "market", "quotedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_skinTemplateId_source_market_quotedAt_key" ON "PriceSnapshot"("skinTemplateId", "source", "market", "quotedAt");

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_skinTemplateId_fkey" FOREIGN KEY ("skinTemplateId") REFERENCES "SkinTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
