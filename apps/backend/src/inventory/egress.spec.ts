import { parseEgress } from './egress';

/**
 * Steam limits the inventory endpoint per IP, so this list is the site's
 * inventory capacity. Getting it wrong silently is the failure that
 * matters: an address that is dropped, or one that is accepted and then
 * fails every call it is bound to.
 */
describe('parseEgress', () => {
  // The default, and the behaviour the site has had all along: one way
  // out, chosen by the operating system.
  it('yields one route with no dispatcher when unset', () => {
    const { routes, skipped } = parseEgress('');

    expect(routes).toEqual([{ id: 'default', dispatcher: null }]);
    expect(skipped).toEqual([]);
  });

  it('treats whitespace as unset', () => {
    expect(parseEgress('   ').routes).toHaveLength(1);
    expect(parseEgress(' , , ').routes[0].id).toBe('default');
  });

  it('reads a list of addresses', () => {
    const { routes } = parseEgress('203.0.113.7, 203.0.113.8,203.0.113.9');

    expect(routes.map((r) => r.id)).toEqual([
      '203.0.113.7',
      '203.0.113.8',
      '203.0.113.9',
    ]);
    // Each gets its own way out, or they would share one queue and the
    // extra addresses would buy nothing.
    expect(routes.every((r) => r.dispatcher !== null)).toBe(true);
  });

  it('reads a proxy URL', () => {
    const { routes } = parseEgress('http://user:pass@proxy.example:8080');

    expect(routes).toHaveLength(1);
    expect(routes[0].dispatcher).not.toBeNull();
  });

  it('mixes addresses and proxies', () => {
    const { routes } = parseEgress('203.0.113.7,http://proxy.example:8080');

    expect(routes.map((r) => r.id)).toEqual([
      '203.0.113.7',
      'http://proxy.example:8080',
    ]);
  });

  // The id becomes the Redis key for that route's rate limit slot, so it
  // has to survive a restart and be the same across API instances.
  it('names each route after what was configured', () => {
    const { routes } = parseEgress('203.0.113.7,203.0.113.8');

    expect(routes.map((r) => r.id)).toEqual(['203.0.113.7', '203.0.113.8']);
  });

  describe('refusing what would fail on every call', () => {
    // A hostname resolves — to a machine we do not control. Bound to a
    // socket it is not a source address, and every call through it dies.
    it.each([
      ['a hostname', 'steam-egress.example.com'],
      ['an octet above 255', '203.0.113.999'],
      ['a partial address', '203.0.113'],
      ['a word', 'default'],
    ])('skips %s', (_label, entry) => {
      const { routes, skipped } = parseEgress(entry);

      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain(entry);
      // Falls back rather than leaving the site unable to read anything.
      expect(routes).toEqual([{ id: 'default', dispatcher: null }]);
    });

    // Losing one address should cost that address's share of capacity,
    // not the ability to read inventories at all.
    it('keeps the good entries and reports the bad', () => {
      const { routes, skipped } = parseEgress(
        '203.0.113.7,nonsense,203.0.113.8',
      );

      expect(routes.map((r) => r.id)).toEqual(['203.0.113.7', '203.0.113.8']);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain('nonsense');
    });
  });
});
