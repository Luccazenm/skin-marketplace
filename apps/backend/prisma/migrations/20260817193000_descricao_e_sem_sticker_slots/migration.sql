-- Escrita à mão: `prisma migrate dev` exige confirmação interativa ao
-- derrubar coluna, e o ambiente aqui não é interativo.

-- A descrição é do MODELO: toda AK Redline tem a mesma. O que varia de
-- um exemplar para outro — float, padrão, adesivos — vive em Item.
ALTER TABLE "SkinTemplate" ADD COLUMN "description" TEXT;

-- Separada da descrição porque é sabor, não informação. A vitrine pode
-- querer destacar ou omitir.
ALTER TABLE "SkinTemplate" ADD COLUMN "flavorText" TEXT;

-- Removido: era derivável da categoria e nunca foi preenchido, então
-- lia `false` para as 33.950 linhas — inclusive para toda arma, que
-- aceita adesivo. Coluna que duplica informação de outra é coluna que
-- diverge; virou `aceitaAdesivo(categoria)`, função pura e testada, em
-- src/inventory/item-category.ts.
--
-- O catálogo descreve o MODELO. Quais adesivos estão aplicados, e com
-- que raspagem, é do exemplar: enumerar combinações aqui seria explosão
-- combinatória, e o mercado nem cota combinação — cota a skin base e
-- cada adesivo em separado.
ALTER TABLE "SkinTemplate" DROP COLUMN "hasStickerSlots";
