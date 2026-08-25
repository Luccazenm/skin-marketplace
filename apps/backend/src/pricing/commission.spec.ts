import {
  centsToUsd,
  commission,
  minimumListingCents,
  usdToCents,
} from './commission';

/**
 * The commission and the floor under it.
 *
 * This is the platform taking money out of somebody's sale, so both
 * directions are pinned: what we keep, and what is left. The invariant
 * that matters most is at the bottom — the minimum price has to be a
 * price the seller actually gets paid at.
 */
describe('commission', () => {
  const FEE = 5;

  it('takes the percentage on an ordinary sale', () => {
    expect(commission(10000, FEE)).toEqual({
      feeCents: 500,
      payoutCents: 9500,
    });
  });

  /**
   * The cent that cannot be split goes to the seller. It is one cent,
   * and it is the direction that does not need explaining.
   */
  it('rounds the percentage down, in the seller favour', () => {
    // 5% of 3.33 is 16.65 cents.
    expect(commission(333, FEE)).toEqual({ feeCents: 16, payoutCents: 317 });
  });

  /**
   * Below about $0.20 the percentage rounds to nothing. A sale that
   * moves an item and earns zero is one we pay for and record for free.
   */
  it('never takes less than a cent', () => {
    // 5% of $0.02 is a fifth of a cent.
    expect(commission(2, FEE)).toEqual({ feeCents: 1, payoutCents: 1 });
    // 5% of $0.19 is 0.95 of a cent — still rounds to nothing on its own.
    expect(commission(19, FEE)).toEqual({ feeCents: 1, payoutCents: 18 });
  });

  it('stops applying the floor once the percentage clears a cent', () => {
    // 5% of $0.20 is exactly a cent, so the floor stops mattering here.
    expect(commission(20, FEE).feeCents).toBe(1);
    expect(commission(40, FEE).feeCents).toBe(2);
  });
});

describe('minimumListingCents', () => {
  it('is two cents at the commission we charge', () => {
    expect(minimumListingCents(5)).toBe(2);
  });

  /**
   * The invariant the number exists for. Whatever the commission is,
   * the minimum price has to leave the seller something — a listing
   * that pays out zero is a giveaway with a ledger entry attached.
   */
  it.each([0, 1, 5, 10, 25, 50, 60])(
    'leaves the seller at least a cent at %i%%',
    (feePercent) => {
      const minimum = minimumListingCents(feePercent);

      expect(
        commission(minimum, feePercent).payoutCents,
      ).toBeGreaterThanOrEqual(1);
      // And it is the *smallest* such price: one cent less has to fail.
      expect(commission(minimum - 1, feePercent).payoutCents).toBeLessThan(1);
    },
  );

  /**
   * Two cents at every commission short of taking everything — and that
   * is a consequence of rounding the fee down, not a coincidence. At
   * two cents the percentage is under a cent for any rate below 100%,
   * so the floor of one cent is what applies, and one cent is left.
   *
   * Which is worth knowing before anyone reaches for this number: the
   * minimum will not move when the commission does. It moves if
   * `MINIMUM_FEE_CENTS` moves, or if the rounding stops favouring the
   * seller — and it is derived precisely so that it moves by itself
   * when either of those happens.
   */
  it.each([1, 25, 50, 75, 90, 99])('is still two cents at %i%%', (fee) => {
    expect(minimumListingCents(fee)).toBe(2);
  });

  it('refuses a commission that leaves nothing at any price', () => {
    expect(() => minimumListingCents(100)).toThrow(/PLATFORM_FEE_PERCENT/);
  });
});

describe('money strings', () => {
  it('formats cents with two decimals', () => {
    expect(centsToUsd(2)).toBe('0.02');
    expect(centsToUsd(100)).toBe('1.00');
    expect(centsToUsd(4250)).toBe('42.50');
  });

  it('reads a price string into cents', () => {
    expect(usdToCents('0.02')).toBe(2);
    expect(usdToCents('42.5')).toBe(4250);
    expect(usdToCents('7')).toBe(700);
  });

  // Anything that is not a plain price is refused rather than coerced:
  // this is the value that decides what somebody is paid.
  it('refuses what is not a price', () => {
    expect(usdToCents('1.005')).toBeNull();
    expect(usdToCents('-5')).toBeNull();
    expect(usdToCents('1e3')).toBeNull();
    expect(usdToCents('')).toBeNull();
  });
});
