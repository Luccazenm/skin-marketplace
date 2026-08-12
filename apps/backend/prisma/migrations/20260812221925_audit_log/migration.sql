-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'BOT', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_outcome_createdAt_idx" ON "AuditLog"("outcome", "createdAt");

-- ---------------------------------------------------------------------------
-- Escrito a mao: o Prisma nao gera triggers.
-- Se este bloco sumir numa migration futura, foi apagado por engano.
-- ---------------------------------------------------------------------------

-- A auditoria so vale como prova se ninguem puder reescreve-la depois.
-- Garantir isso apenas no codigo nao basta: um bug, um script de correcao
-- ou um UPDATE manual no psql passariam por cima. O banco recusa.
--
-- Consequencia intencional: corrigir um registro errado e impossivel. O
-- certo e inserir um novo registro descrevendo a correcao — pelo mesmo
-- motivo que a Transaction e append-only.
CREATE OR REPLACE FUNCTION audit_log_somente_insercao()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog e imutavel: % nao e permitido. Para corrigir, insira um novo registro.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_sem_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_somente_insercao();

CREATE TRIGGER audit_log_sem_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_somente_insercao();
