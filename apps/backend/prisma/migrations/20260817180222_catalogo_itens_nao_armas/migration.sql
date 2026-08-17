-- AlterTable
ALTER TABLE "SkinTemplate" ADD COLUMN     "category" "ItemCategory" NOT NULL DEFAULT 'OTHER',
ALTER COLUMN "weapon" DROP NOT NULL,
ALTER COLUMN "skinName" DROP NOT NULL,
ALTER COLUMN "minFloat" DROP NOT NULL,
ALTER COLUMN "minFloat" DROP DEFAULT,
ALTER COLUMN "maxFloat" DROP NOT NULL,
ALTER COLUMN "maxFloat" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "SkinTemplate_category_idx" ON "SkinTemplate"("category");

-- CreateIndex
CREATE INDEX "SkinTemplate_collection_idx" ON "SkinTemplate"("collection");

-- CreateIndex
CREATE INDEX "SkinTemplate_weapon_idx" ON "SkinTemplate"("weapon");

-- ============================================================
-- Escritos à mão. O Prisma NÃO gera CHECK constraints: se estes
-- blocos sumirem numa migration futura, foi apagado por engano.
-- ============================================================

-- Tornar weapon e skinName opcionais foi o que permitiu adesivo, cápsula
-- e agente entrarem no catálogo. O risco é o oposto: arma entrar SEM
-- padrão, e aí ninguém consegue dizer se um float é bom, nem agrupar a
-- vitrine por arma. O banco recusa.
ALTER TABLE "SkinTemplate"
  ADD CONSTRAINT "skintemplate_arma_exige_padrao"
  CHECK (
    "category" NOT IN (
      'RIFLE', 'PISTOL', 'SMG', 'SNIPER_RIFLE', 'SHOTGUN',
      'MACHINEGUN', 'KNIFE', 'GLOVES'
    )
    OR (
      "weapon" IS NOT NULL
      AND "skinName" IS NOT NULL
      AND "minFloat" IS NOT NULL
      AND "maxFloat" IS NOT NULL
    )
  );

-- Faixa coerente e dentro do domínio do jogo. Float invertido passaria
-- despercebido e faria toda skin parecer fora da faixa.
ALTER TABLE "SkinTemplate"
  ADD CONSTRAINT "skintemplate_faixa_de_float_valida"
  CHECK (
    ("minFloat" IS NULL AND "maxFloat" IS NULL)
    OR (
      "minFloat" >= 0 AND "maxFloat" <= 1 AND "minFloat" < "maxFloat"
    )
  );
