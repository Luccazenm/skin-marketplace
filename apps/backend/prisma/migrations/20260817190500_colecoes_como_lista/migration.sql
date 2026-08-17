-- Escrita à mão para PRESERVAR os dados: `prisma migrate dev` derrubaria
-- a coluna e perderia as 31.115 origens já importadas.
--
-- Motivo da mudança: um quarto do catálogo sai de MAIS DE UMA origem.
-- Karambit | Doppler vem da Chroma, Chroma 2 e Chroma 3; Sport Gloves |
-- Pandora's Box vem da Glove Case e da Operation Hydra Case. Com uma
-- coluna só, a última processada apagava as outras — por acidente de
-- ordem de iteração, não por escolha.
--
-- Isso importa além da exibição: skin que cai de três caixas tem oferta
-- muito maior que uma exclusiva, e oferta é entrada do buyoutEligible.

ALTER TABLE "SkinTemplate"
  ADD COLUMN "collections" TEXT[] NOT NULL DEFAULT '{}';

-- Aproveita o que já foi importado: cada origem única vira o primeiro
-- item da lista. A próxima sincronização completa o resto.
UPDATE "SkinTemplate"
  SET "collections" = ARRAY["collection"]
  WHERE "collection" IS NOT NULL;

DROP INDEX IF EXISTS "SkinTemplate_collection_idx";

ALTER TABLE "SkinTemplate" DROP COLUMN "collection";

-- GIN: índice comum não serve para "contém este valor" em coluna de
-- lista, e é exatamente essa a consulta da vitrine ("tudo que sai da
-- Chroma 2").
CREATE INDEX "SkinTemplate_collections_idx"
  ON "SkinTemplate" USING GIN ("collections");
