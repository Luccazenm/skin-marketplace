-- CreateEnum
CREATE TYPE "TradeOfferReason" AS ENUM ('DEPOSIT_INTAKE', 'DELIVERY', 'RETURN', 'WITHDRAWAL');

-- AlterEnum
ALTER TYPE "TradeOfferStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "SkinTemplate" ADD COLUMN     "buyoutDiscountPct" DECIMAL(5,2),
ADD COLUMN     "buyoutEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liquidityUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "salesVolume30d" INTEGER;

-- AlterTable
ALTER TABLE "TradeOffer" ADD COLUMN     "reason" "TradeOfferReason" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SkinTemplate_buyoutEligible_idx" ON "SkinTemplate"("buyoutEligible");

-- CreateIndex
CREATE INDEX "TradeOffer_status_scheduledFor_idx" ON "TradeOffer"("status", "scheduledFor");
