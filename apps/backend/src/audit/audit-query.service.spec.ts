import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditActorType, AuditOutcome, type User } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { clearAuditLog } from '../test-utils/clear-audit-log';
import { AuditQueryService } from './audit-query.service';
import { AUDIT_ACTIONS, AuditService } from './audit.service';

/**
 * Querying is what makes the audit trail useful: a record nobody can read
 * settles no complaint.
 */
describe('AuditQueryService', () => {
  let query: AuditQueryService;
  let audit: AuditService;
  let prisma: PrismaService;

  const STEAM_ID = '76561199000000200';
  const OTHER_STEAM_ID = '76561199000000201';
  const ALL = [STEAM_ID, OTHER_STEAM_ID];

  let user: User;
  let other: User;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [AuditQueryService, AuditService, PrismaService],
    }).compile();

    query = moduleRef.get(AuditQueryService);
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup(prisma, ALL);

    user = await prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Complainant' },
    });
    other = await prisma.user.create({
      data: { steamId: OTHER_STEAM_ID, username: 'Third Party' },
    });
  });

  afterAll(async () => {
    await cleanup(prisma, ALL);
    await prisma.$disconnect();
  });

  describe('timelineFor', () => {
    it('finds by steamId, which is what the user provides', async () => {
      const r = await query.timelineFor(STEAM_ID);

      expect(r).not.toBeNull();
      expect(r!.user.id).toBe(user.id);
    });

    it('finds by the internal id too', async () => {
      const r = await query.timelineFor(user.id);

      expect(r!.user.steamId).toBe(STEAM_ID);
    });

    it('returns null for an unknown identifier', async () => {
      await expect(query.timelineFor('does-not-exist')).resolves.toBeNull();
    });

    it('lists events from newest to oldest', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
        outcome: AuditOutcome.SUCCESS,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.events).toHaveLength(2);
      expect(r!.events[0].action).toBe('user.trade_url.updated');
    });

    // Without this, the timeline of whoever is complaining would arrive
    // mixed with everyone else's.
    it('does not bring events from another user', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: other.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.events).toHaveLength(0);
    });

    // An administrative action on the account has a different actor: it
    // would only appear through the target, and it is exactly the kind of
    // event that matters in a dispute.
    it('brings events where the person is the target, not the author', async () => {
      await audit.record({
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: 'admin.adjustment',
        outcome: AuditOutcome.SUCCESS,
        targetType: 'User',
        targetId: user.id,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.events).toHaveLength(1);
      expect(r!.events[0].action).toBe('admin.adjustment');
    });

    it('respects the limit and reports how many were left out', async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({
          actorType: AuditActorType.USER,
          actorId: user.id,
          action: AUDIT_ACTIONS.LOGIN,
          outcome: AuditOutcome.SUCCESS,
        });
      }

      const r = await query.timelineFor(STEAM_ID, { limit: 2 });

      expect(r!.events).toHaveLength(2);
      expect(r!.omitted).toBe(3);
    });

    it('filters by period', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const future = new Date(Date.now() + 60_000);
      const r = await query.timelineFor(STEAM_ID, { since: future });

      expect(r!.events).toHaveLength(0);
    });
  });

  describe('suspiciousActivity', () => {
    const refuse = (u: User, action: string, ip = '203.0.113.9') =>
      audit.record({
        actorType: AuditActorType.USER,
        actorId: u.id,
        action,
        outcome: AuditOutcome.DENIED,
        context: { ip },
      });

    it('ignores someone with few refusals', async () => {
      await refuse(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED);

      const r = await query.suspiciousActivity({ minimumRefusals: 3 });

      expect(r.find((s) => s.steamId === STEAM_ID)).toBeUndefined();
    });

    // The pattern that justifies recording refusals: someone probing the
    // system.
    it('flags someone who repeats refusals', async () => {
      for (let i = 0; i < 4; i++) {
        await refuse(user, AUDIT_ACTIONS.TRADE_URL_UPDATED);
      }

      const r = await query.suspiciousActivity({ minimumRefusals: 3 });
      const found = r.find((s) => s.steamId === STEAM_ID);

      expect(found).toBeDefined();
      expect(found!.refusals).toBe(4);
      expect(found!.reasons[0]).toEqual({
        action: 'user.trade_url.updated',
        times: 4,
      });
    });

    it('does not count a successful operation', async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({
          actorType: AuditActorType.USER,
          actorId: user.id,
          action: AUDIT_ACTIONS.LOGIN,
          outcome: AuditOutcome.SUCCESS,
        });
      }

      const r = await query.suspiciousActivity({ minimumRefusals: 3 });

      expect(r.find((s) => s.steamId === STEAM_ID)).toBeUndefined();
    });

    it('gathers the IPs used', async () => {
      await refuse(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.1');
      await refuse(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.2');
      await refuse(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.1');

      const r = await query.suspiciousActivity({ minimumRefusals: 3 });
      const found = r.find((s) => s.steamId === STEAM_ID)!;

      expect(found.ips.sort()).toEqual(['203.0.113.1', '203.0.113.2']);
    });

    it('orders from most refused to least', async () => {
      for (let i = 0; i < 3; i++) await refuse(other, 'x.y');
      for (let i = 0; i < 6; i++) await refuse(user, 'x.y');

      const r = await query.suspiciousActivity({ minimumRefusals: 3 });

      // Compares the relative positions of this test's two actors, not
      // who is first in the global list.
      //
      // The query scans the whole table over the last 7 days: refusals
      // accumulated from earlier runs — including anonymous ones, which
      // group by IP — can take the top. Asserting `r[0]` made the test
      // pass for a while and break on its own after a few runs.
      const userPos = r.findIndex((s) => s.steamId === STEAM_ID);
      const otherPos = r.findIndex((s) => s.steamId === OTHER_STEAM_ID);

      expect(userPos).toBeGreaterThanOrEqual(0);
      expect(otherPos).toBeGreaterThan(userPos);
    });

    it('respects the period', async () => {
      for (let i = 0; i < 4; i++) await refuse(user, 'x.y');

      const r = await query.suspiciousActivity({
        since: new Date(Date.now() + 60_000),
        minimumRefusals: 3,
      });

      expect(r).toHaveLength(0);
    });
  });

  describe('findByAssetId', () => {
    it('finds the record by the assetId inside the metadata', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          items: [{ assetId: '44556677', name: 'AK-47 | Redline' }],
        },
      });

      const r = await query.findByAssetId('44556677');

      expect(r).toHaveLength(1);
      expect(r[0].action).toBe('deposit.requested');
    });

    it('finds it in the refusal shape too, which only carries ids', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
        outcome: AuditOutcome.DENIED,
        metadata: { reason: 'item_not_depositable', assetIds: ['99887766'] },
      });

      const r = await query.findByAssetId('99887766');

      expect(r).toHaveLength(1);
      expect(r[0].outcome).toBe(AuditOutcome.DENIED);
    });

    it('returns nothing for an assetId with no record', async () => {
      await expect(query.findByAssetId('12312312312')).resolves.toHaveLength(0);
    });

    // Regression: the first version compared the whole JSON as text, and
    // "00000000" matched steamIds like 76561199000000002.
    it('does not match a fragment of another identifier', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
        metadata: { steamId: '76561199000000002' },
      });

      await expect(query.findByAssetId('00000000')).resolves.toHaveLength(0);
    });
  });
});

async function cleanup(prisma: PrismaService, steamIds: string[]) {
  await clearAuditLog(prisma);
  await prisma.user.deleteMany({ where: { steamId: { in: steamIds } } });
}
