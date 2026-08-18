import { SteamEconomyBan } from '@prisma/client';
import { capabilitiesFor } from './steam-restrictions';

describe('capabilitiesFor', () => {
  const unrestricted = {
    steamEconomyBan: SteamEconomyBan.NONE,
    steamVacBanned: false,
  };

  it('allows everything for an unrestricted account', () => {
    const cap = capabilitiesFor(unrestricted);

    expect(cap.canDeposit).toBe(true);
    expect(cap.canWithdraw).toBe(true);
    expect(cap.canSell).toBe(true);
    expect(cap.blockedReason).toBeNull();
    expect(cap.warnings).toHaveLength(0);
  });

  describe('economy ban', () => {
    it('blocks deposit and withdrawal when BANNED', () => {
      const cap = capabilitiesFor({
        ...unrestricted,
        steamEconomyBan: SteamEconomyBan.BANNED,
      });

      expect(cap.canDeposit).toBe(false);
      expect(cap.canWithdraw).toBe(false);
      expect(cap.blockedReason).toBeTruthy();
    });

    it('blocks deposit and withdrawal when on PROBATION', () => {
      const cap = capabilitiesFor({
        ...unrestricted,
        steamEconomyBan: SteamEconomyBan.PROBATION,
      });

      expect(cap.canDeposit).toBe(false);
      expect(cap.canWithdraw).toBe(false);
    });

    // The most important rule in the file: a Steam ban must not become
    // confiscation by us. Selling is the only liquidity this person has
    // left.
    it('NEVER blocks selling what is already in custody', () => {
      for (const ban of [SteamEconomyBan.BANNED, SteamEconomyBan.PROBATION]) {
        const cap = capabilitiesFor({
          steamEconomyBan: ban,
          steamVacBanned: true,
        });

        expect(cap.canSell).toBe(true);
      }
    });
  });

  describe('VAC ban', () => {
    it('warns but blocks nothing on its own', () => {
      const cap = capabilitiesFor({
        ...unrestricted,
        steamVacBanned: true,
      });

      // Steam does not say which game the VAC is from; blocking would
      // punish someone banned in an entirely different game.
      expect(cap.canDeposit).toBe(true);
      expect(cap.canWithdraw).toBe(true);
      expect(cap.blockedReason).toBeNull();
      expect(cap.warnings).toHaveLength(1);
    });
  });
});
