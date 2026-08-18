import { BotStatus, ItemCategory, type User } from '@prisma/client';
import request from 'supertest';
import {
  corpo,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import { limparAuditoria } from '../test-utils/limpar-auditoria';
import type { InventoryItem } from '../inventory/steam-inventory.service';

describe('DepositsController', () => {
  let ctx: TestApp;
  let user: User;
  let botId: string;

  // steamId exclusivo desta suíte: reaproveitar o de outro spec faz uma
  // apagar o usuário da outra quando rodam juntas.
  const STEAM_ID = '76561199000000130';
  const BOT_STEAM_ID = '76561199000000131';
  // partner = steamId - 76561197960265728
  const TRADE_URL =
    'https://steamcommunity.com/tradeoffer/new/?partner=1039734402&token=Ab3xY9zQ';

  const http = () => request(ctx.server);

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
    blockReason: depositable ? null : 'permanente',
    hasUniquePattern: true,
    applied: [],
    rarity: null,
    exterior: null,
    typeLabel: null,
    float: 0.44,
    paintSeed: 123,
    inspectLink: null,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await limpar(ctx, STEAM_ID, BOT_STEAM_ID);

    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Depositante', tradeUrl: TRADE_URL },
    });

    const bot = await ctx.prisma.bot.create({
      data: {
        steamId: BOT_STEAM_ID,
        username: 'bot-http-teste',
        credentialRef: 'cofre/bot-http-teste',
        status: BotStatus.ONLINE,
      },
    });
    botId = bot.id;

    await ctx.redis.del(`inventory:${STEAM_ID}`, 'steam:inventory:slot');

    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('111'), item('222'), item('333', false)],
    });
    jest.clearAllMocks();
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('111'), item('222'), item('333', false)],
    });
  });

  afterAll(async () => {
    await limpar(ctx, STEAM_ID, BOT_STEAM_ID);
    await ctx.redis.del(`inventory:${STEAM_ID}`);
    await ctx.close();
  });

  it('exige sessão', async () => {
    await http()
      .post('/api/deposits')
      .send({ assetIds: ['111'] })
      .expect(401);
  });

  it('enfileira o depósito', async () => {
    const r = await http()
      .post('/api/deposits')
      .set(ctx.authFor(user))
      .send({ assetIds: ['111', '222'] })
      .expect(201);

    const criado = corpo<{ id: string; status: string; itemCount: number }>(r);

    expect(criado.status).toBe('CREATED');
    expect(criado.itemCount).toBe(2);

    const oferta = await ctx.prisma.tradeOffer.findUnique({
      where: { id: criado.id },
    });
    expect(oferta!.botId).toBe(botId);
  });

  describe('validação de entrada', () => {
    it('recusa lista vazia', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: [] })
        .expect(400);
    });

    it('recusa assetId que não é número', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['../../etc/passwd'] })
        .expect(400);
    });

    it('recusa campo desconhecido', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['111'], botId: 'escolhido-por-mim' })
        .expect(400);
    });

    // Teto para não montar oferta que a Steam recusaria por tamanho.
    it('recusa seleção acima do limite', async () => {
      const muitos = Array.from({ length: 101 }, (_, i) => String(i));

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: muitos })
        .expect(400);
    });
  });

  describe('regras de negócio viram o status certo', () => {
    it('sem trade URL devolve 400', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { tradeUrl: null },
      });

      const r = await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['111'] })
        .expect(400);

      expect(corpo<{ message: string }>(r).message).toContain('trade URL');
    });

    it('item bloqueado devolve 400 nomeando o item', async () => {
      const r = await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['333'] })
        .expect(400);

      expect(corpo<{ message: string }>(r).message).toContain(
        'AK-47 | Teste 333',
      );
    });

    // 409 e não 400: o pedido está correto, o estado é que impede.
    it('item já em outra troca devolve 409', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['111'] })
        .expect(201);

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['111'] })
        .expect(409);
    });

    // 503 e não 500: não é erro, é indisponibilidade temporária �?" e a
    // diferença muda se o cliente deve tentar de novo.
    it('sem bot em rotação devolve 503', async () => {
      await ctx.prisma.bot.update({
        where: { id: botId },
        data: { status: BotStatus.OFFLINE },
      });

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ assetIds: ['111'] })
        .expect(503);
    });
  });

  it('registra o depósito na auditoria com o nome dos itens', async () => {
    await http()
      .post('/api/deposits')
      .set(ctx.authFor(user))
      .send({ assetIds: ['111'] })
      .expect(201);

    const [log] = await ctx.prisma.auditLog.findMany({
      where: { actorId: user.id, action: 'deposit.requested' },
    });

    expect(log.outcome).toBe('SUCCESS');
    expect(log.metadata).toMatchObject({
      botSteamId: BOT_STEAM_ID,
      itens: [{ assetId: '111', nome: 'AK-47 | Teste 111' }],
    });
  });
});

async function limpar(ctx: TestApp, steamId: string, botSteamId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { steamId } });

  if (user) {
    await ctx.prisma.tradeOffer.deleteMany({ where: { userId: user.id } });
    await limparAuditoria(ctx.prisma);
    await ctx.prisma.user.delete({ where: { id: user.id } });
  }

  await ctx.prisma.bot.deleteMany({ where: { steamId: botSteamId } });
}
