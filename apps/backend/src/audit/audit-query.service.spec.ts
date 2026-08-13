import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditActorType, AuditOutcome, type User } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryService } from './audit-query.service';
import { AUDIT_ACTIONS, AuditService } from './audit.service';

/**
 * A consulta é o que torna a auditoria útil: registro que ninguém
 * consegue ler não resolve reclamação nenhuma.
 */
describe('AuditQueryService', () => {
  let query: AuditQueryService;
  let audit: AuditService;
  let prisma: PrismaService;

  const STEAM_ID = '76561199000000200';
  const STEAM_ID_OUTRO = '76561199000000201';
  const TODOS = [STEAM_ID, STEAM_ID_OUTRO];

  let user: User;
  let outro: User;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [AuditQueryService, AuditService, PrismaService],
    }).compile();

    query = moduleRef.get(AuditQueryService);
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await limpar(prisma, TODOS);

    user = await prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Reclamante' },
    });
    outro = await prisma.user.create({
      data: { steamId: STEAM_ID_OUTRO, username: 'Terceiro' },
    });
  });

  afterAll(async () => {
    await limpar(prisma, TODOS);
    await prisma.$disconnect();
  });

  describe('timelineFor', () => {
    it('encontra pelo steamId, que é o que o usuário informa', async () => {
      const r = await query.timelineFor(STEAM_ID);

      expect(r).not.toBeNull();
      expect(r!.user.id).toBe(user.id);
    });

    it('encontra também pelo id interno', async () => {
      const r = await query.timelineFor(user.id);

      expect(r!.user.steamId).toBe(STEAM_ID);
    });

    it('devolve null para identificador desconhecido', async () => {
      await expect(query.timelineFor('nao-existe')).resolves.toBeNull();
    });

    it('lista os eventos do mais recente para o mais antigo', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
        outcome: AuditOutcome.SUCCESS,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.eventos).toHaveLength(2);
      expect(r!.eventos[0].action).toBe('user.trade_url.updated');
    });

    // Sem isso, a linha do tempo de quem reclama viria misturada com a de
    // todo mundo.
    it('não traz evento de outro usuário', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: outro.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.eventos).toHaveLength(0);
    });

    // Ação administrativa sobre a conta tem outro ator: apareceria só pelo
    // alvo, e é exatamente o tipo de evento que importa numa disputa.
    it('traz evento em que a pessoa é alvo, não autora', async () => {
      await audit.record({
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: 'admin.ajuste',
        outcome: AuditOutcome.SUCCESS,
        targetType: 'User',
        targetId: user.id,
      });

      const r = await query.timelineFor(STEAM_ID);

      expect(r!.eventos).toHaveLength(1);
      expect(r!.eventos[0].action).toBe('admin.ajuste');
    });

    it('respeita o limite e informa quantos ficaram de fora', async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({
          actorType: AuditActorType.USER,
          actorId: user.id,
          action: AUDIT_ACTIONS.LOGIN,
          outcome: AuditOutcome.SUCCESS,
        });
      }

      const r = await query.timelineFor(STEAM_ID, { limite: 2 });

      expect(r!.eventos).toHaveLength(2);
      expect(r!.omitidos).toBe(3);
    });

    it('filtra por período', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
      });

      const futuro = new Date(Date.now() + 60_000);
      const r = await query.timelineFor(STEAM_ID, { desde: futuro });

      expect(r!.eventos).toHaveLength(0);
    });
  });

  describe('suspiciousActivity', () => {
    const recusar = (u: User, acao: string, ip = '203.0.113.9') =>
      audit.record({
        actorType: AuditActorType.USER,
        actorId: u.id,
        action: acao,
        outcome: AuditOutcome.DENIED,
        context: { ip },
      });

    it('ignora quem tem poucas recusas', async () => {
      await recusar(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED);

      const r = await query.suspiciousActivity({ minimoRecusas: 3 });

      expect(r.find((s) => s.steamId === STEAM_ID)).toBeUndefined();
    });

    // O padrão que motiva registrar recusas: alguém testando o sistema.
    it('aponta quem repete recusas', async () => {
      for (let i = 0; i < 4; i++) {
        await recusar(user, AUDIT_ACTIONS.TRADE_URL_UPDATED);
      }

      const r = await query.suspiciousActivity({ minimoRecusas: 3 });
      const achado = r.find((s) => s.steamId === STEAM_ID);

      expect(achado).toBeDefined();
      expect(achado!.recusas).toBe(4);
      expect(achado!.motivos[0]).toEqual({
        acao: 'user.trade_url.updated',
        vezes: 4,
      });
    });

    it('não conta operação bem-sucedida', async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({
          actorType: AuditActorType.USER,
          actorId: user.id,
          action: AUDIT_ACTIONS.LOGIN,
          outcome: AuditOutcome.SUCCESS,
        });
      }

      const r = await query.suspiciousActivity({ minimoRecusas: 3 });

      expect(r.find((s) => s.steamId === STEAM_ID)).toBeUndefined();
    });

    it('reúne os IPs usados', async () => {
      await recusar(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.1');
      await recusar(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.2');
      await recusar(user, AUDIT_ACTIONS.DEPOSIT_REQUESTED, '203.0.113.1');

      const r = await query.suspiciousActivity({ minimoRecusas: 3 });
      const achado = r.find((s) => s.steamId === STEAM_ID)!;

      expect(achado.ips.sort()).toEqual(['203.0.113.1', '203.0.113.2']);
    });

    it('ordena do mais recusado para o menos', async () => {
      for (let i = 0; i < 3; i++) await recusar(outro, 'x.y');
      for (let i = 0; i < 6; i++) await recusar(user, 'x.y');

      const r = await query.suspiciousActivity({ minimoRecusas: 3 });

      expect(r[0].steamId).toBe(STEAM_ID);
    });

    it('respeita o período', async () => {
      for (let i = 0; i < 4; i++) await recusar(user, 'x.y');

      const r = await query.suspiciousActivity({
        desde: new Date(Date.now() + 60_000),
        minimoRecusas: 3,
      });

      expect(r).toHaveLength(0);
    });
  });

  describe('findByAssetId', () => {
    it('acha o registro pelo assetId dentro do metadata', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          itens: [{ assetId: '44556677', nome: 'AK-47 | Redline' }],
        },
      });

      const r = await query.findByAssetId('44556677');

      expect(r).toHaveLength(1);
      expect(r[0].action).toBe('deposit.requested');
    });

    it('acha também no formato de recusa, que só tem os ids', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
        outcome: AuditOutcome.DENIED,
        metadata: { motivo: 'item_nao_depositavel', assetIds: ['99887766'] },
      });

      const r = await query.findByAssetId('99887766');

      expect(r).toHaveLength(1);
      expect(r[0].outcome).toBe(AuditOutcome.DENIED);
    });

    it('não devolve nada para assetId sem registro', async () => {
      await expect(query.findByAssetId('12312312312')).resolves.toHaveLength(0);
    });

    // Regressão: a primeira versão comparava o JSON inteiro como texto, e
    // "00000000" casava com steamIds como 76561199000000002.
    it('não casa com trecho de outro identificador', async () => {
      await audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.SUCCESS,
        metadata: { steamId: '76561199000000002' },
      });

      await expect(query.findByAssetId('00000000')).resolves.toHaveLength(0);
    });
  });
});

async function limpar(prisma: PrismaService, steamIds: string[]) {
  const users = await prisma.user.findMany({
    where: { steamId: { in: steamIds } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  await prisma.$executeRawUnsafe(
    'ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_sem_delete',
  );
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_sem_delete',
  );

  await prisma.user.deleteMany({ where: { steamId: { in: steamIds } } });
}
