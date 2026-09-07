import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogEnrichmentService } from './catalog-enrichment.service';
import type { InventoryItem } from './steam-inventory.service';

/**
 * What the catalog adds to a Steam inventory item.
 *
 * Steam returns a name and nothing else about the model, so everything
 * the detail screen shows beyond the float — the weapon and skin split
 * apart, the description, Valve's closing line — is joined on here.
 * A field dropped from the `select` disappears silently: the response
 * still has a `catalog` object, just with a hole where the text was,
 * and the screen renders its empty state as though the item had none.
 *
 * The TEST-ENRICH prefix isolates everything from the real catalog.
 */
describe('CatalogEnrichmentService', () => {
  let service: CatalogEnrichmentService;
  let prisma: PrismaService;

  const PREFIX = 'TEST-ENRICH';
  const AK = `${PREFIX} AK-47 | Alpha (Field-Tested)`;
  const UNKNOWN = `${PREFIX} Nothing We Have Ever Seen`;

  const DESCRIPTION =
    'Powerful and reliable, it has been painted iridescent purple.';
  const FLAVOR = "That's one way to get their attention…";

  /** Only the fields the enrichment reads; the rest is not its business. */
  const item = (marketHashName: string): InventoryItem =>
    ({ marketHashName }) as InventoryItem;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [CatalogEnrichmentService, PrismaService],
    }).compile();

    service = moduleRef.get(CatalogEnrichmentService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();

    await prisma.skinTemplate.create({
      data: {
        marketHashName: AK,
        weapon: 'AK-47',
        skinName: 'Alpha',
        rarity: 'Classified',
        // The database refuses a named skin with no float range
        // (`skintemplate_skin_exige_faixa_de_float`), which is right:
        // a skin that cannot be worn is not a skin.
        minFloat: 0.06,
        maxFloat: 0.8,
        collections: ['The Alpha Collection'],
        description: DESCRIPTION,
        flavorText: FLAVOR,
      },
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function cleanup() {
    return prisma.skinTemplate.deleteMany({
      where: { marketHashName: { startsWith: PREFIX } },
    });
  }

  it('joins the model facts onto the item', async () => {
    const [enriched] = await service.enrich([item(AK)]);

    expect(enriched.catalog).toEqual({
      weapon: 'AK-47',
      skinName: 'Alpha',
      collections: ['The Alpha Collection'],
      description: DESCRIPTION,
      flavorText: FLAVOR,
    });
  });

  /**
   * The Description tab reads both, and they are separate fields
   * because they are set differently — the flavour line is italic, and
   * gluing it to the end of the description would put a joke inside a
   * paragraph of fact.
   */
  it('carries the description and the flavour line apart', async () => {
    const [enriched] = await service.enrich([item(AK)]);

    expect(enriched.catalog?.description).toBe(DESCRIPTION);
    expect(enriched.catalog?.flavorText).toBe(FLAVOR);
    expect(enriched.catalog?.description).not.toContain(FLAVOR);
  });

  /**
   * About half the catalog has no flavour line, and the screen leaves
   * the italics out rather than printing an empty one. Null has to
   * survive the join to say so.
   */
  it('passes a missing flavour line through as null', async () => {
    await prisma.skinTemplate.update({
      where: { marketHashName: AK },
      data: { flavorText: null },
    });

    const [enriched] = await service.enrich([item(AK)]);

    expect(enriched.catalog?.flavorText).toBeNull();
    expect(enriched.catalog?.description).toBe(DESCRIPTION);
  });

  /**
   * Null, not an empty object: "we have never heard of this" is a
   * different answer from "known, with no description", and Valve ships
   * items before the dataset catches up.
   */
  it('leaves the catalog null for an item it does not know', async () => {
    const [enriched] = await service.enrich([item(UNKNOWN)]);

    expect(enriched.catalog).toBeNull();
  });

  it('resolves a page of repeated names in one pass', async () => {
    const enriched = await service.enrich([item(AK), item(AK), item(UNKNOWN)]);

    expect(enriched).toHaveLength(3);
    expect(enriched[0].catalog?.flavorText).toBe(FLAVOR);
    expect(enriched[1].catalog?.flavorText).toBe(FLAVOR);
    expect(enriched[2].catalog).toBeNull();
  });

  it('does nothing to an empty page', async () => {
    await expect(service.enrich([])).resolves.toEqual([]);
  });
});
