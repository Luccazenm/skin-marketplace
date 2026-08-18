import { accountIdOf, validateTradeUrl } from './trade-url';

// A real steamId64 used in manual testing, with its matching accountId
const STEAM_ID = '76561198832746931';
const PARTNER = '872481203';
const OTHER_STEAM_ID = '76561198000000001';

const validUrl = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;

describe('accountIdOf', () => {
  it('converts a steamID64 into an accountId', () => {
    expect(accountIdOf(STEAM_ID)).toBe(PARTNER);
  });

  // A steamID64 has 17 digits and exceeds Number.MAX_SAFE_INTEGER. Done
  // with a plain number, the arithmetic would lose exactly the final
  // digits — the ones telling one account from another.
  it('keeps precision on large ids', () => {
    expect(accountIdOf('76561199999999999')).toBe('2039734271');
    expect(accountIdOf('76561197960265729')).toBe('1');
  });

  it('refuses input that is not a steamID64', () => {
    expect(accountIdOf('123')).toBeNull();
    expect(accountIdOf('abc')).toBeNull();
    expect(accountIdOf('')).toBeNull();
  });
});

describe('validateTradeUrl', () => {
  it('accepts a correct trade URL from its own owner', () => {
    const r = validateTradeUrl(validUrl, STEAM_ID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partner).toBe(PARTNER);
    expect(r.token).toBe('Ab3xY9zQ');
  });

  // The central check: without it, the bot would deliver the skins to the
  // wrong account — and item delivery has no undo.
  it('REFUSES a trade URL from another account', () => {
    const r = validateTradeUrl(validUrl, OTHER_STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('partner_from_another_account');
  });

  it('refuses a domain that is not Steam', () => {
    const fake = `https://steamcommunlty.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;
    const r = validateTradeUrl(fake, STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_domain');
  });

  it('refuses http without TLS', () => {
    const r = validateTradeUrl(validUrl.replace('https:', 'http:'), STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_domain');
  });

  it('refuses another path on the right domain', () => {
    const r = validateTradeUrl(
      `https://steamcommunity.com/profiles/${STEAM_ID}`,
      STEAM_ID,
    );

    expect(r.ok).toBe(false);
  });

  it('refuses a link with no token', () => {
    const r = validateTradeUrl(
      `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}`,
      STEAM_ID,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('missing_token');
  });

  it('refuses text that is not a URL', () => {
    const r = validateTradeUrl('my trade link', STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_format');
  });

  it('tolerates surrounding whitespace, which shows up when pasting', () => {
    expect(validateTradeUrl(`  ${validUrl}  `, STEAM_ID).ok).toBe(true);
  });

  // We normalize because Steam sometimes appends parameters and people
  // paste the URL with leftovers.
  it('normalizes the stored URL, dropping extra parameters', () => {
    const dirty = `${validUrl}&utm_source=whatsapp&for_tradeoffer=1`;
    const r = validateTradeUrl(dirty, STEAM_ID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBe(validUrl);
  });
});
