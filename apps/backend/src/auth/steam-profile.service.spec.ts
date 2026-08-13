import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { SteamProfileService } from './steam-profile.service';

/**
 * Enriquecimento, não autenticação: quem prova identidade é o OpenID.
 * Por isso toda falha vira "sem perfil" em vez de erro — ficar sem avatar
 * é cosmético, e barrar o login por causa disso não seria.
 */
describe('SteamProfileService', () => {
  let service: SteamProfileService;
  let config: ConfigService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  const respostaCom = (players: unknown[]) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: { players } }),
    } as Response);

  const perfilCompleto = {
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

  it('lê nome, avatar, perfil e data de criação', async () => {
    fetchMock.mockReturnValue(respostaCom([perfilCompleto]));

    const perfil = await service.fetchProfile(STEAM_ID);

    expect(perfil).toEqual({
      username: 'mazzo',
      avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg',
      profileUrl: 'https://steamcommunity.com/id/mazzoccato/',
      // timecreated vem em segundos; Date espera milissegundos
      steamCreatedAt: new Date(1524850968 * 1000),
    });
  });

  it('não expõe a chave na URL do log nem esquece de enviá-la', async () => {
    fetchMock.mockReturnValue(respostaCom([perfilCompleto]));

    await service.fetchProfile(STEAM_ID);

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toContain('GetPlayerSummaries');
    expect(url.searchParams.get('steamids')).toBe(STEAM_ID);
    expect(url.searchParams.get('key')).toBeTruthy();
  });

  // Conta recém-criada pode vir sem nome; o steamId serve de rótulo até
  // a próxima sincronização, e é melhor que barrar o cadastro.
  it('usa o steamId quando o nome vem vazio', async () => {
    fetchMock.mockReturnValue(
      respostaCom([{ ...perfilCompleto, personaname: '   ' }]),
    );

    const perfil = await service.fetchProfile(STEAM_ID);

    expect(perfil!.username).toBe(STEAM_ID);
  });

  it('aceita perfil sem data de criação', async () => {
    fetchMock.mockReturnValue(
      respostaCom([{ ...perfilCompleto, timecreated: undefined }]),
    );

    const perfil = await service.fetchProfile(STEAM_ID);

    expect(perfil!.steamCreatedAt).toBeNull();
  });

  describe('devolve null sem estourar quando', () => {
    it('a Steam não retorna nenhum jogador', async () => {
      fetchMock.mockReturnValue(respostaCom([]));

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    it('a Steam responde com erro HTTP', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      });

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    it('a rede falha', async () => {
      fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
    });

    // Sem chave o login continua funcionando: quem autentica é o OpenID.
    it('não há STEAM_API_KEY configurada', async () => {
      jest.spyOn(config, 'get').mockReturnValue(undefined);

      await expect(service.fetchProfile(STEAM_ID)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
