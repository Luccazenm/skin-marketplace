import { Injectable } from '@nestjs/common';
import { AuditOutcome, type AuditLog, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LinhaDoTempo {
  user: Pick<
    User,
    'id' | 'steamId' | 'username' | 'balance' | 'isBanned' | 'createdAt'
  >;
  eventos: AuditLog[];
  /** Quantos ficaram de fora do recorte pedido. */
  omitidos: number;
}

export interface AtorSuspeito {
  actorId: string | null;
  steamId: string | null;
  username: string | null;
  recusas: number;
  /** Motivos distintos, do mais frequente para o menos. */
  motivos: { acao: string; vezes: number }[];
  ips: string[];
  ultima: Date;
}

/**
 * Leitura da trilha de auditoria.
 *
 * Existe porque auditoria que ninguém consegue consultar é arquivo morto:
 * quando alguém abrir uma reclamação, é preciso montar a linha do tempo
 * daquela pessoa em minutos, não escrevendo SQL na hora.
 *
 * Só lê. Escrita fica no AuditService, e a tabela é imutável por trigger.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tudo que uma pessoa fez, do mais recente para o mais antigo.
   *
   * Aceita steamId ou o id interno: numa reclamação, o que chega é o
   * steamId, mas ao investigar a partir de outro registro o que se tem em
   * mãos é o uuid.
   */
  async timelineFor(
    identificador: string,
    opcoes: { limite?: number; desde?: Date } = {},
  ): Promise<LinhaDoTempo | null> {
    const limite = opcoes.limite ?? 100;

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ steamId: identificador }, { id: identificador }],
      },
      select: {
        id: true,
        steamId: true,
        username: true,
        balance: true,
        isBanned: true,
        createdAt: true,
      },
    });

    if (!user) {
      return null;
    }

    // Inclui o que a pessoa fez e o que foi feito sobre ela: uma ação
    // administrativa sobre a conta tem actorId de outro e apareceria só
    // pelo alvo.
    const where = {
      OR: [{ actorId: user.id }, { targetType: 'User', targetId: user.id }],
      ...(opcoes.desde ? { createdAt: { gte: opcoes.desde } } : {}),
    };

    const [eventos, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limite,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { user, eventos, omitidos: Math.max(0, total - eventos.length) };
  }

  /**
   * Quem acumulou recusas no período.
   *
   * Uma recusa isolada é engano comum — página desatualizada, item que
   * acabou de sair do inventário. Repetição é o que indica alguém testando
   * o sistema, e só aparece porque gravamos as tentativas negadas.
   */
  async suspiciousActivity(
    opcoes: { desde?: Date; minimoRecusas?: number } = {},
  ): Promise<AtorSuspeito[]> {
    const desde =
      opcoes.desde ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const minimo = opcoes.minimoRecusas ?? 3;

    const recusas = await this.prisma.auditLog.findMany({
      where: { outcome: AuditOutcome.DENIED, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
    });

    const porAtor = new Map<string, AuditLog[]>();

    for (const log of recusas) {
      // Sem ator identificado (tentativa anônima) agrupa por IP: é o
      // único fio que sobra para ligar as tentativas.
      const chave = log.actorId ?? `ip:${log.ip ?? 'desconhecido'}`;
      const lista = porAtor.get(chave) ?? [];
      lista.push(log);
      porAtor.set(chave, lista);
    }

    const comMuitas = [...porAtor.entries()].filter(
      ([, logs]) => logs.length >= minimo,
    );

    const usuarios = await this.prisma.user.findMany({
      where: { id: { in: comMuitas.map(([chave]) => chave) } },
      select: { id: true, steamId: true, username: true },
    });

    const porId = new Map(usuarios.map((u) => [u.id, u]));

    return comMuitas
      .map(([chave, logs]) => {
        const user = porId.get(chave);

        const contagem = new Map<string, number>();
        for (const l of logs) {
          contagem.set(l.action, (contagem.get(l.action) ?? 0) + 1);
        }

        return {
          actorId: user ? user.id : null,
          steamId: user?.steamId ?? null,
          username: user?.username ?? chave,
          recusas: logs.length,
          motivos: [...contagem.entries()]
            .map(([acao, vezes]) => ({ acao, vezes }))
            .sort((a, b) => b.vezes - a.vezes),
          ips: [
            ...new Set(
              logs.map((l) => l.ip).filter((ip): ip is string => !!ip),
            ),
          ],
          ultima: logs[0].createdAt,
        };
      })
      .sort((a, b) => b.recusas - a.recusas);
  }

  /**
   * Onde um item apareceu na trilha.
   *
   * Busca pelos operadores de JSON do Postgres, e não por texto: comparar
   * o JSON inteiro como string faz um assetId curto casar com pedaços de
   * outros identificadores — um steamId como 76561199000000002 contém
   * "00000000" e apareceria numa busca por esse asset.
   *
   * Dois formatos guardam assetId: `itens` (lista com nome, no registro de
   * sucesso) e `assetIds` (lista simples, no registro de recusa).
   *
   * Lembrando que o assetId muda a cada troca: para histórico completo é
   * preciso encadear os valores conhecidos daquele item.
   */
  async findByAssetId(assetId: string): Promise<AuditLog[]> {
    const emItens = JSON.stringify({ itens: [{ assetId }] });

    return this.prisma.$queryRaw<AuditLog[]>`
      SELECT * FROM "AuditLog"
      WHERE "metadata" @> ${emItens}::jsonb
         OR jsonb_exists("metadata" -> 'assetIds', ${assetId})
      ORDER BY "createdAt" DESC
      LIMIT 100
    `;
  }
}
