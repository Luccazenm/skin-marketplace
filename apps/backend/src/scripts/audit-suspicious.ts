import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditQueryService } from '../audit/audit-query.service';

/**
 * Who accumulated refusals in the period.
 *
 *   pnpm build && pnpm audit:suspicious [-- --days=7 --minimum=3]
 *
 * A single refusal is a common mistake. Repetition is what indicates
 * someone probing the system — and it only shows up because we record
 * denied attempts too.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = args['days'] ? Number(args['days']) : 7;
  const minimum = args['minimum'] ? Number(args['minimum']) : 3;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const suspects = await app.get(AuditQueryService).suspiciousActivity({
      since: new Date(Date.now() - days * 86_400_000),
      minimumRefusals: minimum,
    });

    console.log('');
    console.log(
      `  Accounts with ${minimum}+ refusals in the last ${days} day(s): ${suspects.length}`,
    );
    console.log('  ' + '-'.repeat(70));

    if (suspects.length === 0) {
      console.log('  (nothing out of the ordinary)');
      console.log('');
      return;
    }

    for (const s of suspects) {
      console.log('');
      console.log(`  ${s.username ?? '(no identified user)'}`);

      if (s.steamId) {
        console.log(`    steamId   ${s.steamId}`);
      }

      console.log(`    refusals  ${s.refusals}`);
      console.log(
        `    last      ${s.last.toISOString().replace('T', ' ').slice(0, 19)}`,
      );

      for (const r of s.reasons) {
        console.log(`      ${r.times}x ${r.action}`);
      }

      // Several IPs for the same account in a short window signals a
      // shared or compromised account.
      if (s.ips.length > 0) {
        console.log(`    ips       ${s.ips.slice(0, 5).join(', ')}`);
      }

      if (s.actorId) {
        console.log(
          `    detail    pnpm audit:user -- --id=${s.steamId ?? s.actorId}`,
        );
      }
    }

    console.log('');
  } finally {
    await app.close();
  }
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
