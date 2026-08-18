import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditActorType, AuditOutcome } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { clearAuditLog } from '../test-utils/clear-audit-log';
import { AUDIT_ACTIONS, AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  const ACTOR = 'audit-test-actor';

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
    await clearAuditLog(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores a fact with its network context', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ACTOR,
      action: AUDIT_ACTIONS.LOGIN,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: ACTOR,
      context: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 test' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ACTOR } });

    expect(log.action).toBe('auth.login');
    expect(log.outcome).toBe(AuditOutcome.SUCCESS);
    expect(log.ip).toBe('203.0.113.7');
    expect(log.userAgent).toBe('Mozilla/5.0 test');
  });

  // Before and after is what settles a dispute over delivery to the wrong
  // account.
  it('keeps the before and after of a change', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ACTOR,
      action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { from: 'old-url', to: 'new-url' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ACTOR } });

    expect(log.metadata).toEqual({ from: 'old-url', to: 'new-url' });
  });

  it('records a refused attempt', async () => {
    await service.record({
      actorType: AuditActorType.USER,
      actorId: ACTOR,
      action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
      outcome: AuditOutcome.DENIED,
      metadata: { reason: 'no_trade_url' },
    });

    const [log] = await prisma.auditLog.findMany({ where: { actorId: ACTOR } });

    expect(log.outcome).toBe(AuditOutcome.DENIED);
  });

  // Auditing cannot be the reason someone fails to use the site.
  it('does not propagate a write failure', async () => {
    await expect(
      service.record({
        actorType: AuditActorType.USER,
        actorId: ACTOR,
        // Exceeds the column limit: forces a database failure.
        action: 'x'.repeat(100_000),
        outcome: AuditOutcome.SUCCESS,
      }),
    ).resolves.toBeUndefined();
  });

  describe('immutability', () => {
    it('refuses to alter a record', async () => {
      await service.record({
        actorType: AuditActorType.USER,
        actorId: ACTOR,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const [log] = await prisma.auditLog.findMany({
        where: { actorId: ACTOR },
      });

      await expect(
        prisma.auditLog.update({
          where: { id: log.id },
          data: { action: 'tampered' },
        }),
      ).rejects.toThrow();
    });

    it('refuses to delete a record', async () => {
      await service.record({
        actorType: AuditActorType.USER,
        actorId: ACTOR,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const [log] = await prisma.auditLog.findMany({
        where: { actorId: ACTOR },
      });

      await expect(
        prisma.auditLog.delete({ where: { id: log.id } }),
      ).rejects.toThrow();
    });
  });

  describe('recordInTransaction', () => {
    // For money, an operation with no trail is worse than an operation
    // that never happened: the record has to fall with the transaction.
    it('rolls the record back when the transaction fails', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await service.recordInTransaction(tx, {
            actorType: AuditActorType.USER,
            actorId: ACTOR,
            action: 'test.transaction',
            outcome: AuditOutcome.SUCCESS,
          });

          throw new Error('deliberate failure after auditing');
        }),
      ).rejects.toThrow('deliberate failure');

      const logs = await prisma.auditLog.findMany({
        where: { actorId: ACTOR },
      });
      expect(logs).toHaveLength(0);
    });
  });
});
