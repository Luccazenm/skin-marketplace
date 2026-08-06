import { ForbiddenException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SteamProfileService } from './steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env.validation';

/**
 * Roda contra o Postgres local (docker compose up -d).
 * Usa steamIds da faixa de teste e limpa o que cria.
 */
describe('AuthService.loginWithSteam', () => {
  let authService: AuthService;
  let prisma: PrismaService;

  // steamIds fictícios, mas com os 17 dígitos que a Steam usa
  const STEAM_ID_NOVO = '76561199000000001';
  const STEAM_ID_BANIDO = '76561199000000002';
  const TODOS = [STEAM_ID_NOVO, STEAM_ID_BANIDO];

  const perfilFalso = {
    username: 'JogadorTeste',
    avatarUrl: 'https://exemplo/avatar.jpg',
    profileUrl: 'https://exemplo/perfil',
    steamCreatedAt: new Date('2015-01-01'),
  };

  const steamProfileMock = {
    fetchProfile: jest.fn().mockResolvedValue(perfilFalso),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [AuthService, PrismaService],
    })
      .overrideProvider(SteamProfileService)
      .useValue(steamProfileMock)
      .useMocker((token) =>
        token === SteamProfileService ? steamProfileMock : undefined,
      )
      .compile();

    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });
    steamProfileMock.fetchProfile.mockResolvedValue(perfilFalso);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });
    await prisma.$disconnect();
  });

  it('cria o usuário no primeiro login', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_NOVO);

    expect(user.steamId).toBe(STEAM_ID_NOVO);
    expect(user.username).toBe('JogadorTeste');
    expect(user.lastLoginAt).not.toBeNull();
    expect(user.isPlatform).toBe(false);
  });

  it('não duplica o usuário em logins seguintes', async () => {
    const primeiro = await authService.loginWithSteam(STEAM_ID_NOVO);
    const segundo = await authService.loginWithSteam(STEAM_ID_NOVO);

    expect(segundo.id).toBe(primeiro.id);

    const total = await prisma.user.count({
      where: { steamId: STEAM_ID_NOVO },
    });
    expect(total).toBe(1);
  });

  // O teste que mais importa: dado da Steam não pode encostar em saldo.
  it('preserva o saldo ao relogar', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_NOVO);

    await prisma.user.update({
      where: { id: user.id },
      data: { balance: '150.75' },
    });

    const depois = await authService.loginWithSteam(STEAM_ID_NOVO);

    expect(depois.balance.toString()).toBe('150.75');
  });

  it('cria o usuário mesmo sem perfil da Steam', async () => {
    steamProfileMock.fetchProfile.mockResolvedValue(null);

    const user = await authService.loginWithSteam(STEAM_ID_NOVO);

    // Sem perfil, o steamId vira o nome provisório
    expect(user.username).toBe(STEAM_ID_NOVO);
  });

  it('não apaga o perfil já salvo se a Steam falhar depois', async () => {
    await authService.loginWithSteam(STEAM_ID_NOVO);

    steamProfileMock.fetchProfile.mockResolvedValue(null);
    const depois = await authService.loginWithSteam(STEAM_ID_NOVO);

    expect(depois.username).toBe('JogadorTeste');
    expect(depois.avatarUrl).toBe(perfilFalso.avatarUrl);
  });

  it('recusa login de conta banida', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_BANIDO);
    await prisma.user.update({
      where: { id: user.id },
      data: { isBanned: true, banReason: 'teste' },
    });

    await expect(authService.loginWithSteam(STEAM_ID_BANIDO)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('recusa login na conta da plataforma', async () => {
    const plataforma = await prisma.user.findFirst({
      where: { isPlatform: true },
    });

    // Depende do seed ter rodado
    expect(plataforma).not.toBeNull();

    await expect(
      authService.loginWithSteam(plataforma!.steamId),
    ).rejects.toThrow(ForbiddenException);
  });
});
