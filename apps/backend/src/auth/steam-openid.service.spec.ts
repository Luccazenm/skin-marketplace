import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { SteamOpenIdService } from './steam-openid.service';

/**
 * A validação do retorno da Steam é o que separa um login legítimo de
 * alguém digitando o steamId que quiser na URL. Os parâmetros chegam pela
 * query string, ou seja, totalmente sob controle de quem faz a requisição.
 */
describe('SteamOpenIdService', () => {
  let service: SteamOpenIdService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  /** Retorno válido da Steam, como chega na query string. */
  const retornoValido = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.sig': 'assinatura',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity',
    'openid.assoc_handle': '1234567890',
  };

  /** A Steam responde texto simples ao check_authentication. */
  const respostaSteam = (valido: boolean) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `ns:http://specs.openid.net/auth/2.0\nis_valid:${valido}\n`,
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
    it('aponta para o endpoint da Steam com os parâmetros do OpenID 2.0', () => {
      const url = new URL(service.buildLoginUrl());

      expect(url.origin + url.pathname).toBe(
        'https://steamcommunity.com/openid/login',
      );
      expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
      // identifier_select: não sabemos quem é ainda, a Steam decide
      expect(url.searchParams.get('openid.identity')).toContain(
        'identifier_select',
      );
      expect(url.searchParams.get('openid.return_to')).toContain(
        '/api/auth/steam/return',
      );
    });
  });

  describe('verifyReturn', () => {
    it('aceita retorno que a Steam confirma', async () => {
      fetchMock.mockReturnValue(respostaSteam(true));

      await expect(service.verifyReturn(retornoValido)).resolves.toBe(STEAM_ID);
    });

    // O caso central: steamId com formato perfeito, mas assinatura que a
    // Steam não reconhece. É exatamente a tentativa de se passar por outro.
    it('RECUSA quando a Steam responde is_valid:false', async () => {
      fetchMock.mockReturnValue(respostaSteam(false));

      await expect(service.verifyReturn(retornoValido)).resolves.toBeNull();
    });

    it('recusa quando o usuário cancelou na tela da Steam', async () => {
      const cancelado = { ...retornoValido, 'openid.mode': 'cancel' };

      await expect(service.verifyReturn(cancelado)).resolves.toBeNull();
      // Nem chega a perguntar à Steam
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Sem âncora na regex, uma URL contendo o padrão passaria.
    it('recusa claimed_id de outro domínio', async () => {
      const falso = {
        ...retornoValido,
        'openid.claimed_id': `https://sitefalso.com/?x=https://steamcommunity.com/openid/id/${STEAM_ID}`,
      };

      await expect(service.verifyReturn(falso)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recusa steamId com formato inválido', async () => {
      const curto = {
        ...retornoValido,
        'openid.claimed_id': 'https://steamcommunity.com/openid/id/123',
      };

      await expect(service.verifyReturn(curto)).resolves.toBeNull();
    });

    it('recusa requisição sem parâmetros', async () => {
      await expect(service.verifyReturn({})).resolves.toBeNull();
    });

    // Indisponibilidade não pode virar porta aberta: recusar é o correto.
    it('recusa quando a Steam está fora do ar', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.verifyReturn(retornoValido)).resolves.toBeNull();
    });

    it('recusa quando a Steam responde com erro HTTP', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve(''),
      });

      await expect(service.verifyReturn(retornoValido)).resolves.toBeNull();
    });

    it('devolve à Steam todos os campos openid, com o modo trocado', async () => {
      fetchMock.mockReturnValue(respostaSteam(true));

      await service.verifyReturn(retornoValido);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = init.body as URLSearchParams;

      // Os campos fazem parte do que foi assinado: alterar qualquer um
      // invalidaria a verificação.
      expect(body.get('openid.mode')).toBe('check_authentication');
      expect(body.get('openid.sig')).toBe(retornoValido['openid.sig']);
      expect(body.get('openid.claimed_id')).toBe(
        retornoValido['openid.claimed_id'],
      );
    });

    it('ignora parâmetros que não são do openid', async () => {
      fetchMock.mockReturnValue(respostaSteam(true));

      await service.verifyReturn({ ...retornoValido, utm_source: 'x' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.body as URLSearchParams).get('utm_source')).toBeNull();
    });
  });
});
