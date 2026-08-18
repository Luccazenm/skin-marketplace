import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { SteamProfileService } from './steam-profile.service';

/**
 * Enrichment, not authentication: identity is proven by the OpenID. That
 * is why every failure turns into "no profile" rather than an error —
 * going without an avatar is cosmetic, and blocking a login over it
 * would not be.
 */
describe('SteamProfileService', () => {
  let service: SteamProfileService;
  let config: ConfigService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  const responseWith = (players: unknown[]) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: { players } }),
    } as Response);

  const fullProfile = {
    steamid: STEAM_ID,
    personaname: 'mazzo',
    avatarfull: 'https://avatars.steamstatic.com/abc_full.jpg',
    profileurl: 'https://steamcommunity.com/id/mazzoccato/',
    timecreated: 1524850968,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [SteamProfileService],
    }).compile();

    service = moduleRef.get(SteamProfileService);
    config = moduleRef.get(ConfigService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.restoreAllMocks();
  });

  it('reads name, avatar, profile and creation date', async () => {
    fetchMock.mockReturnValue(responseWith([fullProfile]));

    const profile = await service.fetchProfile(STEAM_ID);

    expect(profile).toEqual({
      username: 'mazzo',
      avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg',
      profileUrl: 'https://steamcommunity.com/id/mazzoccato/',
      // timecreated comes in seconds; Date expects milliseconds
      steamCreatedAt: new Date(1524850968 * 1000),
    });
  });

  it('sends the key and asks for the right steamId', async () => {
    fetchMock.mockReturnValue(responseWith([fullProfile]));

    await service.fetchProfile(STEAM_ID);

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toContain('GetPlayerSummaries');
    expect(url.searchParams.get('steamids')).toBe(STEAM_ID);
    expect(url.searchParams.get('key')).toBeTruthy();
  });

  // A freshly created account can come through without a name; the
  // steamId works as a label until the next sync, and beats refusing the
  // sign-up.
  it('falls back to the steamId when the name comes back empty', async () => {
    fetchMock.mockReturnValue(
      responseWith([{ ...fullProfile, personaname: '   ' }]),
    );

    const profile = await service.fetchProfile(STEAM_ID);

    expect(profile!.username).toBe(STEAM_ID);
  });

  it('accepts a profile with no creation date', async () => {
    fetchMock.mockReturnValue(
      responseWith([{ ...fullProfile, timecreated: undefined }]),
    );

    const profile = await service.fetchProfile(STEAM_ID);

    expect(profile!.steamCreatedAt).toBeNull();
  });

  describe('returns null without throwing when', () => {
    it('Steam returns no player at all', async () => {
      fetchMock.mockReturnValue(responseWith([]));

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    it('Steam answers with an HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      });

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    it('the network fails', async () => {
      fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    // Without a key the login still works: the OpenID is what
    // authenticates.
    it('there is no STEAM_API_KEY configured', async () => {
      jest.spyOn(config, 'get').mockReturnValue(undefined);

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
