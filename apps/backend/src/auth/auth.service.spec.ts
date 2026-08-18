import { ForbiddenException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SteamEconomyBan } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { SteamBanService } from './steam-ban.service';
import { SteamProfileService } from './steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env.validation';

/**
 * Runs against the local Postgres (docker compose up -d).
 * Uses steamIds from the test range and cleans up what it creates.
 */
describe('AuthService.loginWithSteam', () => {
  let authService: AuthService;
  let prisma: PrismaService;

  // Made-up steamIds, but with the 17 digits Steam uses
  const STEAM_ID_NEW = '76561199000000001';
  const STEAM_ID_BANNED = '76561199000000002';
  const ALL = [STEAM_ID_NEW, STEAM_ID_BANNED];

  const fakeProfile = {
    username: 'TestPlayer',
    avatarUrl: 'https://example/avatar.jpg',
    profileUrl: 'https://example/profile',
    steamCreatedAt: new Date('2015-01-01'),
  };

  const steamProfileMock = {
    fetchProfile: jest.fn().mockResolvedValue(fakeProfile),
  };

  const steamBanMock = {
    fetchBanStatus: jest.fn().mockResolvedValue({
      economyBan: SteamEconomyBan.NONE,
      vacBanned: false,
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      // AuditService goes in for real, not mocked: auditing is part of
      // what has to work, and the test should break if it breaks.
      providers: [AuthService, PrismaService, AuditService],
    })
      .useMocker((token) => {
        if (token === SteamProfileService) return steamProfileMock;
        if (token === SteamBanService) return steamBanMock;
        return undefined;
      })
      .compile();

    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: ALL } } });
    steamProfileMock.fetchProfile.mockResolvedValue(fakeProfile);
    steamBanMock.fetchBanStatus.mockResolvedValue({
      economyBan: SteamEconomyBan.NONE,
      vacBanned: false,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: ALL } } });
    await prisma.$disconnect();
  });

  it('creates the user on the first login', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(user.steamId).toBe(STEAM_ID_NEW);
    expect(user.username).toBe('TestPlayer');
    expect(user.lastLoginAt).not.toBeNull();
    expect(user.isPlatform).toBe(false);
  });

  it('does not duplicate the user on subsequent logins', async () => {
    const first = await authService.loginWithSteam(STEAM_ID_NEW);
    const second = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(second.id).toBe(first.id);

    const total = await prisma.user.count({
      where: { steamId: STEAM_ID_NEW },
    });
    expect(total).toBe(1);
  });

  // The test that matters most: Steam data must not touch the balance.
  it('preserves the balance across logins', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_NEW);

    await prisma.user.update({
      where: { id: user.id },
      data: { balance: '150.75' },
    });

    const after = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(after.balance.toString()).toBe('150.75');
  });

  it('creates the user even without a Steam profile', async () => {
    steamProfileMock.fetchProfile.mockResolvedValue(null);

    const user = await authService.loginWithSteam(STEAM_ID_NEW);

    // With no profile, the steamId becomes the provisional name
    expect(user.username).toBe(STEAM_ID_NEW);
  });

  it('does not wipe the stored profile if Steam fails later', async () => {
    await authService.loginWithSteam(STEAM_ID_NEW);

    steamProfileMock.fetchProfile.mockResolvedValue(null);
    const after = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(after.username).toBe('TestPlayer');
    expect(after.avatarUrl).toBe(fakeProfile.avatarUrl);
  });

  it('stores the ban status coming from Steam', async () => {
    steamBanMock.fetchBanStatus.mockResolvedValue({
      economyBan: SteamEconomyBan.BANNED,
      vacBanned: true,
    });

    const user = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(user.steamEconomyBan).toBe(SteamEconomyBan.BANNED);
    expect(user.steamVacBanned).toBe(true);
    expect(user.steamBanCheckedAt).not.toBeNull();
  });

  // Someone banned by Steam still gets in: they still own what is in
  // custody and need to be able to sell. Only isBanned blocks login.
  it('lets in someone banned by Steam', async () => {
    steamBanMock.fetchBanStatus.mockResolvedValue({
      economyBan: SteamEconomyBan.BANNED,
      vacBanned: false,
    });

    const user = await authService.loginWithSteam(STEAM_ID_NEW);

    expect(user.id).toBeDefined();
    expect(user.isBanned).toBe(false);
  });

  it('preserves the last status when Steam does not answer', async () => {
    steamBanMock.fetchBanStatus.mockResolvedValue({
      economyBan: SteamEconomyBan.BANNED,
      vacBanned: false,
    });
    await authService.loginWithSteam(STEAM_ID_NEW);

    // Steam down on the next login
    steamBanMock.fetchBanStatus.mockResolvedValue(null);
    const after = await authService.loginWithSteam(STEAM_ID_NEW);

    // It must not "clear" the ban just because the check failed
    expect(after.steamEconomyBan).toBe(SteamEconomyBan.BANNED);
  });

  it('refuses the login of a banned account', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_BANNED);
    await prisma.user.update({
      where: { id: user.id },
      data: { isBanned: true, banReason: 'test' },
    });

    await expect(authService.loginWithSteam(STEAM_ID_BANNED)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a login into the platform account', async () => {
    const platform = await prisma.user.findFirst({
      where: { isPlatform: true },
    });

    // Depends on the seed having run
    expect(platform).not.toBeNull();

    await expect(authService.loginWithSteam(platform!.steamId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // Regression: signing in with a Trade Bot account used to create an
  // ordinary User row for it. Our own custody account would then be able
  // to deposit, sell and hold a balance, and the audit trail would carry
  // a customer identity for something that must only ever be a
  // counterparty. Found by logging in with Trade Bot 2 by accident.
  describe('Trade Bot accounts', () => {
    const BOT_STEAM_ID = '76561199000000003';

    beforeEach(async () => {
      await prisma.bot.deleteMany({ where: { steamId: BOT_STEAM_ID } });
      await prisma.user.deleteMany({ where: { steamId: BOT_STEAM_ID } });

      await prisma.bot.create({
        data: {
          steamId: BOT_STEAM_ID,
          username: 'login-barrier-test-bot',
          credentialRef: 'vault/login-barrier-test-bot',
        },
      });
    });

    afterEach(async () => {
      await prisma.bot.deleteMany({ where: { steamId: BOT_STEAM_ID } });
      await prisma.user.deleteMany({ where: { steamId: BOT_STEAM_ID } });
    });

    it('refuses the login', async () => {
      await expect(authService.loginWithSteam(BOT_STEAM_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    // The refusal is worthless if the row is created anyway.
    it('creates no User row for it', async () => {
      await expect(authService.loginWithSteam(BOT_STEAM_ID)).rejects.toThrow();

      const user = await prisma.user.findUnique({
        where: { steamId: BOT_STEAM_ID },
      });

      expect(user).toBeNull();
    });

    // A refusal nobody can find later is not much of a barrier.
    it('records the refusal against the bot', async () => {
      await expect(authService.loginWithSteam(BOT_STEAM_ID)).rejects.toThrow();

      const [log] = await prisma.auditLog.findMany({
        where: { targetType: 'Bot', outcome: 'DENIED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(log.metadata).toMatchObject({
        reason: 'trade_bot_account',
        steamId: BOT_STEAM_ID,
      });
    });
  });

  // Regression: the previous version ran the upsert before checking
  // isPlatform, so the login attempt overwrote the system account's name
  // and avatar with the data of whoever tried to get in.
  it('does not alter the platform account on a login attempt', async () => {
    const before = await prisma.user.findFirst({ where: { isPlatform: true } });

    await expect(authService.loginWithSteam(before!.steamId)).rejects.toThrow(
      ForbiddenException,
    );

    const after = await prisma.user.findUnique({ where: { id: before!.id } });

    expect(after!.username).toBe(before!.username);
    expect(after!.avatarUrl).toBe(before!.avatarUrl);
    expect(after!.lastLoginAt).toEqual(before!.lastLoginAt);
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });

  it('records the banned-account attempt without accepting external data', async () => {
    const user = await authService.loginWithSteam(STEAM_ID_BANNED);
    await prisma.user.update({
      where: { id: user.id },
      data: { isBanned: true, username: 'OriginalName' },
    });

    await expect(authService.loginWithSteam(STEAM_ID_BANNED)).rejects.toThrow(
      ForbiddenException,
    );

    const after = await prisma.user.findUnique({ where: { id: user.id } });

    // lastLoginAt moves forward (we want to know they tried)...
    expect(after!.lastLoginAt!.getTime()).toBeGreaterThan(
      user.lastLoginAt!.getTime(),
    );
    // ...but nothing coming from Steam is written to a suspended account
    expect(after!.username).toBe('OriginalName');
  });
});
