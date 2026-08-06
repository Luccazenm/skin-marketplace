/*
  Warnings:

  - Added the required column `category` to the `Item` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('RIFLE', 'PISTOL', 'SMG', 'SNIPER_RIFLE', 'SHOTGUN', 'MACHINEGUN', 'KNIFE', 'GLOVES', 'STICKER', 'CONTAINER', 'KEY', 'GRAFFITI', 'MUSIC_KIT', 'AGENT', 'PATCH', 'CHARM', 'TOOL', 'COLLECTIBLE', 'PASS', 'OTHER');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "category" "ItemCategory" NOT NULL,
ALTER COLUMN "float" DROP NOT NULL,
ALTER COLUMN "paintSeed" DROP NOT NULL,
ALTER COLUMN "paintIndex" DROP NOT NULL,
ALTER COLUMN "defIndex" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- ---------------------------------------------------------------------------
-- Escrito a mao: o Prisma nao gera CHECK constraints.
-- Se este bloco sumir numa migration futura, foi apagado por engano.
-- ---------------------------------------------------------------------------

-- Arma, faca e luva tem padrao unico e PRECISAM dos quatro campos: sem eles
-- o item nao pode ser reencontrado depois de uma troca, porque o assetId
-- muda. Categoria fungivel (caixa, adesivo, agente) nao tem padrao algum,
-- entao os campos ficam nulos.
ALTER TABLE "Item"
  ADD CONSTRAINT "Item_padrao_por_categoria" CHECK (
    CASE
      WHEN "category" IN (
        'RIFLE', 'PISTOL', 'SMG', 'SNIPER_RIFLE',
        'SHOTGUN', 'MACHINEGUN', 'KNIFE', 'GLOVES'
      )
      THEN "float" IS NOT NULL
        AND "paintSeed" IS NOT NULL
        AND "paintIndex" IS NOT NULL
        AND "defIndex" IS NOT NULL
      ELSE TRUE
    END
  );

-- Float e um desgaste normalizado: fora de [0,1] indica dado corrompido na
-- leitura do inspect link.
ALTER TABLE "Item"
  ADD CONSTRAINT "Item_float_intervalo" CHECK (
    "float" IS NULL OR ("float" >= 0 AND "float" <= 1)
  );
