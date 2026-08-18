import { SteamAccountStateService } from './steam-account-state.service';

describe('SteamAccountStateService', () => {
  let service: SteamAccountStateService;
  let fetchMock: jest.SpyInstance;

  const xml = (campos: Record<string, string>) =>
    `<?xml version="1.0" encoding="UTF-8"?><profile>` +
    Object.entries(campos)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('') +
    `</profile>`;

  const responderCom = (body: string, ok = true, status = 200) => {
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

  // O caso que motivou o serviço: conta recém-criada, sem ban nenhum, mas
  // que não consegue negociar porque não gastou os US$ 5.
  it('detecta conta limitada', async () => {
    responderCom(
      xml({
        isLimitedAccount: '1',
        privacyState: 'public',
        tradeBanState: 'None',
      }),
    );

    const estado = await service.fetchAccountState('76561198000000000');

    expect(estado).toEqual({
      isLimited: true,
      privacyState: 'public',
      tradeBanState: 'None',
    });
  });

  it('detecta conta liberada', async () => {
    responderCom(
      xml({
        isLimitedAccount: '0',
        privacyState: 'public',
        tradeBanState: 'None',
      }),
    );

    const estado = await service.fetchAccountState('76561198000000000');

    expect(estado?.isLimited).toBe(false);
  });

  it('consulta o perfil por steamID64', async () => {
    responderCom(xml({ isLimitedAccount: '0' }));

    await service.fetchAccountState('76561198659520305');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://steamcommunity.com/profiles/76561198659520305/?xml=1',
      expect.anything(),
    );
  });

  it('lê campo embrulhado em CDATA', async () => {
    responderCom(
      xml({
        isLimitedAccount: '0',
        tradeBanState: '<![CDATA[None]]>',
      }),
    );

    const estado = await service.fetchAccountState('76561198000000000');

    expect(estado?.tradeBanState).toBe('None');
  });

  describe('quando não dá para apurar', () => {
    // null não é "está tudo certo". Quem chama precisa distinguir as duas
    // coisas para não liberar um Trade Bot com base em silêncio.
    it('devolve null quando o perfil não existe (HTML de erro)', async () => {
      responderCom('<html><body>The specified profile could not be found.');

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('devolve null quando a Steam responde erro', async () => {
      responderCom('', false, 500);

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('devolve null quando o campo está ausente', async () => {
      responderCom(xml({ privacyState: 'private' }));

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });

    it('devolve null quando a rede falha', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));

      expect(await service.fetchAccountState('76561198000000000')).toBeNull();
    });
  });

  it('não deixa a resposta da Steam travar a chamada', async () => {
    responderCom(xml({ isLimitedAccount: '0' }));

    await service.fetchAccountState('76561198000000000');

    // AbortSignal.timeout — sem isso, uma Steam lenta prenderia o comando
    // do operador indefinidamente.
    const [, opcoes] = fetchMock.mock.calls[0] as [
      string,
      { signal?: AbortSignal },
    ];

    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
  });
});
