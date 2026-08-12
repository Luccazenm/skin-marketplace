import type { User } from '@prisma/client';
import request from 'supertest';
import {
  corpo,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';

/**
 * A camada HTTP: é onde exceção vira status. Um 403 que escapa como 500
 * muda o que o usuário vê e esconde a causa do suporte.
 */
describe('AuthController', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561199000000100';
  const STEAM_ID_BANIDO = '76561199000000101';
  const TODOS = [STEAM_ID, STEAM_ID_BANIDO];

  const http = () => request(ctx.server);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Autenticado' },
    });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });
    await limparAuditoria(ctx);
    await ctx.close();
  });

  describe('GET /api/auth/steam', () => {
    it('redireciona para a Steam', async () => {
      const r = await http().get('/api/auth/steam').expect(302);

      expect(r.headers.location).toContain('steamcommunity.com/openid/login');
    });
  });

  describe('GET /api/auth/steam/return', () => {
    it('cria a sessão em cookie e manda para o frontend', async () => {
      ctx.steam.openId.verifyReturn.mockResolvedValue(STEAM_ID);

      const r = await http()
        .get('/api/auth/steam/return?openid.mode=id_res')
        .expect(302);

      expect(r.headers.location).toBe('http://localhost:5173');

      // httpOnly: JavaScript da página não pode ler a sessão.
      const cookie = String(r.headers['set-cookie']);
      expect(cookie).toContain('session=');
      expect(cookie).toContain('HttpOnly');
    });

    it('recusa retorno que a Steam não valida', async () => {
      ctx.steam.openId.verifyReturn.mockResolvedValue(null);

      await http().get('/api/auth/steam/return?openid.mode=id_res').expect(401);
    });

    it('recusa conta suspensa com 403, não 401', async () => {
      await ctx.prisma.user.create({
        data: {
          steamId: STEAM_ID_BANIDO,
          username: 'Suspenso',
          isBanned: true,
        },
      });
      ctx.steam.openId.verifyReturn.mockResolvedValue(STEAM_ID_BANIDO);

      // 403 e não 401: a diferença entre "não sei quem é você" e "sei, e
      // você não pode entrar" muda a mensagem que a tela mostra.
      await http().get('/api/auth/steam/return?openid.mode=id_res').expect(403);
    });
  });

  describe('GET /api/auth/me', () => {
    it('exige sessão', async () => {
      await http().get('/api/auth/me').expect(401);
    });

    it('devolve o perfil e o que a conta pode fazer', async () => {
      const r = await http()
        .get('/api/auth/me')
        .set(ctx.authFor(user))
        .expect(200);

      const me = corpo<{
        steamId: string;
        capabilities: { canSell: boolean };
        hasTradeUrl: boolean;
      }>(r);

      expect(me.steamId).toBe(STEAM_ID);
      expect(me.capabilities.canSell).toBe(true);
      expect(me.hasTradeUrl).toBe(false);
    });

    // Saldo como texto: Decimal vira número em JSON e 0.1+0.2 deixa de
    // ser 0.3. Em dinheiro isso não é aceitável.
    it('serializa o saldo como string', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { balance: '1234.56' },
      });

      const r = await http()
        .get('/api/auth/me')
        .set(ctx.authFor(user))
        .expect(200);

      expect(corpo<{ balance: string }>(r).balance).toBe('1234.56');
    });

    it('aceita sessão por cookie', async () => {
      const token = ctx.tokens.sign({ sub: user.id, steamId: user.steamId });

      await http()
        .get('/api/auth/me')
        .set('Cookie', [`session=${token}`])
        .expect(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('exige sessão', async () => {
      await http().post('/api/auth/logout').expect(401);
    });

    it('apaga o cookie e invalida o token', async () => {
      const auth = ctx.authFor(user);

      const r = await http().post('/api/auth/logout').set(auth).expect(201);

      expect(String(r.headers['set-cookie'])).toContain('session=;');

      // O mesmo token não vale mais �?" apagar o cookie não bastaria para
      // quem já tivesse copiado o valor.
      await http().get('/api/auth/me').set(auth).expect(401);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('derruba as demais sessões', async () => {
      const sessaoA = ctx.authFor(user);
      const sessaoB = ctx.authFor(user);

      await http().post('/api/auth/logout-all').set(sessaoA).expect(201);

      await http().get('/api/auth/me').set(sessaoB).expect(401);
    });
  });
});

async function limparAuditoria(ctx: TestApp) {
  await ctx.prisma.$executeRawUnsafe(
    'ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_sem_delete',
  );
  await ctx.prisma.auditLog.deleteMany({
    where: { metadata: { path: ['steamId'], string_starts_with: '765611990' } },
  });
  await ctx.prisma.$executeRawUnsafe(
    'ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_sem_delete',
  );
}
