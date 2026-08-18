import type { User } from '@prisma/client';
import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import { clearAuditLog } from '../test-utils/clear-audit-log';

describe('UsersController', () => {
  let ctx: TestApp;
  let user: User;

  // steamId real de teste e o partner correspondente
  const STEAM_ID = '76561198832746931';
  const PARTNER = '872481203';
  const TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;

  const http = () => request(ctx.server);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await limpar(ctx, STEAM_ID);
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Vendedor' },
    });
  });

  afterAll(async () => {
    await limpar(ctx, STEAM_ID);
    await ctx.close();
  });

  describe('PUT /api/users/me/trade-url', () => {
    it('exige sessão', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .send({ tradeUrl: TRADE_URL })
        .expect(401);
    });

    it('salva a trade URL do próprio dono', async () => {
      const r = await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL })
        .expect(200);

      expect(body<{ tradeUrl: string }>(r).tradeUrl).toBe(TRADE_URL);
    });

    // A recusa que impede o bot de entregar na conta errada.
    it('recusa trade URL de outra conta, explicando o motivo', async () => {
      const deOutro =
        'https://steamcommunity.com/tradeoffer/new/?partner=99999999&token=Ab3xY9zQ';

      const r = await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: deOutro })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain('outra conta');
    });

    it('recusa link de domínio parecido', async () => {
      const falso = TRADE_URL.replace('steamcommunity', 'steamcommunlty');

      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: falso })
        .expect(400);
    });

    it('normaliza a URL guardada', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: `  ${TRADE_URL}&utm_source=whatsapp  ` })
        .expect(200);

      const salvo = await ctx.prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(salvo!.tradeUrl).toBe(TRADE_URL);
    });

    it('recusa body sem o campo', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({})
        .expect(400);
    });

    // forbidNonWhitelisted: campo a mais indica cliente desatualizado ou
    // tentativa de mexer em algo que não é dele.
    it('recusa campo desconhecido no body', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL, isBanned: false })
        .expect(400);
    });

    it('deixa rastro do antes e depois na auditoria', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL })
        .expect(200);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'user.trade_url.updated' },
      });

      expect(log.metadata).toMatchObject({ from: null, to: TRADE_URL });
      expect(log.outcome).toBe('SUCCESS');
    });

    it('registra também a tentativa recusada', async () => {
      const deOutro =
        'https://steamcommunity.com/tradeoffer/new/?partner=99999999&token=Ab3xY9zQ';

      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: deOutro })
        .expect(400);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, outcome: 'DENIED' },
      });

      expect(log.metadata).toMatchObject({ error: 'partner_de_outra_conta' });
    });
  });
});

async function limpar(ctx: TestApp, steamId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { steamId } });

  if (user) {
    await clearAuditLog(ctx.prisma);
    await ctx.prisma.user.delete({ where: { id: user.id } });
  }
}
