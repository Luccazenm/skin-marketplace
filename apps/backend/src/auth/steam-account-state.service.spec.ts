import { SteamAccountStateService } from './steam-account-state.service';

describe('SteamAccountStateService', () => {
  let service: SteamAccountStateService;
  let fetchMock: jest.SpyInstance;

  const xml = (fields: Record<string, string>) =>
    `<?xml version="1.0" encoding="UTF-8"?><profile>` +
    Object.entries(fields)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('') +
    `</profile>`;

  const answerWith = (body: string, ok = true, status = 200) => {
    fetchMock.mockResolvedValue({
      ok,
      status,
      text: () => Promise.resolve(body),
    });
  };

  beforeEach(() => {
    service = new SteamAccountStateService();
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The case that motivated the service: a freshly created account, with
  // no ban at all, that still cannot trade because it has not spent the
  // US$ 5.
  it('detects a limited account', async () => {
    answerWith(
      xml({
        isLimitedAccount: '1',
        privacyState: 'public',
        tradeBanState: 'None',
      }),
    );

    const state = await service.fetchAccountState('76561198000000000');

    expect(state).toEqual({
      isLimited: true,
      privacyState: 'public',
      tradeBanState: 'None',
    });
  });

  it('detects an unlocked account', async () => {
    answerWith(
      xml({
        isLimitedAccount: '0',
        privacyState: 'public',
        tradeBanState: 'None',
      }),
    );

    const state = await service.fetchAccountState('76561198000000000');

    expect(state?.isLimited).toBe(false);
  });

  it('queries the profile by steamID64', async () => {
    answerWith(xml({ isLimitedAccount: '0' }));

    await service.fetchAccountState('76561198659520305');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://steamcommunity.com/profiles/76561198659520305/?xml=1',
      expect.anything(),
    );
  });

  it('reads a field wrapped in CDATA', async () => {
    answerWith(
      xml({
        isLimitedAccount: '0',
        tradeBanState: '<![CDATA[None]]>',
      }),
    );

    const state = await service.fetchAccountState('76561198000000000');

    expect(state?.tradeBanState).toBe('None');
  });

  describe('when it cannot determine the state', () => {
    // null is not "everything is fine". The caller has to tell the two
    // apart so it never clears a Trade Bot on the strength of silence.
    it('returns null when the profile does not exist (error page)', async () => {
      answerWith('<html><body>The specified profile could not be found.');

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('returns null when Steam answers with an error', async () => {
      answerWith('', false, 500);

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('returns null when the field is missing', async () => {
      answerWith(xml({ privacyState: 'private' }));

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('returns null when the network fails', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });
  });

  it('does not let a Steam response hang the call', async () => {
    answerWith(xml({ isLimitedAccount: '0' }));

    await service.fetchAccountState('76561198000000000');

    // AbortSignal.timeout — without it, a slow Steam would hold the
    // operator's command indefinitely.
    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { signal?: AbortSignal },
    ];

    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
