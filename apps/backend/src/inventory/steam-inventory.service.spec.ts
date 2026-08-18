import { Test } from '@nestjs/testing';
import { ItemCategory } from '@prisma/client';
import { SteamInventoryService } from './steam-inventory.service';

/**
 * This service decides what the user sees of their own inventory. On top
 * of calling Steam, it joins two separate lists and interprets tags —
 * and a mistake here shows the wrong item, or fails to show one that
 * exists.
 */
describe('SteamInventoryService', () => {
  let service: SteamInventoryService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  /**
   * Steam's response: `assets` are the instances the person owns,
   * `descriptions` are the shared metadata. Several assets point at the
   * same description — that is how 50 identical cases avoid repeating
   * name and image 50 times.
   */
  const response = (body: unknown, status = 200) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);

  /**
   * The description format as Steam returns it. Almost everything is
   * optional on purpose: several tests omit fields to exercise an
   * incomplete item, and that is how it really arrives.
   */
  interface Description {
    classid: string;
    instanceid?: string;
    market_hash_name?: string;
    icon_url?: string;
    tradable?: number;
    marketable?: number;
    tags?: {
      category: string;
      internal_name?: string;
      localized_tag_name?: string;
    }[];
    actions?: { name?: string; link?: string }[];
  }

  const akDescription: Description = {
    classid: '310777179',
    instanceid: '302028390',
    market_hash_name: 'AK-47 | Redline (Field-Tested)',
    icon_url: 'abc123',
    tradable: 1,
    marketable: 1,
    tags: [
      {
        category: 'Type',
        internal_name: 'CSGO_Type_Rifle',
        localized_tag_name: 'Rifle',
      },
      {
        category: 'Rarity',
        internal_name: 'Rarity_Rare_Weapon',
        localized_tag_name: 'Classified',
      },
      {
        category: 'Exterior',
        internal_name: 'WearCategory2',
        localized_tag_name: 'Field-Tested',
      },
    ],
    actions: [
      {
        name: 'Inspect in Game...',
        link: 'steam://rungame/730/x/+csgo_econ_action_preview%20S%owner_steamid%A%assetid%D123456',
      },
    ],
  };

  const inventoryWith = (
    assets: unknown[],
    descriptions: unknown[] = [akDescription],
    asset_properties: unknown[] = [],
  ) => ({
    assets,
    descriptions,
    asset_properties,
    total_inventory_count: assets.length,
  });

  /**
   * Per-instance properties. The identifiers are Valve's magic numbers,
   * confirmed against a real inventory: 1 is the paint seed, 2 is the
   * float, 6 is the self-encoded inspect link, and 4 (inside the
   * accessory) is the scrape.
   */
  const propertiesOf = (
    assetid: string,
    options: { float?: string; seed?: string; scrapes?: number[] } = {},
  ) => ({
    appid: 730,
    contextid: '2',
    assetid,
    asset_properties: [
      ...(options.seed !== undefined
        ? [{ propertyid: 1, int_value: options.seed, name: 'Pattern Template' }]
        : []),
      ...(options.float !== undefined
        ? [{ propertyid: 2, float_value: options.float, name: 'Wear Rating' }]
        : []),
    ],
    ...(options.scrapes
      ? {
          asset_accessories: options.scrapes.map((s) => ({
            classid: '5327976266',
            parent_relationship_properties: [
              { propertyid: 4, float_value: String(s) },
            ],
          })),
        }
      : {}),
  });

  const asset = (assetid: string, desc: Description = akDescription) => ({
    appid: 730,
    contextid: '2',
    assetid,
    classid: desc.classid,
    instanceid: desc.instanceid,
    amount: '1',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SteamInventoryService],
    }).compile();

    service = moduleRef.get(SteamInventoryService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('the request', () => {
    it('asks for the CS2 inventory in the tradable-items context', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([])));

      await service.fetchInventory(STEAM_ID);

      const [url] = fetchMock.mock.calls[0] as [string];

      // 730 is CS2 and context 2 is where the tradable items live — that
      // is why an item from another game cannot show up.
      expect(url).toContain(`/inventory/${STEAM_ID}/730/2`);
      // The ceiling the community settled on; above it the block comes
      // sooner.
      expect(url).toContain('count=2000');
      // The language pins the display labels; the logic uses
      // internal_name.
      expect(url).toContain('l=english');
    });
  });

  describe('failures', () => {
    it('treats 429 as a rate limit, not as a generic error', async () => {
      fetchMock.mockReturnValue(response({}, 429));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'rate_limited',
      });
    });

    it('treats 403 as a private inventory', async () => {
      fetchMock.mockReturnValue(response({}, 403));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'private',
      });
    });

    it('treats 401 as a private inventory', async () => {
      fetchMock.mockReturnValue(response({}, 401));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'private',
      });
    });

    it('treats other statuses as an error', async () => {
      fetchMock.mockReturnValue(response({}, 500));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('error');
    });

    it('treats a dropped network as an error, without throwing', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('error');
    });

    // An account with no items answers successfully but without the
    // arrays. Treating that as an error would show "failed to load" to
    // someone who simply has an empty inventory.
    it('an empty inventory is a success with an empty list', async () => {
      fetchMock.mockReturnValue(response({ success: 1 }));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'ok',
        items: [],
      });
    });
  });

  describe('joining assets with descriptions', () => {
    it('resolves the metadata by the classid + instanceid pair', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('ok');
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].marketHashName).toBe('AK-47 | Redline (Field-Tested)');
      expect(r.items[0].assetId).toBe('111');
    });

    // The case that justifies Steam splitting the two lists.
    it('reuses the same description for several assets', async () => {
      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111'), asset('222'), asset('333')])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(3);
      expect(r.items.map((i) => i.assetId)).toEqual(['111', '222', '333']);
      expect(new Set(r.items.map((i) => i.marketHashName)).size).toBe(1);
    });

    // Returning half an item would be worse: it would appear on screen
    // with no name.
    it('ignores an asset whose description did not arrive', async () => {
      const orphan = { ...asset('999'), classid: '000', instanceid: '000' };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111'), orphan])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].assetId).toBe('111');
    });

    it('treats a missing instanceid as zero on both sides', async () => {
      const desc = { ...akDescription, instanceid: undefined };
      const withoutInstance = { ...asset('111'), instanceid: undefined };

      fetchMock.mockReturnValue(
        response(inventoryWith([withoutInstance], [desc])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].instanceId).toBe('0');
    });
  });

  describe('classification', () => {
    it('uses internal_name, not the translated label', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.RIFLE);
      expect(r.items[0].hasUniquePattern).toBe(true);
      // The translated labels stay apart, for display only
      expect(r.items[0].typeLabel).toBe('Rifle');
      expect(r.items[0].rarity).toBe('Classified');
      expect(r.items[0].exterior).toBe('Field-Tested');
    });

    it('falls back to OTHER when the type is not mapped', async () => {
      const unknown = {
        ...akDescription,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_SomethingNew' }],
      };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', unknown)], [unknown])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.OTHER);
    });

    it('does not throw when the item has no tags', async () => {
      const withoutTags = { ...akDescription, tags: undefined };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', withoutTags)], [withoutTags])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.OTHER);
      expect(r.items[0].rarity).toBeNull();
    });
  });

  describe('depositable', () => {
    it('a tradable item can be deposited', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].depositable).toBe(true);
      expect(r.items[0].blockReason).toBeNull();
    });

    // A medal will never be tradable — that is different from waiting.
    it('a medal is a permanent block', async () => {
      const medal = {
        ...akDescription,
        market_hash_name: '2024 Service Medal',
        tradable: 0,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_Collectible' }],
      };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', medal)], [medal])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].depositable).toBe(false);
      expect(r.items[0].blockReason).toBe('permanent');
    });

    // Steam does not distinguish a trade lock from a permanent block, so
    // the label is vague on purpose — promising a date would be a guess.
    it('a non-tradable weapon is unavailable, with no date', async () => {
      const locked = { ...akDescription, tradable: 0 };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', locked)], [locked])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].blockReason).toBe('unavailable');
    });
  });

  /**
   * Float and paint seed come from the inventory itself, in
   * `asset_properties`. That is what removes the need to keep an account
   * connected to the game just to inspect — see CLAUDE.md.
   */
  describe('float and paint seed', () => {
    it('reads the per-instance data', async () => {
      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('51981650519')],
            [akDescription],
            [
              propertiesOf('51981650519', {
                float: '0.666114687919616699',
                seed: '401',
              }),
            ],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].float).toBeCloseTo(0.6661146879196167, 10);
      expect(r.items[0].paintSeed).toBe(401);
    });

    // They belong to the instance, not the model: two copies of the same
    // skin have different floats, and that is what makes them distinct
    // items.
    it('gives different values to assets sharing a description', async () => {
      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('111'), asset('222')],
            [akDescription],
            [
              propertiesOf('111', { float: '0.01', seed: '1' }),
              propertiesOf('222', { float: '0.9', seed: '2' }),
            ],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].float).toBeCloseTo(0.01);
      expect(r.items[1].float).toBeCloseTo(0.9);
      expect(r.items[0].paintSeed).toBe(1);
      expect(r.items[1].paintSeed).toBe(2);
    });

    it('stays null when Steam does not send the properties', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].float).toBeNull();
      expect(r.items[0].paintSeed).toBeNull();
    });

    // NaN would travel through the system silently and turn up on a
    // pricing screen; null is at least visible.
    it('becomes null, not NaN, when the value is not numeric', async () => {
      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('111')],
            [akDescription],
            [propertiesOf('111', { float: 'no idea', seed: '' })],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].float).toBeNull();
    });
  });

  describe('sticker scrape', () => {
    const withStickers = (howMany: number) => ({
      ...akDescription,
      descriptions: [
        {
          name: 'sticker_info',
          value:
            '<div id="sticker_info"><center>' +
            Array.from(
              { length: howMany },
              () =>
                '<img src="https://cdn/gl_glitter.png" ' +
                'title="Sticker: GamerLegion (Glitter) | Paris 2023">',
            ).join('') +
            '</center></div>',
        },
      ],
    });

    // A real case: five copies of the same sticker, each with a
    // different scrape. That is exactly why applications are never
    // grouped by name with a count.
    it('matches the scrape of each copy of the same sticker', async () => {
      const desc = withStickers(5);

      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('111', desc)],
            [desc],
            [
              propertiesOf('111', {
                scrapes: [0.63, 0.84, 0.8, 0.75, 0.97],
              }),
            ],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].applied.map((a) => a.wear)).toEqual([
        0.63, 0.84, 0.8, 0.75, 0.97,
      ]);
    });

    it('treats an untouched sticker as zero, not as missing', async () => {
      const desc = withStickers(4);

      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('111', desc)],
            [desc],
            [propertiesOf('111', { scrapes: [0, 0, 0, 0] })],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].applied.map((a) => a.wear)).toEqual([0, 0, 0, 0]);
    });

    // Order is the only link between the two lists. If the counts
    // diverge, pairing them would assign one sticker's scrape to
    // another — and that moves the price directly.
    it('does not guess when the counts do not match', async () => {
      const desc = withStickers(4);

      fetchMock.mockReturnValue(
        response(
          inventoryWith(
            [asset('111', desc)],
            [desc],
            [propertiesOf('111', { scrapes: [0.5, 0.2] })],
          ),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].applied.map((a) => a.wear)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('stays null when Steam does not send the accessories', async () => {
      const desc = withStickers(2);

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', desc)], [desc])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].applied).toHaveLength(2);
      expect(r.items[0].applied.every((a) => a.wear === null)).toBe(true);
    });
  });

  describe('inspect link', () => {
    // It is there to open the item in the game. It is no longer the
    // source of float and paint seed — those come in asset_properties.
    it('replaces the placeholders with steamId and assetId', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('98765')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toContain(`S${STEAM_ID}`);
      expect(r.items[0].inspectLink).toContain('A98765');
      expect(r.items[0].inspectLink).not.toContain('%assetid%');
      expect(r.items[0].inspectLink).not.toContain('%owner_steamid%');
    });

    it('stays null when the item has no inspect link', async () => {
      const crate = {
        ...akDescription,
        market_hash_name: 'Dreams & Nightmares Case',
        actions: undefined,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_WeaponCase' }],
      };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', crate)], [crate])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toBeNull();
      expect(r.items[0].category).toBe(ItemCategory.CONTAINER);
    });

    it('ignores an action that is not an inspect one', async () => {
      const withAnotherAction = {
        ...akDescription,
        actions: [{ name: 'Open in the store', link: 'https://example/store' }],
      };

      fetchMock.mockReturnValue(
        response(
          inventoryWith([asset('111', withAnotherAction)], [withAnotherAction]),
        ),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toBeNull();
    });
  });

  describe('image', () => {
    it('builds the full URL from icon_url', async () => {
      fetchMock.mockReturnValue(response(inventoryWith([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].iconUrl).toBe(
        'https://community.cloudflare.steamstatic.com/economy/image/abc123',
      );
    });

    it('stays null when the item has no icon', async () => {
      const withoutIcon = { ...akDescription, icon_url: undefined };

      fetchMock.mockReturnValue(
        response(inventoryWith([asset('111', withoutIcon)], [withoutIcon])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].iconUrl).toBeNull();
    });
  });
});
