import { Agent, ProxyAgent, type Dispatcher } from 'undici';

/**
 * One way out to Steam: a source address to bind to, or a proxy to go
 * through.
 *
 * Steam limits the inventory endpoint **per IP**, so this is what
 * capacity is measured in. One route is the machine's own address and
 * gives roughly 900 reads an hour; ten routes give ten times that, for
 * the price of ten addresses.
 */
export interface EgressRoute {
  /**
   * Stable name for this route, used as the Redis key for its rate
   * limit slot and its penalty. Derived from the configured value, so
   * the same address always maps to the same slot across restarts and
   * across API instances.
   */
  id: string;
  /** Null for the default route, which binds nothing. */
  dispatcher: Dispatcher | null;
}

/**
 * Reads the STEAM_EGRESS setting into routes.
 *
 * An empty setting yields exactly one route with no dispatcher — the
 * machine's own address, chosen by the operating system. That is both
 * the default and the current behaviour, so nothing downstream needs to
 * know whether this is configured.
 *
 * A malformed entry is skipped with its reason rather than throwing:
 * losing one address should cost that address's share of capacity, not
 * the ability to read inventories at all. An entry that binds to an
 * address the machine does not hold would fail on every call, which is
 * why the value is never guessed at or repaired.
 */
export function parseEgress(setting: string): {
  routes: EgressRoute[];
  skipped: string[];
} {
  const entries = setting
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (entries.length === 0) {
    return { routes: [{ id: 'default', dispatcher: null }], skipped: [] };
  }

  const routes: EgressRoute[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (entry.includes('://')) {
      try {
        routes.push({ id: entry, dispatcher: new ProxyAgent(entry) });
      } catch {
        skipped.push(`${entry} (not a usable proxy URL)`);
      }
      continue;
    }

    if (!isIpAddress(entry)) {
      skipped.push(`${entry} (not an IP address or a proxy URL)`);
      continue;
    }

    routes.push({
      id: entry,
      dispatcher: new Agent({ connect: { localAddress: entry } }),
    });
  }

  // Every entry was unusable: fall back to the default route rather than
  // leaving the site unable to read any inventory at all.
  if (routes.length === 0) {
    return { routes: [{ id: 'default', dispatcher: null }], skipped };
  }

  return { routes, skipped };
}

/**
 * Deliberately narrow: this value is bound to a socket, and anything
 * that is not an address the machine holds fails every call made
 * through it. A hostname would resolve — to somewhere we do not
 * control — so it is refused rather than accepted.
 */
function isIpAddress(value: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;

  if (ipv4.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }

  // IPv6, loosely: Steam publishes no AAAA record today, so this exists
  // only so a machine configured for it is not rejected out of hand.
  return value.includes(':') && /^[0-9a-fA-F:]+$/.test(value);
}
