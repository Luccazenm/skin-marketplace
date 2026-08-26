import {
  TAKE_PREMIUM,
  roundTripCost,
  valueGiving,
  valueTaking,
} from './trade-value';

/** The commission we charge today. The rule is the sell flow's own. */
const FEE = 5;

const giving = (cents: number) => valueGiving(cents, FEE);

/**
 * The two sides of a trade.
 *
 * What is pinned here is the gap between them, because the gap is the
 * business — and the direction of every rounding, because both sides
 * are money moving between us and somebody else.
 */
describe('trade value', () => {
  it('takes 5% off what you hand over', () => {
    expect(giving(100000)).toBe(95000);
    expect(giving(92962)).toBe(88314);
  });

  /**
   * The same rule the sell flow runs, not a rate that matches it — so
   * the minimum fee applies here too. An item worth a cent credits
   * nothing: the floor is the whole of it.
   *
   * That is what stands in for a rule about junk. Half a real inventory
   * prices at a cent, and none of it is worth anything in a trade
   * without anybody having to write that down as a limit.
   */
  it('credits nothing for an item worth a cent', () => {
    expect(giving(1)).toBe(0);
  });

  it('leaves the minimum fee applying below twenty cents', () => {
    // 5% of anything under 20¢ rounds under a cent, so the floor bites.
    expect(giving(2)).toBe(1);
    expect(giving(19)).toBe(18);
    expect(giving(20)).toBe(19);
    // Past that the percentage takes over.
    expect(giving(40)).toBe(38);
  });

  it('adds 12% to what you take', () => {
    expect(valueTaking(100000)).toBe(112000);
    expect(valueTaking(92962)).toBe(104117);
  });

  /**
   * The same item is never worth more coming from you than going to
   * you. That is the whole reason there are two functions rather than
   * one, and it has to hold at every price.
   */
  it.each([2, 19, 100, 3080, 92962, 1115942])(
    'never values your side above ours at %i cents',
    (reference) => {
      expect(giving(reference)).toBeLessThanOrEqual(valueTaking(reference));
    },
  );

  // The gap is widest in relative terms at the bottom, because the
  // minimum fee is a bigger share of a small price than 5% is.
  it('keeps a real gap even on the cheapest items', () => {
    expect(giving(8)).toBe(7);
    expect(valueTaking(8)).toBe(8);
  });

  /**
   * Swapping a skin for an identical one costs the round trip. ~17.9%
   * against the 18.5% measured on CS.MONEY — the same order, slightly
   * cheaper, which is the position we chose.
   */
  it('costs about eighteen percent to swap a skin for its twin', () => {
    expect(roundTripCost(FEE)).toBeCloseTo(0.1789, 4);

    const reference = 92962;
    const cost = valueTaking(reference) - giving(reference);
    expect(cost / giving(reference)).toBeCloseTo(0.1789, 3);
  });

  /**
   * The odd cent goes to the user on both sides: up on what we credit
   * them, down on what we charge them. Read together, we never round
   * in our own favour.
   */
  describe('rounding', () => {
    it('rounds what we credit you up', () => {
      // The fee is floored at 16 of 16.65, so the payout keeps the rest.
      expect(giving(333)).toBe(317);
    });

    it('rounds what we charge you down', () => {
      // 333 × 1.12 = 372.96
      expect(valueTaking(333)).toBe(372);
    });

    // What we charge never rounds to nothing, whatever the price.
    it('never charges zero for an item we hand over', () => {
      expect(valueTaking(1)).toBeGreaterThan(0);
      expect(valueTaking(2)).toBeGreaterThan(0);
    });
  });

  // The trade discount has to stay well under the buyout's, or we would
  // be charging for cash risk in an operation that spends stock.
  it('is gentler than the instant-sell discount', () => {
    // The buyout takes 10% at its kindest; the trade takes the market's
    // 5%, because it spends stock rather than cash.
    expect(1 - giving(100000) / 100000).toBeLessThan(0.1);
    expect(TAKE_PREMIUM).toBeLessThan(0.142);
  });
});
