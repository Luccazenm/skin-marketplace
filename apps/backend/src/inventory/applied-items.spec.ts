import { extrairAplicados } from './applied-items';

/**
 * HTML copiado de uma resposta real da Steam, sem edição.
 * Se a Valve mudar o formato, estes testes quebram — que é o objetivo.
 */
const STICKER_INFO_REAL =
  '<br><div id="sticker_info" class="sticker_info" style="border: 2px solid rgb(102, 102, 102); border-radius: 6px; width=100; margin:4px; padding:8px;"><center>' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/recoil/ak47_recoil_gold.bd3d66b2215a95ed966dce1dbc907b6594ed050f.png" title="Sticker: Hello AK-47 (Gold)">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/mystik.458d518d5985d780551ea60ce2c8c9ff92830efe.png" title="Sticker: Clan-Mystik | Katowice 2014">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/dignitas.e1d16be85014b4f04fa93f06a62a7068235fd56f.png" title="Sticker: Team Dignitas | Katowice 2014">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/titan.c6594b1f3592efec6f5261228f9e5a90a45760a6.png" title="Sticker: Titan | Katowice 2014">' +
  '<br>Sticker: Hello AK-47 (Gold), Clan-Mystik | Katowice 2014, Team Dignitas | Katowice 2014, Titan | Katowice 2014</center></div>';

const KEYCHAIN_INFO_REAL =
  '<br><div id="keychain_info" class="keychain_info" style="border: 2px solid rgb(102, 102, 102);"><center>' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/keychains/missinglink/kc_missinglink_guerilla.8cfcb67206c227f0961b95eda81d2f49efc879be.png" title="Charm: Lil\' Crass">' +
  "<br>Charm: Lil' Crass</center></div>";

describe('extrairAplicados', () => {
  it('lê os quatro stickers de uma AK real', () => {
    const r = extrairAplicados([
      { name: 'sticker_info', value: STICKER_INFO_REAL },
    ]);

    expect(r).toHaveLength(4);
    expect(r.map((a) => a.name)).toEqual([
      'Hello AK-47 (Gold)',
      'Clan-Mystik | Katowice 2014',
      'Team Dignitas | Katowice 2014',
      'Titan | Katowice 2014',
    ]);
    expect(r.every((a) => a.kind === 'STICKER')).toBe(true);
    expect(r[0].imageUrl).toContain('ak47_recoil_gold');
  });

  // A ordem é a posição no slot: um Katowice na posição 1 vale diferente
  // do mesmo sticker na posição 3.
  it('numera as posições na ordem em que a Steam devolve', () => {
    const r = extrairAplicados([
      { name: 'sticker_info', value: STICKER_INFO_REAL },
    ]);

    expect(r.map((a) => a.position)).toEqual([0, 1, 2, 3]);
  });

  // O nome do bloco é keychain_info, mas o title diz "Charm". Usamos o
  // title, que é o que a Valve mostra ao usuário.
  it('lê chaveiro apesar do nome do bloco divergir', () => {
    const r = extrairAplicados([
      { name: 'keychain_info', value: KEYCHAIN_INFO_REAL },
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('CHARM');
    expect(r[0].name).toBe("Lil' Crass");
  });

  it('junta stickers e chaveiro do mesmo item, numerando por tipo', () => {
    const r = extrairAplicados([
      { name: 'sticker_info', value: STICKER_INFO_REAL },
      { name: 'keychain_info', value: KEYCHAIN_INFO_REAL },
    ]);

    expect(r).toHaveLength(5);
    // A contagem de posição é por tipo: o chaveiro é o 0 dele, não o 4.
    expect(r.find((a) => a.kind === 'CHARM')!.position).toBe(0);
  });

  it('lê patch de agente', () => {
    const html =
      '<div id="patch_info"><center>' +
      '<img src="https://cdn/patch1.png" title="Patch: Guerrilla Warfare">' +
      '</center></div>';

    const r = extrairAplicados([{ name: 'patch_info', value: html }]);

    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('PATCH');
    expect(r[0].name).toBe('Guerrilla Warfare');
  });

  it('decodifica entidades HTML no nome', () => {
    const html =
      '<div id="sticker_info">' +
      '<img src="https://cdn/x.png" title="Sticker: Fnatic &amp; Co (Foil)">' +
      '</div>';

    const r = extrairAplicados([{ name: 'sticker_info', value: html }]);

    expect(r[0].name).toBe('Fnatic & Co (Foil)');
  });

  it('ignora blocos que não são de aplicação', () => {
    const r = extrairAplicados([
      { name: 'description', value: '<img src="x" title="Sticker: Falso">' },
      { name: 'exterior_wear', value: 'Factory New' },
      { name: 'blank', value: ' ' },
    ]);

    expect(r).toHaveLength(0);
  });

  it('devolve lista vazia sem estourar quando não há descrições', () => {
    expect(extrairAplicados(undefined)).toEqual([]);
    expect(extrairAplicados([])).toEqual([]);
    expect(extrairAplicados([{ name: 'sticker_info' }])).toEqual([]);
  });
});
