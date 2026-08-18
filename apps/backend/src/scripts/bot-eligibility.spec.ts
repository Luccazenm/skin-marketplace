import { SteamEconomyBan } from '@prisma/client';
import type { SteamAccountState } from '../auth/steam-account-state.service';
import type { SteamBanStatus } from '../auth/steam-ban.service';
import { blockersToOperate, profileIsPublic } from './bot-eligibility';

const noBan: SteamBanStatus = {
  economyBan: SteamEconomyBan.NONE,
  vacBanned: false,
};

const goodAccount: SteamAccountState = {
  isLimited: false,
  privacyState: 'public',
  tradeBanState: 'None',
};

const reasons = (ban: SteamBanStatus | null, state: SteamAccountState | null) =>
  blockersToOperate(ban, state).map((b) => b.reason);

describe('blockersToOperate', () => {
  it('does not block an account in good standing', () => {
    expect(blockersToOperate(noBan, goodAccount)).toEqual([]);
  });

  // The case that motivated all of this: a freshly created account passes
  // every ban check and still cannot trade.
  it('blocks a limited account, even with no ban at all', () => {
    expect(reasons(noBan, { ...goodAccount, isLimited: true })).toEqual([
      'limited_account',
    ]);
  });

  it('blocks an economy restriction', () => {
    expect(
      reasons({ ...noBan, economyBan: SteamEconomyBan.BANNED }, goodAccount),
    ).toEqual(['economy_restriction']);
  });

  // PROBATION is not a permanent Valve block, but it is an account under
  // watch — not where you keep someone else's items.
  it('blocks on probation too', () => {
    expect(
      reasons({ ...noBan, economyBan: SteamEconomyBan.PROBATION }, goodAccount),
    ).toEqual(['economy_restriction']);
  });

  it('blocks a VAC ban', () => {
    expect(reasons({ ...noBan, vacBanned: true }, goodAccount)).toEqual([
      'vac_ban',
    ]);
  });

  it('accumulates blockers instead of stopping at the first', () => {
    expect(
      reasons(
        { economyBan: SteamEconomyBan.BANNED, vacBanned: true },
        { ...goodAccount, isLimited: true },
      ),
    ).toEqual(['limited_account', 'economy_restriction', 'vac_ban']);
  });

  describe('when it could not be determined', () => {
    // null is uncertainty, not rejection. Treating a Steam outage as a
    // blocker would freeze registration on a bad day; the caller decides
    // what to do with the doubt.
    it('does not block when the account state is unknown', () => {
      expect(blockersToOperate(noBan, null)).toEqual([]);
    });

    it('does not block when the ban status is unknown', () => {
      expect(blockersToOperate(null, goodAccount)).toEqual([]);
    });

    it('does not block when nothing could be determined', () => {
      expect(blockersToOperate(null, null)).toEqual([]);
    });
  });

  it('says what to do, not just what failed', () => {
    for (const b of blockersToOperate(
      { economyBan: SteamEconomyBan.BANNED, vacBanned: true },
      { ...goodAccount, isLimited: true },
    )) {
      expect(b.howToFix.length).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
    }
  });
});

describe('profileIsPublic', () => {
  it('recognises a public profile', () => {
    expect(profileIsPublic(goodAccount)).toBe(true);
  });

  it.each(['private', 'friendsonly', null])(
    'treats %s as not public',
    (privacyState) => {
      expect(profileIsPublic({ ...goodAccount, privacyState })).toBe(false);
    },
  );

  it('treats unknown as not public', () => {
    expect(profileIsPublic(null)).toBe(false);
  });
});
