/*
  Warnings:

  - You are about to drop the `ItemSticker` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ItemApplicationKind" AS ENUM ('STICKER', 'PATCH', 'CHARM');

-- DropForeignKey
ALTER TABLE "ItemSticker" DROP CONSTRAINT "ItemSticker_itemId_fkey";

-- DropTable
DROP TABLE "ItemSticker";

-- CreateTable
CREATE TABLE "ItemApplication" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "ItemApplicationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "slot" INTEGER NOT NULL,
    "wear" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemApplication_itemId_idx" ON "ItemApplication"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemApplication_itemId_kind_slot_key" ON "ItemApplication"("itemId", "kind", "slot");

-- AddForeignKey
ALTER TABLE "ItemApplication" ADD CONSTRAINT "ItemApplication_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito a mao: o Prisma nao gera CHECK constraints.
-- Se este bloco sumir numa migration futura, foi apagado por engano.
-- ---------------------------------------------------------------------------

-- Raspagem so existe em sticker. Patch e chaveiro nao podem ter valor ali,
-- e sticker sem leitura do inspect link fica nulo ate ser preenchido.
ALTER TABLE "ItemApplication"
  ADD CONSTRAINT "ItemApplication_wear_so_em_sticker" CHECK (
    "wear" IS NULL OR "kind" = 'STICKER'
  );

-- Raspagem e normalizada: fora de [0,1] indica leitura corrompida.
ALTER TABLE "ItemApplication"
  ADD CONSTRAINT "ItemApplication_wear_intervalo" CHECK (
    "wear" IS NULL OR ("wear" >= 0 AND "wear" <= 1)
  );

-- Limites de slot da Valve: 5 stickers por arma, 3 patches por agente,
-- 1 chaveiro. Slot fora disso indica erro de leitura, nao item exotico.
ALTER TABLE "ItemApplication"
  ADD CONSTRAINT "ItemApplication_slot_por_tipo" CHECK (
    CASE "kind"
      WHEN 'STICKER' THEN "slot" BETWEEN 0 AND 4
      WHEN 'PATCH'   THEN "slot" BETWEEN 0 AND 2
      WHEN 'CHARM'   THEN "slot" = 0
    END
  );
