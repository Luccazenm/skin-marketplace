import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { SteamOpenIdService } from './steam-openid.service';

/**
 * Validating Steam's return is what separates a legitimate login from
 * someone typing whatever steamId they like into the URL. The parameters
 * arrive in the query string, that is, entirely under the control of
 * whoever makes the request.
 */
describe('SteamOpenIdService', () => {
  let service: SteamOpenIdService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  /** A valid Steam return, as it arrives in the query string. */
  const validReturn = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.sig': 'signature',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity',
    'openid.assoc_handle': '1234567890',
  };

  /** Steam answers check_authentication with plain text. */
  const steamResponse = (valid: boolean) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`,
        ),
    } as Response);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [SteamOpenIdService],
    }).compile();

    service = moduleRef.get(SteamOpenIdService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('buildLoginUrl', () => {
    it('points at the Steam endpoint with the OpenID 2.0 parameters', () => {
      const url = new URL(service.buildLoginUrl());

      expect(url.origin + url.pathname).toBe(
        'https://steamcommunity.com/openid/login',
      );
      expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
      // identifier_select: we do not know who it is yet, Steam decides
      expect(url.searchParams.get('openid.identity')).toContain(
        'identifier_select',
      );
      expect(url.searchParams.get('openid.return_to')).toContain(
        '/api/auth/steam/return',
      );
    });
  });

  describe('verifyReturn', () => {
    it('accepts a return Steam confirms', async () => {
      fetchMock.mockReturnValue(steamResponse(true));

      await expect(service.verifyReturn(validReturn)).resolves.toBe(STEAM_ID);
    });

    // The central case: a perfectly formatted steamId with a signature
    // Steam does not recognise. That is exactly the impersonation
    // attempt.
    it('REFUSES when Steam answers is_valid:false', async () => {
      fetchMock.mockReturnValue(steamResponse(false));

      await expect(service.verifyReturn(validReturn)).resolves.toBeNull();
    });

    it('refuses when the user cancelled on the Steam screen', async () => {
      const cancelled = { ...validReturn, 'openid.mode': 'cancel' };

      await expect(service.verifyReturn(cancelled)).resolves.toBeNull();
      // It does not even ask Steam
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Without anchoring the regex, any URL containing the pattern would
    // pass.
    it('refuses a claimed_id from another domain', async () => {
      const fake = {
        ...validReturn,
        'openid.claimed_id': `https://fakesite.com/?x=https://steamcommunity.com/openid/id/${STEAM_ID}`,
      };

      await expect(service.verifyReturn(fake)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a malformed steamId', async () => {
      const tooShort = {
        ...validReturn,
        'openid.claimed_id': 'https://steamcommunity.com/openid/id/123',
      };

      await expect(service.verifyReturn(tooShort)).resolves.toBeNull();
    });

    it('refuses a request with no parameters', async () => {
      await expect(service.verifyReturn({})).resolves.toBeNull();
    });

    // Unavailability must not become an open door: refusing is correct.
    it('refuses when Steam is down', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.verifyReturn(validReturn)).resolves.toBeNull();
    });

    it('refuses when Steam answers with an HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve(''),
      });

      await expect(service.verifyReturn(validReturn)).resolves.toBeNull();
    });

    it('returns every openid field to Steam, with the mode switched', async () => {
      fetchMock.mockReturnValue(steamResponse(true));

      await service.verifyReturn(validReturn);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = init.body as URLSearchParams;

      // The fields are part of what was signed: changing any of them
      // would invalidate the verification.
      expect(body.get('openid.mode')).toBe('check_authentication');
      expect(body.get('openid.sig')).toBe(validReturn['openid.sig']);
      expect(body.get('openid.claimed_id')).toBe(
        validReturn['openid.claimed_id'],
      );
    });

    it('ignores parameters that are not openid ones', async () => {
      fetchMock.mockReturnValue(steamResponse(true));

      await service.verifyReturn({ ...validReturn, utm_source: 'x' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.body as URLSearchParams).get('utm_source')).toBeNull();
    });
  });
});
