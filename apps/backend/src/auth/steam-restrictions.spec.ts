import { SteamEconomyBan } from '@prisma/client';
import { capabilitiesFor } from './steam-restrictions';

describe('capabilitiesFor', () => {
  const semRestricao = {
    steamEconomyBan: SteamEconomyBan.NONE,
    steamVacBanned: false,
  };

  it('libera tudo para conta sem restrição', () => {
    const cap = capabilitiesFor(semRestricao);

    expect(cap.canDeposit).toBe(true);
    expect(cap.canWithdraw).toBe(true);
    expect(cap.canSell).toBe(true);
    expect(cap.blockedReason).toBeNull();
    expect(cap.warnings).toHaveLength(0);
  });

  describe('economy ban', () => {
    it('bloqueia depósito e saque quando BANNED', () => {
      const cap = capabilitiesFor({
        ...semRestricao,
        steamEconomyBan: SteamEconomyBan.BANNED,
      });

      expect(cap.canDeposit).toBe(false);
      expect(cap.canWithdraw).toBe(false);
      expect(cap.blockedReason).toBeTruthy();
    });

    it('bloqueia depósito e saque quando PROBATION', () => {
      const cap = capabilitiesFor({
        ...semRestricao,
        steamEconomyBan: SteamEconomyBan.PROBATION,
      });

      expect(cap.canDeposit).toBe(false);
      expect(cap.canWithdraw).toBe(false);
    });

    // A regra mais importante do arquivo: o ban da Steam não pode virar
    // confisco nosso. Vender é a única liquidez que sobra para essa pessoa.
    it('NUNCA bloqueia a venda do que já está em custódia', () => {
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
    it('avisa mas não bloqueia nada sozinho', () => {
      const cap = capabilitiesFor({
        ...semRestricao,
        steamVacBanned: true,
      });

      // A Steam não informa de qual jogo é o VAC; bloquear seria punir
      // quem tomou ban em outro jogo qualquer.
      expect(cap.canDeposit).toBe(true);
      expect(cap.canWithdraw).toBe(true);
      expect(cap.blockedReason).toBeNull();
      expect(cap.warnings).toHaveLength(1);
    });
  });
});
