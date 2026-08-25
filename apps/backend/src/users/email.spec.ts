import { validateEmail } from './email';

/**
 * The rule is deliberately permissive: only sending to an address proves
 * it exists, so this rejects what cannot be an address rather than
 * guessing at what looks like one. These tests pin both halves of that —
 * the odd-but-valid addresses that must survive, and the inputs that
 * must not.
 */
describe('validateEmail', () => {
  it('lowercases and trims, so the unique index can do its job', () => {
    expect(validateEmail('  Lucca@NextSkins.GG  ')).toEqual({
      ok: true,
      email: 'lucca@nextskins.gg',
    });
  });

  // Every one of these is a real, deliverable address. A stricter
  // pattern would turn each into a user who cannot register the address
  // they actually own.
  it.each([
    'user+tag@gmail.com',
    "o'brien@example.com",
    'first.last@sub.domain.co.uk',
    'a@b.io',
    'user_name-123@example.marketing',
  ])('accepts %s', (address) => {
    expect(validateEmail(address).ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['no-at-sign.com', 'no_at'],
    ['two@at@signs.com', 'malformed'],
    ['@nodomain.com', 'malformed'],
    ['nolocal@', 'malformed'],
    ['dotless@domain', 'malformed'],
    ['trailing@dot.', 'malformed'],
    ['double@dots..com', 'malformed'],
    ['has space@example.com', 'whitespace'],
  ])('refuses %s', (input, error) => {
    expect(validateEmail(input)).toEqual({ ok: false, error });
  });

  // 254 is what a mail server accepts in transit; longer is guaranteed
  // to bounce, so it is refused here rather than at send time.
  it('refuses an address past 254 characters', () => {
    const long = `${'a'.repeat(250)}@example.com`;

    expect(long.length).toBeGreaterThan(254);
    expect(validateEmail(long)).toEqual({ ok: false, error: 'too_long' });
  });

  it('accepts an address at exactly 254', () => {
    const domain = '@example.com';
    const exact = `${'a'.repeat(254 - domain.length)}${domain}`;

    expect(exact.length).toBe(254);
    expect(validateEmail(exact).ok).toBe(true);
  });
});
