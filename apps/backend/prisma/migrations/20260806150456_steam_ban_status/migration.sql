-- CreateEnum
CREATE TYPE "SteamEconomyBan" AS ENUM ('NONE', 'PROBATION', 'BANNED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "steamBanCheckedAt" TIMESTAMP(3),
ADD COLUMN     "steamEconomyBan" "SteamEconomyBan" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "steamVacBanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "User_steamEconomyBan_idx" ON "User"("steamEconomyBan");
