import {
  GIVE_DISCOUNT,
  TAKE_PREMIUM,
  roundTripCost,
  valueGiving,
  valueTaking,
} from './trade-value';

/**
 * The two sides of a trade.
 *
 * What is pinned here is the gap between them, because the gap is the
 * business — and the direction of every rounding, because both sides
 * are money moving between us and somebody else.
 */
describe('trade value', () => {
  it('takes 5% off what you hand over', () => {
    expect(valueGiving(100000)).toBe(95000);
    expect(valueGiving(92962)).toBe(88314);
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
      expect(valueGiving(reference)).toBeLessThanOrEqual(
        valueTaking(reference),
      );
    },
  );

  /**
   * Under about a dime the two sides meet, and that is the rounding
   * doing its job rather than a bug: both directions round towards the
   * user, and on a nine-cent item the two roundings are worth more than
   * the 17% between them. We earn nothing on a trade of graffiti, which
   * is the correct amount to earn on a trade of graffiti.
   */
  it('has no spread left on the cheapest items', () => {
    expect(valueGiving(8)).toBe(valueTaking(8));
    // Nine cents is where they separate.
    expect(valueGiving(9)).toBeLessThan(valueTaking(9));
  });

  /**
   * Swapping a skin for an identical one costs the round trip. ~17.9%
   * against the 18.5% measured on CS.MONEY — the same order, slightly
   * cheaper, which is the position we chose.
   */
  it('costs about eighteen percent to swap a skin for its twin', () => {
    expect(roundTripCost()).toBeCloseTo(0.1789, 4);

    const reference = 92962;
    const cost = valueTaking(reference) - valueGiving(reference);
    expect(cost / valueGiving(reference)).toBeCloseTo(0.1789, 3);
  });

  /**
   * The odd cent goes to the user on both sides: up on what we credit
   * them, down on what we charge them. Read together, we never round
   * in our own favour.
   */
  describe('rounding', () => {
    it('rounds what we credit you up', () => {
      // 333 × 0.95 = 316.35
      expect(valueGiving(333)).toBe(317);
    });

    it('rounds what we charge you down', () => {
      // 333 × 1.12 = 372.96
      expect(valueTaking(333)).toBe(372);
    });

    // At the smallest price there is, neither side may round to nothing.
    it('never values an item at zero', () => {
      expect(valueGiving(2)).toBe(2);
      expect(valueTaking(2)).toBe(2);
    });
  });

  // The trade discount has to stay well under the buyout's, or we would
  // be charging for cash risk in an operation that spends stock.
  it('is gentler than the instant-sell discount', () => {
    expect(GIVE_DISCOUNT).toBeLessThan(0.1);
    expect(TAKE_PREMIUM).toBeLessThan(0.142);
  });
});
