import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  BotStatus,
  ItemCategory,
  SteamEconomyBan,
  TradeOfferStatus,
  type User,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { validateEnv } from '../config/env.validation';
import { InventoryService } from '../inventory/inventory.service';
import type { InventoryItem } from '../inventory/steam-inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { clearAuditLog } from '../test-utils/clear-audit-log';
import { DepositsService } from './deposits.service';

describe('DepositsService.requestDeposit', () => {
  let service: DepositsService;
  let prisma: PrismaService;

  const STEAM_ID = '76561199000000060';
  const BOT_STEAM_ID = '76561199000000061';
  const TRADE_URL =
    'https://steamcommunity.com/tradeoffer/new/?partner=1039734332&token=Ab3xY9zQ';

  let user: User;
  let botId: string;

  const item = (assetId: string, depositable = true): InventoryItem => ({
    assetId,
    classId: '1',
    instanceId: '0',
    marketHashName: `AK-47 | Test ${assetId}`,
    iconUrl: null,
    category: ItemCategory.RIFLE,
    tradable: depositable,
    marketable: true,
    depositable,
    blockReason: depositable ? null : 'unavailable',
    hasUniquePattern: true,
    applied: [],
    rarity: null,
    exterior: null,
    typeLabel: null,
    float: 0.31,
    paintSeed: 7,
    inspectLink: null,
  });

  /**
   * A deposit request from a list of assetIds, at a nominal price.
   *
   * Most of these tests are about the rules around the items — ownership,
   * trade locks, bot capacity — and not about the price, so it stays out
   * of the way. The tests that ARE about the price pass it explicitly.
   */
  const sell = (...assetIds: string[]) =>
    assetIds.map((assetId) => ({ assetId, price: '10.00' }));

  const inventoryMock = {
    getInventory: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      // AuditService goes in for real: recording the refusal is part of
      // the expected behaviour, not a detail that can be mocked away.
      providers: [DepositsService, PrismaService, AuditService],
    })
      .useMocker((token) =>
        token === InventoryService ? inventoryMock : undefined,
      )
      .compile();

    service = moduleRef.get(DepositsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanUp(prisma, STEAM_ID, BOT_STEAM_ID);

    user = await prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Depositor', tradeUrl: TRADE_URL },
    });

    const bot = await prisma.bot.create({
      data: {
        steamId: BOT_STEAM_ID,
        username: 'test-bot',
        credentialRef: 'vault/test-bot',
        status: BotStatus.ONLINE,
      },
    });
    botId = bot.id;

    inventoryMock.getInventory.mockResolvedValue({
      status: 'ok',
      items: [item('111'), item('222'), item('333', false)],
      fetchedAt: new Date(),
      cached: false,
      stale: false,
    });
  });

  afterAll(async () => {
    await cleanUp(prisma, STEAM_ID, BOT_STEAM_ID);
    await prisma.$disconnect();
  });

  it('queues the offer with the requested assetIds', async () => {
    const offer = await service.requestDeposit(user, sell('111', '222'));

    expect(offer.status).toBe(TradeOfferStatus.CREATED);
    expect(offer.requestedAssetIds.sort()).toEqual(['111', '222']);
    expect(offer.botId).toBe(botId);
    // A copy of the trade URL: the user's own can change before the
    // worker runs
    expect(offer.tradeUrl).toBe(TRADE_URL);
  });

  // Selling is one step for the user and two for us. The price is chosen
  // before the Item exists, so it has to survive until the bot receives —
  // otherwise the person would be asked for it again after a trade they
  // already accepted.
  describe('the seller price', () => {
    it('is stored per item, alongside the offer', async () => {
      const offer = await service.requestDeposit(user, [
        { assetId: '111', price: '42.50' },
        { assetId: '222', price: '1350.00' },
      ]);

      const intended = await prisma.intendedListing.findMany({
        where: { tradeOfferId: offer.id },
        orderBy: { assetId: 'asc' },
      });

      expect(intended.map((i) => [i.assetId, i.price.toString()])).toEqual([
        ['111', '42.5'],
        ['222', '1350'],
      ]);
    });

    // Nothing half-written: an offer whose prices did not land would
    // leave the worker with items to receive and no price to list them
    // at, discovered days later when the user accepts the trade.
    it('leaves no offer behind when the deposit is refused', async () => {
      await expect(
        service.requestDeposit(user, [{ assetId: '999', price: '10.00' }]),
      ).rejects.toThrow(BadRequestException);

      expect(
        await prisma.intendedListing.count({
          where: { tradeOffer: { userId: user.id } },
        }),
      ).toBe(0);
      expect(
        await prisma.tradeOffer.count({ where: { userId: user.id } }),
      ).toBe(0);
    });

    it('reaches the audit trail with the item name', async () => {
      await service.requestDeposit(user, [{ assetId: '111', price: '42.50' }]);

      const [log] = await prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'deposit.requested' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(log.metadata).toMatchObject({
        items: [{ assetId: '111', name: 'AK-47 | Test 111', price: '42.50' }],
      });
    });
  });

  it('refuses someone who has not registered a trade URL', async () => {
    const withoutUrl = await prisma.user.update({
      where: { id: user.id },
      data: { tradeUrl: null },
    });

    await expect(
      service.requestDeposit(withoutUrl, sell('111')),
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses an item that is not in the user's inventory", async () => {
    await expect(service.requestDeposit(user, sell('999'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses an item blocked from being deposited', async () => {
    await expect(service.requestDeposit(user, sell('333'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a selection with repeated items', async () => {
    await expect(
      service.requestDeposit(user, sell('111', '111')),
    ).rejects.toThrow(BadRequestException);
  });

  // A double click or a resubmitted form must not produce two offers for
  // the same item.
  it('refuses an item that is already in an open trade', async () => {
    await service.requestDeposit(user, sell('111'));

    await expect(
      service.requestDeposit(user, sell('111', '222')),
    ).rejects.toThrow(ConflictException);
  });

  it('frees the item again if the previous trade failed', async () => {
    const first = await service.requestDeposit(user, sell('111'));

    await prisma.tradeOffer.update({
      where: { id: first.id },
      data: { status: TradeOfferStatus.FAILED },
    });

    const second = await service.requestDeposit(user, sell('111'));
    expect(second.id).not.toBe(first.id);
  });

  it('refuses when the Steam account is barred from trading', async () => {
    const banned = await prisma.user.update({
      where: { id: user.id },
      data: { steamEconomyBan: SteamEconomyBan.BANNED },
    });

    await expect(service.requestDeposit(banned, sell('111'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses when the inventory is private', async () => {
    inventoryMock.getInventory.mockResolvedValue({ status: 'private' });

    await expect(service.requestDeposit(user, sell('111'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('does not queue anything when Steam is unavailable', async () => {
    inventoryMock.getInventory.mockResolvedValue({ status: 'rate_limited' });

    await expect(service.requestDeposit(user, sell('111'))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  describe('picking the bot', () => {
    it('refuses when no bot is in rotation', async () => {
      await prisma.bot.update({
        where: { id: botId },
        data: { status: BotStatus.OFFLINE },
      });

      await expect(service.requestDeposit(user, sell('111'))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    // A new bot has a trade hold: accepting a deposit into it would
    // leave the item stuck.
    it('refuses a bot still under a trade hold', async () => {
      await prisma.bot.update({
        where: { id: botId },
        data: { tradeHoldUntil: new Date(Date.now() + 3 * 86_400_000) },
      });

      await expect(service.requestDeposit(user, sell('111'))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuses when there is no room for the requested quantity', async () => {
      await prisma.bot.update({ where: { id: botId }, data: { maxItems: 1 } });

      await expect(
        service.requestDeposit(user, sell('111', '222')),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});

async function cleanUp(prisma: PrismaService, ...steamIds: string[]) {
  // AuditLog is immutable by a Postgres trigger, so it cannot be
  // DELETEd — clearAuditLog uses TRUNCATE, which a row trigger does not
  // see, leaving the protection on throughout. See CLAUDE.md.
  await clearAuditLog(prisma);
  await prisma.tradeOffer.deleteMany({
    where: { user: { steamId: { in: steamIds } } },
  });
  await prisma.user.deleteMany({ where: { steamId: { in: steamIds } } });
  await prisma.bot.deleteMany({ where: { steamId: { in: steamIds } } });
}
