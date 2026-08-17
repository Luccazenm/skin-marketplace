-- ============================================================
-- Escritos à mão. O Prisma NÃO gera CHECK constraints: se estes
-- blocos sumirem numa migration futura, foi apagado por engano.
-- ============================================================

-- A constraint anterior exigia skinName e faixa de float de TODA arma, e
-- isso recusou 40 itens legítimos na primeira importação do catálogo:
-- facas e luvas sem pintura ("★ Karambit", "★ StatTrak™ Stiletto Knife").
-- São itens reais, caros e negociáveis — só não têm skin, e portanto não
-- têm desgaste: não existe float em superfície não pintada.
--
-- A regra correta separa as duas coisas:
--   arma        -> precisa de weapon (para agrupar e para a vitrine)
--   arma COM skin -> precisa também da faixa de float (para dizer se o
--                    float do exemplar é bom)
ALTER TABLE "SkinTemplate"
  DROP CONSTRAINT IF EXISTS "skintemplate_arma_exige_padrao";

ALTER TABLE "SkinTemplate"
  ADD CONSTRAINT "skintemplate_arma_exige_modelo"
  CHECK (
    "category" NOT IN (
      'RIFLE', 'PISTOL', 'SMG', 'SNIPER_RIFLE', 'SHOTGUN',
      'MACHINEGUN', 'KNIFE', 'GLOVES'
    )
    OR "weapon" IS NOT NULL
  );

-- Item pintado sem faixa de float passaria despercebido e quebraria
-- exatamente a pergunta que o usuário faz antes de comprar: "este float
-- é bom para esta skin?".
ALTER TABLE "SkinTemplate"
  ADD CONSTRAINT "skintemplate_skin_exige_faixa_de_float"
  CHECK (
    "skinName" IS NULL
    OR ("minFloat" IS NOT NULL AND "maxFloat" IS NOT NULL)
  );
