import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditActorType, AuditOutcome } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS, AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  const ATOR = 'ator-teste-auditoria';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [AuditService, PrismaService],
    }).compile();

    service = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterEach(async () => {
    // Só dá para apagar por SQL cru: o trigger recusa DELETE pelo ORM, o
    // que é justamente o comportamento que queremos em produção.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_sem_delete',
    );
    await prisma.auditLog.deleteMany({ where: { actorId: ATOR } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_sem_delete',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('grava um fato com contexto de rede', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ATOR,
      action: AUDIT_ACTIONS.LOGIN,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: ATOR,
      context: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 teste' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ATOR } });

    expect(log.action).toBe('auth.login');
    expect(log.outcome).toBe(AuditOutcome.SUCCESS);
    expect(log.ip).toBe('203.0.113.7');
    expect(log.userAgent).toBe('Mozilla/5.0 teste');
  });

  // O antes e depois é o que resolve disputa sobre entrega em conta errada.
  it('guarda o antes e o depois de uma alteração', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ATOR,
      action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { de: 'url-antiga', para: 'url-nova' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ATOR } });

    expect(log.metadata).toEqual({ de: 'url-antiga', para: 'url-nova' });
  });

  it('registra tentativa recusada', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ATOR,
      action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
      outcome: AuditOutcome.DENIED,
      metadata: { motivo: 'sem_trade_url' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ATOR } });

    expect(log.outcome).toBe(AuditOutcome.DENIED);
  });

  // Auditar não pode ser motivo para alguém não conseguir usar o site.
  it('não propaga erro de gravação', async () => {
    await expect(
      service.record({
        actorType: AuditActorType.USER,
        actorId: ATOR,
        // Excede o limite da coluna: força falha no banco.
        action: 'x'.repeat(100_000),
        outcome: AuditOutcome.SUCCESS,
      }),
    ).resolves.toBeUndefined();
  });

  describe('imutabilidade', () => {
    it('recusa alteração de registro', async () => {
      await service.record({
        actorType: AuditActorType.USER,
        actorId: ATOR,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const [log] = await prisma.auditLog.findMany({ where: { actorId: ATOR } });

      await expect(
        prisma.auditLog.update({
          where: { id: log.id },
          data: { action: 'adulterado' },
        }),
      ).rejects.toThrow();
    });

    it('recusa exclusão de registro', async () => {
      await service.record({
        actorType: AuditActorType.USER,
        actorId: ATOR,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const [log] = await prisma.auditLog.findMany({ where: { actorId: ATOR } });

      await expect(
        prisma.auditLog.delete({ where: { id: log.id } }),
      ).rejects.toThrow();
    });
  });

  describe('recordInTransaction', () => {
    // Para dinheiro, operação sem rastro é pior que operação não feita:
    // o registro precisa cair junto se a transação falhar.
    it('desfaz o registro quando a transação falha', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await service.recordInTransaction(tx, {
            actorType: AuditActorType.USER,
            actorId: ATOR,
            action: 'teste.transacao',
            outcome: AuditOutcome.SUCCESS,
          });

          throw new Error('falha proposital depois de auditar');
        }),
      ).rejects.toThrow('falha proposital');

      const logs = await prisma.auditLog.findMany({ where: { actorId: ATOR } });
      expect(logs).toHaveLength(0);
    });
  });
});
