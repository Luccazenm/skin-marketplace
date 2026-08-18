import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * The importer is the part of the catalog that talks to the network and
 * the database, and the one that can ruin already-stored data — the
 * `upsert` runs over 33,950 rows on every pass. A mistake here does not
 * show up on screen: it silently erases a business decision.
 *
 * The TEST-SYNC prefix isolates everything from the real catalog.
 */
describe('CatalogSyncService', () => {
  let service: CatalogSyncService;
  let prisma: PrismaService;
  let fetchMock: jest.SpyInstance;

  const PREFIX = 'TEST-SYNC';
  const AK = `${PREFIX} AK-47 | Alpha (Field-Tested)`;
  const KNIFE = `${PREFIX} ★ Karambit | Beta (Factory New)`;

  const skin = (name: string, over: Record<string, unknown> = {}) => ({
    market_hash_name: name,
    skin_id: `skin-${name}`,
    weapon: { name: 'AK-47' },
    pattern: { name: 'Alpha' },
    rarity: { name: 'Classified' },
    min_float: 0.1,
    max_float: 0.7,
    image: 'https://cdn/x.png',
    ...over,
  });

  /**
   * Responds per file. Anything not declared comes back empty, so each
   * test describes only the files it cares about.
   */
  const respondWith = (byFile: Record<string, unknown[]>) => {
    fetchMock.mockImplementation((url: string) => {
      const file = /\/([a-z_]+)\.json$/.exec(url)?.[1] ?? '';

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(byFile[file] ?? []),
      } as Response);
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [CatalogSyncService, PrismaService],
    }).compile();

    service = moduleRef.get(CatalogSyncService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const cleanup = () =>
    prisma.skinTemplate.deleteMany({
      where: { marketHashName: { startsWith: PREFIX } },
    });

  const find = (marketHashName: string) =>
    prisma.skinTemplate.findUnique({ where: { marketHashName } });

  describe('storing', () => {
    it('stores what arrived and counts what it did', async () => {
      respondWith({ skins_not_grouped: [skin(AK)] });

      const r = await service.sync();

      expect(r.created).toBe(1);
      expect(r.updated).toBe(0);

      const t = await find(AK);
      expect(t?.weapon).toBe('AK-47');
      expect(t?.skinName).toBe('Alpha');
    });

    // Runs every time a new case ships; duplicating would create a second
    // template for the same item, and the price would hang off only one.
    it('is idempotent: the second pass updates, it does not duplicate', async () => {
      respondWith({ skins_not_grouped: [skin(AK)] });

      await service.sync();
      const r = await service.sync();

      expect(r.created).toBe(0);
      expect(r.updated).toBe(1);

      await expect(
        prisma.skinTemplate.count({
          where: { marketHashName: { startsWith: PREFIX } },
        }),
      ).resolves.toBe(1);
    });

    it('reflects a change in the dataset', async () => {
      respondWith({ skins_not_grouped: [skin(AK)] });
      await service.sync();

      respondWith({
        skins_not_grouped: [skin(AK, { rarity: { name: 'Covert' } })],
      });
      await service.sync();

      expect((await find(AK))?.rarity).toBe('Covert');
    });

    // The dataset repeats the same market_hash_name across files.
    it('does not hit the database twice for the same item', async () => {
      respondWith({ skins_not_grouped: [skin(AK), skin(AK)] });

      const r = await service.sync();

      expect(r.created).toBe(1);
    });
  });

  /**
   * The most dangerous part of the importer: the `upsert` rewrites rows
   * that already exist, and some columns are OUR decision, not the
   * dataset's. Overwriting them would pull a skin out of the instant
   * buyout — or worse, let one in — without anyone noticing.
   */
  describe('what the sync must not touch', () => {
    it('preserves the reference price and the buyout whitelist', async () => {
      respondWith({ skins_not_grouped: [skin(AK)] });
      await service.sync();

      await prisma.skinTemplate.update({
        where: { marketHashName: AK },
        data: {
          referencePrice: new Prisma.Decimal(42.5),
          referencePriceAt: new Date(),
          buyoutEligible: true,
          buyoutDiscountPct: new Prisma.Decimal(15),
          salesVolume30d: 300,
        },
      });

      await service.sync();

      const t = await find(AK);
      expect(Number(t?.referencePrice)).toBe(42.5);
      expect(t?.buyoutEligible).toBe(true);
      expect(Number(t?.buyoutDiscountPct)).toBe(15);
      expect(t?.salesVolume30d).toBe(300);
    });
  });

  describe('origins', () => {
    // A quarter of the catalog drops from more than one case. Overwriting
    // instead of accumulating would let the last one processed erase the
    // earlier ones.
    //
    // The cases carry the prefix because the `crates` file serves two
    // purposes: it feeds the origin cross-reference AND becomes a
    // CONTAINER template. Without the prefix they escape the cleanup and
    // stay in the real catalog — which is what happened in the first
    // version of this test.
    it('accumulates every case the skin appears in', async () => {
      respondWith({
        skins_not_grouped: [skin(AK)],
        crates: [
          { name: `${PREFIX} Case One`, contains: [{ id: `skin-${AK}` }] },
          { name: `${PREFIX} Case Two`, contains: [{ id: `skin-${AK}` }] },
        ],
      });

      await service.sync();

      expect((await find(AK))?.collections.sort()).toEqual([
        `${PREFIX} Case One`,
        `${PREFIX} Case Two`,
      ]);
    });

    // Knives and gloves are the rare special item and live in another
    // field. Without reading `contains_rare`, the catalog's 3,898 would
    // have no origin.
    it('reads a knife from contains_rare, not only from contains', async () => {
      respondWith({
        skins_not_grouped: [
          skin(KNIFE, {
            weapon: { name: 'Karambit' },
            pattern: { name: 'Beta' },
          }),
        ],
        crates: [
          {
            name: `${PREFIX} Case With Knife`,
            contains_rare: [{ id: `skin-${KNIFE}` }],
          },
        ],
      });

      await service.sync();

      expect((await find(KNIFE))?.collections).toEqual([
        `${PREFIX} Case With Knife`,
      ]);
    });
  });

  describe('what stays out', () => {
    it('counts as discarded what must not enter', async () => {
      respondWith({
        skins_not_grouped: [skin(AK)],
        collectibles: [],
        stickers: [
          // No market name: it does not exist on the market.
          { name: `${PREFIX} Sticker | Ghost`, market_hash_name: null },
        ],
      });

      const r = await service.sync();

      expect(r.created).toBe(1);
      expect(r.discarded).toBe(1);
    });
  });

  describe('when something goes wrong', () => {
    // 36,000 items per pass: aborting everything because of one rejected
    // row would lose the whole import.
    it('counts the failure and carries on with the rest of the batch', async () => {
      const other = `${PREFIX} AK-47 | Gamma (Field-Tested)`;

      respondWith({
        skins_not_grouped: [
          skin(AK),
          skin(other, { pattern: { name: 'Gamma' } }),
        ],
      });

      // Only the first call fails: `spyOn` keeps the real implementation
      // as the default, so the second one really stores.
      jest
        .spyOn(prisma.skinTemplate, 'upsert')
        // `never` because Prisma returns a chainable client, not a bare
        // Promise — and here all that matters is that it rejects.
        .mockImplementationOnce(
          () => Promise.reject(new Error('database refused')) as never,
        );

      const r = await service.sync();

      expect(r.failures).toBe(1);
      expect(r.created).toBe(1);
      expect(await find(other)).not.toBeNull();
    });

    // The opposite here: a file that does not download means a partial
    // catalog, and carrying on silently would leave items missing from
    // the storefront with no explanation.
    it('stops when a file does not download', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve([]),
      });

      await expect(service.sync()).rejects.toThrow('503');
    });
  });

  describe('response shape', () => {
    // Some dataset files arrive keyed by id instead of as a list.
    it('accepts an object in place of a list', async () => {
      fetchMock.mockImplementation((url: string) => {
        const body = url.includes('skins_not_grouped')
          ? { 'some-key': skin(AK) }
          : [];

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        } as Response);
      });

      const r = await service.sync();

      expect(r.created).toBe(1);
      expect(await find(AK)).not.toBeNull();
    });
  });

  it('reports progress file by file', async () => {
    respondWith({ skins_not_grouped: [skin(AK)] });

    const seen: string[] = [];
    await service.sync((file) => seen.push(file));

    expect(seen).toContain('skins_not_grouped');
    expect(seen).toContain('stickers');
    expect(seen).toHaveLength(9);
  });
});
