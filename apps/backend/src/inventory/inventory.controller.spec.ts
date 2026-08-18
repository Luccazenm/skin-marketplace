import { ItemCategory, type User } from '@prisma/client';
import request from 'supertest';
import {
  corpo,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import type { InventoryItem } from './steam-inventory.service';

/**
 * Cada falha da Steam vira um status diferente de propósito: as ações que
 * o usuário pode tomar são diferentes. Inventário privado ele resolve
 * sozinho; limite atingido é esperar; Steam fora do ar é tentar depois.
 */
interface Resumo {
  count: number;
  total: number;
  blocked: number;
  cached: boolean;
}

describe('InventoryController', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561199000000110';
  const http = () => request(ctx.server);

  const item = (assetId: string, depositable = true): InventoryItem => ({
    assetId,
    classId: '1',
    instanceId: '0',
    marketHashName: depositable ? 'AK-47 | Redline' : 'Service Medal',
    iconUrl: null,
    category: depositable ? ItemCategory.RIFLE : ItemCategory.COLLECTIBLE,
    tradable: depositable,
    marketable: true,
    depositable,
    blockReason: depositable ? null : 'permanent',
    hasUniquePattern: depositable,
    applied: [],
    rarity: null,
    exterior: null,
    typeLabel: null,
    float: depositable ? 0.18 : null,
    paintSeed: depositable ? 42 : null,
    inspectLink: null,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: STEAM_ID } });
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Dono' },
    });

    // Cada teste parte de cache limpo, senão o resultado depende da ordem
    await ctx.redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot',
      'steam:inventory:bloqueado',
    );
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: STEAM_ID } });
    await ctx.redis.del(`inventory:${STEAM_ID}`);
    await ctx.close();
  });

  it('exige sessão', async () => {
    await http().get('/api/inventory').expect(401);
  });

  it('devolve os itens com o resumo', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1'), item('2'), item('3', false)],
    });

    const r = await http()
      .get('/api/inventory')
      .set(ctx.authFor(user))
      .expect(200);

    const inv = corpo<Resumo>(r);

    expect(inv.count).toBe(3);
    expect(inv.total).toBe(3);
    expect(inv.blocked).toBe(1);
    expect(inv.cached).toBe(false);
  });

  it('filtra por depositável mantendo o total', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1'), item('2'), item('3', false)],
    });

    const r = await http()
      .get('/api/inventory?depositable=true')
      .set(ctx.authFor(user))
      .expect(200);

    const inv = corpo<Resumo>(r);

    expect(inv.count).toBe(2);
    // total e blocked continuam completos: é o que permite a tela avisar
    // que há itens escondidos, em vez de eles sumirem sem explicação.
    expect(inv.total).toBe(3);
    expect(inv.blocked).toBe(1);
  });

  it('recusa valor inválido no filtro', async () => {
    await http()
      .get('/api/inventory?depositable=talvez')
      .set(ctx.authFor(user))
      .expect(400);
  });

  it('recusa parâmetro desconhecido', async () => {
    await http()
      .get('/api/inventory?xpto=1')
      .set(ctx.authFor(user))
      .expect(400);
  });

  describe('falhas da Steam', () => {
    it('inventário privado devolve 403 com instrução', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'private',
      });

      const r = await http()
        .get('/api/inventory')
        .set(ctx.authFor(user))
        .expect(403);

      // A pessoa consegue resolver sozinha �?" a mensagem diz onde.
      expect(corpo<{ message: string }>(r).message).toContain('Privacidade');
    });

    it('limite da Steam devolve 429', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'rate_limited',
      });

      await http().get('/api/inventory').set(ctx.authFor(user)).expect(429);
    });

    it('Steam indisponível devolve 502', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'error',
        message: 'timeout',
      });

      await http().get('/api/inventory').set(ctx.authFor(user)).expect(502);
    });
  });

  it('não consulta a Steam duas vezes seguidas', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1')],
    });

    await http().get('/api/inventory').set(ctx.authFor(user)).expect(200);
    const r = await http()
      .get('/api/inventory')
      .set(ctx.authFor(user))
      .expect(200);

    expect(ctx.steam.inventory.fetchInventory).toHaveBeenCalledTimes(1);
    expect(corpo<Resumo>(r).cached).toBe(true);
  });
});
