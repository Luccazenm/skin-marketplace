import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ItemCategory } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { InventoryCacheService } from './inventory-cache.service';
import { InventoryService } from './inventory.service';
import {
  SteamInventoryService,
  type InventoryItem,
} from './steam-inventory.service';

/**
 * Roda contra o Redis local (docker compose up -d).
 * A Steam é mockada — o objetivo é testar QUANDO decidimos chamá-la.
 */
describe('InventoryService', () => {
  let service: InventoryService;
  let redis: RedisService;

  const STEAM_ID = '76561199000000050';

  const itemFalso: InventoryItem = {
    assetId: '1',
    classId: '2',
    instanceId: '0',
    marketHashName: 'AK-47 | Redline (Field-Tested)',
    iconUrl: null,
    category: ItemCategory.RIFLE,
    tradable: true,
    marketable: true,
    depositable: true,
    blockReason: null,
    hasUniquePattern: true,
    rarity: 'Classified',
    exterior: 'Field-Tested',
    typeLabel: 'Rifle',
    inspectLink: null,
  };

  const steamMock = {
    fetchInventory: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [InventoryService, InventoryCacheService, RedisService],
    })
      .useMocker((token) =>
        token === SteamInventoryService ? steamMock : undefined,
      )
      .compile();

    service = moduleRef.get(InventoryService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot',
      'steam:inventory:bloqueado',
    );
    steamMock.fetchInventory.mockReset();
  });

  afterAll(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot',
      'steam:inventory:bloqueado',
    );
    await redis.quit();
  });

  it('consulta a Steam quando não há cache', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [itemFalso],
    });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.cached).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);
  });

  // O ponto central da etapa: F5 do usuário não vira chamada à Steam.
  it('não chama a Steam de novo enquanto o cache está fresco', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [itemFalso],
    });

    await service.getInventory(STEAM_ID);
    const segunda = await service.getInventory(STEAM_ID);

    expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);
    expect(segunda.status).toBe('ok');
    if (segunda.status !== 'ok') return;
    expect(segunda.cached).toBe(true);
    expect(segunda.stale).toBe(false);
  });

  it('serve dado velho quando a Steam devolve 429', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [itemFalso],
    });
    await service.getInventory(STEAM_ID);

    // Envelhece o cache e libera o slot para forçar nova tentativa
    await envelhecerCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
    expect(r.items).toHaveLength(1);

    // E marcou o castigo, para os próximos nem tentarem
    expect(await redis.exists('steam:inventory:bloqueado')).toBe(1);
  });

  it('recusa quando bate no limite sem ter nada em cache', async () => {
    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('rate_limited');
  });

  it('não chama a Steam durante o castigo', async () => {
    await redis.set('steam:inventory:bloqueado', '1', 'EX', 60);

    await service.getInventory(STEAM_ID);

    expect(steamMock.fetchInventory).not.toHaveBeenCalled();
  });

  it('serve dado velho quando a Steam falha por outro motivo', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [itemFalso],
    });
    await service.getInventory(STEAM_ID);

    await envelhecerCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({
      status: 'error',
      message: 'timeout',
    });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
  });

  // Privacidade: se a pessoa fechou o perfil, não podemos continuar
  // mostrando o que ela decidiu esconder.
  it('NÃO serve cache quando o inventário virou privado', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [itemFalso],
    });
    await service.getInventory(STEAM_ID);

    await envelhecerCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({ status: 'private' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('private');
  });
});

/** Reescreve a entrada do cache com data antiga, para ficar stale. */
async function envelhecerCache(redis: RedisService, steamId: string) {
  const cru = await redis.get(`inventory:${steamId}`);
  const entrada = JSON.parse(cru!) as { items: unknown[]; fetchedAt: number };

  entrada.fetchedAt = Date.now() - 10 * 60 * 1000; // 10 minutos atrás

  await redis.set(`inventory:${steamId}`, JSON.stringify(entrada), 'EX', 3600);
}
