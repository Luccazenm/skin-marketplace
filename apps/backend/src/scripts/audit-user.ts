import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditQueryService } from '../audit/audit-query.service';

/**
 * A user's timeline.
 *
 *   pnpm build && pnpm audit:user -- --id=76561198832746931 [--days=30]
 *
 * Built to be read in the middle of a complaint: who, when, from where,
 * and what changed. Accepts a steamId (what the user gives you) or the
 * internal id.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identifier = args['id'];

  if (!identifier) {
    console.error(
      'Usage: pnpm audit:user -- --id=<steamID64 or internal id> [--days=N] [--limit=N]',
    );
    process.exit(1);
  }

  const days = args['days'] ? Number(args['days']) : undefined;
  const limit = args['limit'] ? Number(args['limit']) : 100;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const result = await app.get(AuditQueryService).timelineFor(identifier, {
      limit,
      since: days ? new Date(Date.now() - days * 86_400_000) : undefined,
    });

    if (!result) {
      console.error(`No user found for "${identifier}"`);
      process.exit(1);
    }

    const { user, events, omitted } = result;

    console.log('');
    console.log(`  ${user.username}`);
    console.log(`  steamId    ${user.steamId}`);
    console.log(`  id         ${user.id}`);
    console.log(`  balance    US$ ${user.balance.toString()}`);
    console.log(`  signed up  ${formatDate(user.createdAt)}`);
    if (user.isBanned) {
      console.log(`  SUSPENDED`);
    }
    console.log('');
    console.log(
      `  ${events.length} event(s)` +
        (days ? ` in the last ${days} days` : '') +
        (omitted > 0 ? `, ${omitted} older ones omitted` : ''),
    );
    console.log('  ' + '-'.repeat(70));

    if (events.length === 0) {
      console.log('  (nothing recorded)');
    }

    for (const e of events) {
      const mark =
        e.outcome === 'SUCCESS' ? ' ' : e.outcome === 'DENIED' ? '!' : 'x';

      console.log(
        `  ${mark} ${formatDate(e.createdAt)}  ${e.action.padEnd(26)} ${e.outcome}`,
      );

      if (e.ip) {
        console.log(`      from ${e.ip}`);
      }

      for (const line of detail(e.metadata)) {
        console.log(`      ${line}`);
      }
    }

    console.log('');
  } finally {
    await app.close();
  }
}

/**
 * Shows what matters from the metadata, without dumping raw JSON.
 * A change becomes "from X to Y", which is the shape that settles a
 * dispute.
 */
function detail(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const data = metadata as Record<string, unknown>;
  const lines: string[] = [];

  if ('from' in data || 'to' in data) {
    lines.push(`from: ${value(data.from)}`);
    lines.push(`to:   ${value(data.to)}`);
  }

  if (typeof data.reason === 'string') {
    lines.push(`reason: ${data.reason}`);
  }

  if (typeof data.error === 'string') {
    lines.push(`error: ${data.error}`);
  }

  if (Array.isArray(data.items)) {
    for (const item of data.items as { assetId?: string; name?: string }[]) {
      lines.push(`item: ${item.name ?? '?'} (asset ${item.assetId ?? '?'})`);
    }
  }

  if (typeof data.botSteamId === 'string') {
    lines.push(`bot: ${data.botSteamId}`);
  }

  if (data.firstLogin === true) {
    lines.push('first sign-in');
  }

  return lines;
}

/** Metadata is free-form JSON: a field can be an object and print as "[object Object]". */
function value(v: unknown): string {
  if (v === null || v === undefined) return '(empty)';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) {
      out[m[1]] = m[2];
    }
  }

  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
