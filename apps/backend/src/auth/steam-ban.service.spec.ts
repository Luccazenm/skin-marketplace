import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SteamEconomyBan } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { SteamBanService } from './steam-ban.service';

/**
 * Decides whether someone can deposit or withdraw. Erring on the
 * permissive side produces trades Steam will refuse; erring on the
 * restrictive side keeps a legitimate person from touching what is
 * theirs.
 */
describe('SteamBanService', () => {
  let service: SteamBanService;
  let config: ConfigService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  const responseWith = (players: unknown[]) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ players }),
    } as Response);

  const unrestricted = {
    SteamId: STEAM_ID,
    CommunityBanned: false,
    VACBanned: false,
    NumberOfVACBans: 0,
    NumberOfGameBans: 0,
    EconomyBan: 'none',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [SteamBanService],
    }).compile();

    service = moduleRef.get(SteamBanService);
    config = moduleRef.get(ConfigService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.restoreAllMocks();
  });

  it('reads an unrestricted account', async () => {
    fetchMock.mockReturnValue(responseWith([unrestricted]));

    await expect(service.fetchBanStatus(STEAM_ID)).resolves.toEqual({
      economyBan: SteamEconomyBan.NONE,
      vacBanned: false,
    });
  });

  it('translates the three EconomyBan states', async () => {
    const cases: [string, SteamEconomyBan][] = [
      ['none', SteamEconomyBan.NONE],
      ['probation', SteamEconomyBan.PROBATION],
      ['banned', SteamEconomyBan.BANNED],
    ];

    for (const [text, expected] of cases) {
      fetchMock.mockReturnValue(
        responseWith([{ ...unrestricted, EconomyBan: text }]),
      );

      const r = await service.fetchBanStatus(STEAM_ID);
      expect(r!.economyBan).toBe(expected);
    }
  });

  it('accepts the casing Steam happens to send', async () => {
    fetchMock.mockReturnValue(
      responseWith([{ ...unrestricted, EconomyBan: 'BANNED' }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.economyBan).toBe(SteamEconomyBan.BANNED);
  });

  // A new state from Valve is treated as a restriction: holding the
  // operation is safer than allowing it blindly.
  it('treats an unknown EconomyBan as a restriction', async () => {
    fetchMock.mockReturnValue(
      responseWith([{ ...unrestricted, EconomyBan: 'something_new' }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.economyBan).toBe(SteamEconomyBan.PROBATION);
  });

  it('reports a VAC ban', async () => {
    fetchMock.mockReturnValue(
      responseWith([{ ...unrestricted, VACBanned: true }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.vacBanned).toBe(true);
  });

  describe('returns null when it cannot determine the status', () => {
    // null is not the same as "no ban": the caller must preserve the
    // last known value. Assuming NONE would allow an operation that is
    // going to fail; assuming BANNED would punish a legitimate user over
    // a Steam outage.
    it('Steam does not return the player', async () => {
      fetchMock.mockReturnValue(responseWith([]));

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('Steam answers with an HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      });

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('the network fails', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('there is no STEAM_API_KEY configured', async () => {
      jest.spyOn(config, 'get').mockReturnValue(undefined);

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
