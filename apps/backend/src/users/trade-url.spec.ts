import { accountIdDe, validarTradeUrl } from './trade-url';

// steamId64 real usado nos testes manuais, com seu accountId correspondente
const STEAM_ID = '76561198832746931';
const PARTNER = '872481203';
const OUTRO_STEAM_ID = '76561198000000001';

const urlValida = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;

describe('accountIdDe', () => {
  it('converte steamID64 em accountId', () => {
    expect(accountIdDe(STEAM_ID)).toBe(PARTNER);
  });

  // steamID64 tem 17 dígitos e passa de Number.MAX_SAFE_INTEGER. Feita com
  // número comum, a conta perderia justamente os dígitos finais — os que
  // distinguem uma conta de outra.
  it('mantém precisão em ids grandes', () => {
    expect(accountIdDe('76561199999999999')).toBe('2039734271');
    expect(accountIdDe('76561197960265729')).toBe('1');
  });

  it('recusa entrada que não é steamID64', () => {
    expect(accountIdDe('123')).toBeNull();
    expect(accountIdDe('abc')).toBeNull();
    expect(accountIdDe('')).toBeNull();
  });
});

describe('validarTradeUrl', () => {
  it('aceita uma trade URL correta do próprio dono', () => {
    const r = validarTradeUrl(urlValida, STEAM_ID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partner).toBe(PARTNER);
    expect(r.token).toBe('Ab3xY9zQ');
  });

  // A checagem central: sem ela, o bot entregaria as skins na conta errada
  // — e entrega de item não tem volta.
  it('RECUSA trade URL de outra conta', () => {
    const r = validarTradeUrl(urlValida, OUTRO_STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('partner_de_outra_conta');
  });

  it('recusa domínio que não é o da Steam', () => {
    const falso = `https://steamcommunlty.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;
    const r = validarTradeUrl(falso, STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('dominio_invalido');
  });

  it('recusa http sem TLS', () => {
    const r = validarTradeUrl(urlValida.replace('https:', 'http:'), STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('dominio_invalido');
  });

  it('recusa outro caminho no domínio certo', () => {
    const r = validarTradeUrl(
      `https://steamcommunity.com/profiles/${STEAM_ID}`,
      STEAM_ID,
    );

    expect(r.ok).toBe(false);
  });

  it('recusa link sem token', () => {
    const r = validarTradeUrl(
      `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}`,
      STEAM_ID,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('sem_token');
  });

  it('recusa texto que não é URL', () => {
    const r = validarTradeUrl('meu link de troca', STEAM_ID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe('formato_invalido');
  });

  it('tolera espaços em volta, que aparecem ao copiar e colar', () => {
    expect(validarTradeUrl(`  ${urlValida}  `, STEAM_ID).ok).toBe(true);
  });

  // Normalizamos porque a Steam às vezes acrescenta parâmetros e as
  // pessoas colam a URL com sobras.
  it('normaliza a URL guardada, descartando parâmetros extras', () => {
    const suja = `${urlValida}&utm_source=whatsapp&for_tradeoffer=1`;
    const r = validarTradeUrl(suja, STEAM_ID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBe(urlValida);
  });
});
