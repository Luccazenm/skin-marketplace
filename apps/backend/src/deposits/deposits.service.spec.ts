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
    marketHashName: `AK-47 | Teste ${assetId}`,
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

  const inventoryMock = {
    getInventory: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      // AuditService entra de verdade: registrar a recusa é parte do
      // comportamento esperado, não um detalhe que pode ser mockado.
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
    await limpar(prisma, STEAM_ID, BOT_STEAM_ID);

    user = await prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Depositante', tradeUrl: TRADE_URL },
    });

    const bot = await prisma.bot.create({
      data: {
        steamId: BOT_STEAM_ID,
        username: 'bot-teste',
        credentialRef: 'cofre/bot-teste',
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
    await limpar(prisma, STEAM_ID, BOT_STEAM_ID);
    await prisma.$disconnect();
  });

  it('enfileira a oferta com os assetIds pedidos', async () => {
    const oferta = await service.requestDeposit(user, ['111', '222']);

    expect(oferta.status).toBe(TradeOfferStatus.CREATED);
    expect(oferta.requestedAssetIds.sort()).toEqual(['111', '222']);
    expect(oferta.botId).toBe(botId);
    // Cópia da trade URL: a do usuário pode mudar antes do worker rodar
    expect(oferta.tradeUrl).toBe(TRADE_URL);
  });

  it('recusa quem não cadastrou trade URL', async () => {
    const semUrl = await prisma.user.update({
      where: { id: user.id },
      data: { tradeUrl: null },
    });

    await expect(service.requestDeposit(semUrl, ['111'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa item que não está no inventário do usuário', async () => {
    await expect(service.requestDeposit(user, ['999'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa item bloqueado para depósito', async () => {
    await expect(service.requestDeposit(user, ['333'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa seleção com itens repetidos', async () => {
    await expect(service.requestDeposit(user, ['111', '111'])).rejects.toThrow(
      BadRequestException,
    );
  });

  // Clique duplo ou formulário reenviado não pode gerar duas ofertas para
  // o mesmo item.
  it('recusa item que já está numa troca em aberto', async () => {
    await service.requestDeposit(user, ['111']);

    await expect(service.requestDeposit(user, ['111', '222'])).rejects.toThrow(
      ConflictException,
    );
  });

  it('libera o item de novo se a troca anterior falhou', async () => {
    const primeira = await service.requestDeposit(user, ['111']);

    await prisma.tradeOffer.update({
      where: { id: primeira.id },
      data: { status: TradeOfferStatus.FAILED },
    });

    const segunda = await service.requestDeposit(user, ['111']);
    expect(segunda.id).not.toBe(primeira.id);
  });

  it('recusa quando a conta Steam está impedida de negociar', async () => {
    const banido = await prisma.user.update({
      where: { id: user.id },
      data: { steamEconomyBan: SteamEconomyBan.BANNED },
    });

    await expect(service.requestDeposit(banido, ['111'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa quando o inventário está privado', async () => {
    inventoryMock.getInventory.mockResolvedValue({ status: 'private' });

    await expect(service.requestDeposit(user, ['111'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('não enfileira quando a Steam está indisponível', async () => {
    inventoryMock.getInventory.mockResolvedValue({ status: 'rate_limited' });

    await expect(service.requestDeposit(user, ['111'])).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  describe('escolha do bot', () => {
    it('recusa quando nenhum bot está em rotação', async () => {
      await prisma.bot.update({
        where: { id: botId },
        data: { status: BotStatus.OFFLINE },
      });

      await expect(service.requestDeposit(user, ['111'])).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    // Bot novo tem trade hold: aceitar depósito nele deixaria o item preso.
    it('recusa bot ainda em trade hold', async () => {
      await prisma.bot.update({
        where: { id: botId },
        data: { tradeHoldUntil: new Date(Date.now() + 3 * 86_400_000) },
      });

      await expect(service.requestDeposit(user, ['111'])).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('recusa quando não há espaço para a quantidade pedida', async () => {
      await prisma.bot.update({ where: { id: botId }, data: { maxItems: 1 } });

      await expect(
        service.requestDeposit(user, ['111', '222']),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});

async function limpar(prisma: PrismaService, ...steamIds: string[]) {
  await prisma.tradeOffer.deleteMany({
    where: { user: { steamId: { in: steamIds } } },
  });
  await prisma.user.deleteMany({ where: { steamId: { in: steamIds } } });
  await prisma.bot.deleteMany({ where: { steamId: { in: steamIds } } });
}
