import type { PrismaService } from '../prisma/prisma.service';

/**
 * Esvazia a auditoria entre testes.
 *
 * Usa TRUNCATE, que **não dispara o trigger de imutabilidade** — ele é
 * `BEFORE DELETE FOR EACH ROW`, e TRUNCATE não passa por linha. Ou seja:
 * a proteção continua ligada o tempo todo.
 *
 * É o que substitui o `ALTER TABLE ... DISABLE TRIGGER` que os testes
 * faziam antes. Aquilo desligava a imutabilidade **da tabela inteira**
 * durante a limpeza: um teste que morresse entre o desligar e o religar
 * deixava a auditoria desprotegida em silêncio, e apontar a suíte para o
 * banco errado desligava a proteção lá.
 *
 * Só é seguro porque o banco de teste é isolado e descartável — a
 * barreira que garante isso está em `test-database.ts`.
 */
export async function limparAuditoria(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"');
}
