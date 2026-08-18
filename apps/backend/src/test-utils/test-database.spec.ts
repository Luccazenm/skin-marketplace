import {
  exigirBancoDeTeste,
  mascarar,
  nomeDoBanco,
  redisDeTeste,
  urlDeTeste,
} from './test-database';

/**
 * Um erro aqui não faz teste falhar — faz teste rodar contra o banco de
 * verdade e apagar dado real. É o arquivo mais barato de testar e o mais
 * caro de errar.
 */
describe('urlDeTeste', () => {
  it('acrescenta o sufixo ao nome do banco', () => {
    expect(
      urlDeTeste('postgresql://postgres:senha@localhost:5432/skin_marketplace'),
    ).toBe('postgresql://postgres:senha@localhost:5432/skin_marketplace_test');
  });

  it('preserva usuário, senha, host e porta', () => {
    const u = new URL(
      urlDeTeste('postgresql://alguem:s3nh4@db.interno:6543/loja'),
    );

    expect(u.username).toBe('alguem');
    expect(u.password).toBe('s3nh4');
    expect(u.hostname).toBe('db.interno');
    expect(u.port).toBe('6543');
  });

  it('preserva parâmetros de conexão', () => {
    expect(urlDeTeste('postgresql://u:p@h:5432/loja?schema=public')).toContain(
      'schema=public',
    );
  });

  // Idempotente: chamar duas vezes não produz "loja_test_test".
  it('não duplica o sufixo', () => {
    const uma = urlDeTeste('postgresql://u:p@h:5432/loja');

    expect(urlDeTeste(uma)).toBe(uma);
  });

  it('recusa URL sem nome de banco', () => {
    expect(() => urlDeTeste('postgresql://u:p@h:5432')).toThrow(
      /sem nome de banco/,
    );
  });

  // Mensagem de erro é lugar clássico de vazar senha em log.
  it('não expõe a senha ao reclamar', () => {
    expect(() => urlDeTeste('postgresql://u:s3nh4@h:5432')).toThrow(/\*\*\*/);
    expect(() => urlDeTeste('postgresql://u:s3nh4@h:5432')).not.toThrow(
      /s3nh4/,
    );
  });
});

describe('redisDeTeste', () => {
  // O limitador global da Steam vive no Redis: um teste que gasta a cota
  // faria o seguinte tomar 429 sem ter chamado nada.
  it('aponta para outro banco do Redis', () => {
    expect(redisDeTeste('redis://localhost:6379')).toBe(
      'redis://localhost:6379/1',
    );
  });

  it('troca o banco quando já havia um', () => {
    expect(redisDeTeste('redis://localhost:6379/0')).toBe(
      'redis://localhost:6379/1',
    );
  });
});

describe('exigirBancoDeTeste', () => {
  it('deixa passar o banco de teste', () => {
    expect(() =>
      exigirBancoDeTeste('postgresql://u:p@h:5432/skin_marketplace_test'),
    ).not.toThrow();
  });

  // A suíte limpa tabelas inteiras e desliga trigger; rodar isso no banco
  // de desenvolvimento já custou o catálogo poluído e o usuário real
  // apagado.
  it('barra o banco de desenvolvimento', () => {
    expect(() =>
      exigirBancoDeTeste('postgresql://u:p@h:5432/skin_marketplace'),
    ).toThrow(/skin_marketplace/);
  });

  // "É localhost, então pode" é exatamente o raciocínio que destrói dado:
  // produção pode estar em localhost por um túnel SSH.
  it('barra mesmo em localhost', () => {
    expect(() =>
      exigirBancoDeTeste('postgresql://u:p@localhost:5432/producao'),
    ).toThrow();
  });

  it('não se deixa enganar por sufixo no meio do nome', () => {
    expect(() =>
      exigirBancoDeTeste('postgresql://u:p@h:5432/skin_test_producao'),
    ).toThrow();
  });
});

describe('nomeDoBanco', () => {
  it('extrai o nome', () => {
    expect(nomeDoBanco('postgresql://u:p@h:5432/loja_test')).toBe('loja_test');
  });
});

describe('mascarar', () => {
  it('esconde a senha', () => {
    expect(mascarar('postgresql://u:s3nh4@h:5432/loja')).not.toContain('s3nh4');
  });

  it('não estoura com url inválida', () => {
    expect(mascarar('nada disso')).toBe('(url inválida)');
  });
});
