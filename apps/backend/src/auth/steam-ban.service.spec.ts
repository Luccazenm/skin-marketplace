import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SteamEconomyBan } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { SteamBanService } from './steam-ban.service';

/**
 * Decide se alguém pode depositar ou sacar. Errar para o lado permissivo
 * gera trocas que a Steam vai recusar; errar para o restritivo impede uma
 * pessoa legítima de mexer no que é dela.
 */
describe('SteamBanService', () => {
  let service: SteamBanService;
  let config: ConfigService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  const respostaCom = (players: unknown[]) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ players }),
    } as Response);

  const semRestricao = {
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

  it('lê conta sem restrição', async () => {
    fetchMock.mockReturnValue(respostaCom([semRestricao]));

    await expect(service.fetchBanStatus(STEAM_ID)).resolves.toEqual({
      economyBan: SteamEconomyBan.NONE,
      vacBanned: false,
    });
  });

  it('traduz os três estados de EconomyBan', async () => {
    const casos: [string, SteamEconomyBan][] = [
      ['none', SteamEconomyBan.NONE],
      ['probation', SteamEconomyBan.PROBATION],
      ['banned', SteamEconomyBan.BANNED],
    ];

    for (const [texto, esperado] of casos) {
      fetchMock.mockReturnValue(
        respostaCom([{ ...semRestricao, EconomyBan: texto }]),
      );

      const r = await service.fetchBanStatus(STEAM_ID);
      expect(r!.economyBan).toBe(esperado);
    }
  });

  it('aceita variação de caixa vinda da Steam', async () => {
    fetchMock.mockReturnValue(
      respostaCom([{ ...semRestricao, EconomyBan: 'BANNED' }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.economyBan).toBe(SteamEconomyBan.BANNED);
  });

  // Estado novo da Valve é tratado como restrição: segurar a operação é
  // mais seguro que liberar às cegas.
  it('trata EconomyBan desconhecido como restrição', async () => {
    fetchMock.mockReturnValue(
      respostaCom([{ ...semRestricao, EconomyBan: 'coisa_nova' }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.economyBan).toBe(SteamEconomyBan.PROBATION);
  });

  it('reporta VAC ban', async () => {
    fetchMock.mockReturnValue(
      respostaCom([{ ...semRestricao, VACBanned: true }]),
    );

    const r = await service.fetchBanStatus(STEAM_ID);

    expect(r!.vacBanned).toBe(true);
  });

  describe('devolve null quando não dá para apurar', () => {
    // null é diferente de "sem ban": quem chama deve preservar o último
    // valor conhecido. Assumir NONE liberaria operação que vai falhar;
    // assumir BANNED puniria usuário legítimo por instabilidade da Steam.
    it('a Steam não retorna o jogador', async () => {
      fetchMock.mockReturnValue(respostaCom([]));

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('a Steam responde com erro HTTP', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      });

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('a rede falha', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
    });

    it('não há STEAM_API_KEY configurada', async () => {
      jest.spyOn(config, 'get').mockReturnValue(undefined);

      await expect(service.fetchBanStatus(STEAM_ID)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
