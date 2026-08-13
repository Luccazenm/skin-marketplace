import { SteamEconomyBan } from '@prisma/client';
import type { SteamAccountState } from '../auth/steam-account-state.service';
import type { SteamBanStatus } from '../auth/steam-ban.service';
import { impedimentosParaOperar, perfilEstaPublico } from './bot-eligibility';

const semBan: SteamBanStatus = {
  economyBan: SteamEconomyBan.NONE,
  vacBanned: false,
};

const contaOk: SteamAccountState = {
  isLimited: false,
  privacyState: 'public',
  tradeBanState: 'None',
};

const motivos = (
  ban: SteamBanStatus | null,
  estado: SteamAccountState | null,
) => impedimentosParaOperar(ban, estado).map((i) => i.motivo);

describe('impedimentosParaOperar', () => {
  it('não impede uma conta em ordem', () => {
    expect(impedimentosParaOperar(semBan, contaOk)).toEqual([]);
  });

  // O caso que motivou tudo isto: conta recém-criada passa por toda
  // checagem de ban e mesmo assim não negocia.
  it('impede conta limitada, mesmo sem ban nenhum', () => {
    expect(motivos(semBan, { ...contaOk, isLimited: true })).toEqual([
      'conta_limitada',
    ]);
  });

  it('impede restrição de economia', () => {
    expect(
      motivos({ ...semBan, economyBan: SteamEconomyBan.BANNED }, contaOk),
    ).toEqual(['restricao_de_economia']);
  });

  // PROBATION não é bloqueio definitivo da Valve, mas é conta sob
  // observação — não é onde se guarda item de terceiro.
  it('impede também em probation', () => {
    expect(
      motivos({ ...semBan, economyBan: SteamEconomyBan.PROBATION }, contaOk),
    ).toEqual(['restricao_de_economia']);
  });

  it('impede VAC ban', () => {
    expect(motivos({ ...semBan, vacBanned: true }, contaOk)).toEqual([
      'vac_ban',
    ]);
  });

  it('acumula impedimentos em vez de parar no primeiro', () => {
    expect(
      motivos(
        { economyBan: SteamEconomyBan.BANNED, vacBanned: true },
        { ...contaOk, isLimited: true },
      ),
    ).toEqual(['conta_limitada', 'restricao_de_economia', 'vac_ban']);
  });

  describe('quando não foi possível apurar', () => {
    // null é incerteza, não reprovação. Tratar indisponibilidade da Steam
    // como impedimento travaria o cadastro em dia de instabilidade; quem
    // chama é que decide o que fazer com a dúvida.
    it('não impede quando o estado da conta é desconhecido', () => {
      expect(impedimentosParaOperar(semBan, null)).toEqual([]);
    });

    it('não impede quando o status de ban é desconhecido', () => {
      expect(impedimentosParaOperar(null, contaOk)).toEqual([]);
    });

    it('não impede quando nada pôde ser apurado', () => {
      expect(impedimentosParaOperar(null, null)).toEqual([]);
    });
  });

  it('diz o que fazer, não só o que falhou', () => {
    for (const i of impedimentosParaOperar(
      { economyBan: SteamEconomyBan.BANNED, vacBanned: true },
      { ...contaOk, isLimited: true },
    )) {
      expect(i.comoResolver.length).toBeGreaterThan(0);
      expect(i.rotulo.length).toBeGreaterThan(0);
    }
  });
});

describe('perfilEstaPublico', () => {
  it('reconhece perfil público', () => {
    expect(perfilEstaPublico(contaOk)).toBe(true);
  });

  it.each(['private', 'friendsonly', null])(
    'trata %s como não público',
    (privacyState) => {
      expect(perfilEstaPublico({ ...contaOk, privacyState })).toBe(false);
    },
  );

  it('trata desconhecido como não público', () => {
    expect(perfilEstaPublico(null)).toBe(false);
  });
});
