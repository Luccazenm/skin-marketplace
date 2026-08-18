import { Injectable } from '@nestjs/common';
import { AuditOutcome, type AuditLog, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface Timeline {
  user: Pick<
    User,
    'id' | 'steamId' | 'username' | 'balance' | 'isBanned' | 'createdAt'
  >;
  events: AuditLog[];
  /** How many fell outside the requested window. */
  omitted: number;
}

export interface SuspiciousActor {
  actorId: string | null;
  steamId: string | null;
  username: string | null;
  refusals: number;
  /** Distinct reasons, most frequent first. */
  reasons: { action: string; times: number }[];
  ips: string[];
  last: Date;
}

/**
 * Reading the audit trail.
 *
 * It exists because an audit log nobody can query is a dead archive: when
 * someone files a complaint, you need that person's timeline in minutes,
 * not by writing SQL on the spot.
 *
 * Read-only. Writing lives in AuditService, and the table is immutable by
 * trigger.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything a person did, most recent first.
   *
   * Accepts a steamId or the internal id: in a complaint what arrives is
   * the steamId, but when investigating from another record what you have
   * in hand is the uuid.
   */
  async timelineFor(
    identifier: string,
    options: { limit?: number; since?: Date } = {},
  ): Promise<Timeline | null> {
    const limit = options.limit ?? 100;

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ steamId: identifier }, { id: identifier }],
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

    // Includes what the person did and what was done to them: an
    // administrative action on the account carries someone else's actorId
    // and would only show up through the target.
    const where = {
      OR: [{ actorId: user.id }, { targetType: 'User', targetId: user.id }],
      ...(options.since ? { createdAt: { gte: options.since } } : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { user, events, omitted: Math.max(0, total - events.length) };
  }

  /**
   * Who accumulated refusals in the period.
   *
   * A single refusal is a common mistake — a stale page, an item that
   * just left the inventory. Repetition is what indicates someone probing
   * the system, and it only shows up because we record denied attempts.
   */
  async suspiciousActivity(
    options: { since?: Date; minimumRefusals?: number } = {},
  ): Promise<SuspiciousActor[]> {
    const since =
      options.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const minimum = options.minimumRefusals ?? 3;

    const refusals = await this.prisma.auditLog.findMany({
      where: { outcome: AuditOutcome.DENIED, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });

    const byActor = new Map<string, AuditLog[]>();

    for (const log of refusals) {
      // With no identified actor (an anonymous attempt) we group by IP:
      // it is the only thread left tying the attempts together.
      const key = log.actorId ?? `ip:${log.ip ?? 'unknown'}`;
      const list = byActor.get(key) ?? [];
      list.push(log);
      byActor.set(key, list);
    }

    const withMany = [...byActor.entries()].filter(
      ([, logs]) => logs.length >= minimum,
    );

    const users = await this.prisma.user.findMany({
      where: { id: { in: withMany.map(([key]) => key) } },
      select: { id: true, steamId: true, username: true },
    });

    const byId = new Map(users.map((u) => [u.id, u]));

    return withMany
      .map(([key, logs]) => {
        const user = byId.get(key);

        const counts = new Map<string, number>();
        for (const l of logs) {
          counts.set(l.action, (counts.get(l.action) ?? 0) + 1);
        }

        return {
          actorId: user ? user.id : null,
          steamId: user?.steamId ?? null,
          username: user?.username ?? key,
          refusals: logs.length,
          reasons: [...counts.entries()]
            .map(([action, times]) => ({ action, times }))
            .sort((a, b) => b.times - a.times),
          ips: [
            ...new Set(
              logs.map((l) => l.ip).filter((ip): ip is string => !!ip),
            ),
          ],
          last: logs[0].createdAt,
        };
      })
      .sort((a, b) => b.refusals - a.refusals);
  }

  /**
   * Where an item appeared in the trail.
   *
   * Searches with Postgres JSON operators rather than by text: comparing
   * the whole JSON as a string makes a short assetId match fragments of
   * other identifiers — a steamId like 76561199000000002 contains
   * "00000000" and would show up in a search for that asset.
   *
   * Two shapes hold an assetId: `items` (a list with names, in the success
   * record) and `assetIds` (a plain list, in the refusal record).
   *
   * Remember that the assetId changes with every trade: for a full
   * history you have to chain the known values for that item.
   */
  async findByAssetId(assetId: string): Promise<AuditLog[]> {
    const inItems = JSON.stringify({ items: [{ assetId }] });

    return this.prisma.$queryRaw<AuditLog[]>`
      SELECT * FROM "AuditLog"
      WHERE "metadata" @> ${inItems}::jsonb
         OR jsonb_exists("metadata" -> 'assetIds', ${assetId})
      ORDER BY "createdAt" DESC
      LIMIT 100
    `;
  }
}
