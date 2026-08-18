import type { PrismaService } from '../prisma/prisma.service';

/**
 * Empties the audit log between tests.
 *
 * Uses TRUNCATE, which **does not fire the immutability trigger** — that
 * one is `BEFORE DELETE FOR EACH ROW`, and TRUNCATE never goes row by
 * row. In other words: the protection stays on the whole time.
 *
 * This replaces the `ALTER TABLE ... DISABLE TRIGGER` the tests used to
 * do. That turned immutability off for the **entire table** during the
 * cleanup: a test dying between the disable and the enable left the audit
 * log unprotected in silence, and pointing the suite at the wrong
 * database turned the protection off there.
 *
 * It is only safe because the test database is isolated and disposable —
 * the barrier guaranteeing that lives in `test-database.ts`.
 */
export async function clearAuditLog(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"');
}
