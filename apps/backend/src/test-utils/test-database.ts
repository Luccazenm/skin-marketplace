/**
 * Endereços do ambiente de teste, derivados dos de desenvolvimento.
 *
 * Derivar em vez de manter um `.env.test` é proposital: um segundo
 * arquivo de configuração seria mais uma coisa para desincronizar, e
 * ninguém percebe que ele ficou para trás até os testes rodarem no lugar
 * errado.
 */

const SUFIXO = '_test';

/**
 * Troca o nome do banco por `<nome>_test`, preservando usuário, senha,
 * host, porta e parâmetros.
 */
export function urlDeTeste(url: string): string {
  const u = new URL(url);
  const nome = u.pathname.replace(/^\//, '');

  if (!nome) {
    throw new Error(`DATABASE_URL sem nome de banco: ${mascarar(url)}`);
  }

  u.pathname = `/${nome.endsWith(SUFIXO) ? nome : nome + SUFIXO}`;

  return u.toString();
}

/**
 * Redis numerado à parte.
 *
 * O limitador global da Steam vive em Redis, e é estado compartilhado
 * como qualquer outro: um teste que gasta a cota faria o seguinte tomar
 * 429 sem ter chamado nada.
 */
export function redisDeTeste(url: string): string {
  const u = new URL(url);
  u.pathname = '/1';

  return u.toString();
}

/** Nome do banco, para mensagens e para criar o banco. */
export function nomeDoBanco(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/**
 * Barreira: recusa rodar contra banco que não seja o de teste.
 *
 * Sem isto, apontar os testes para o endereço errado apagaria dado real —
 * e o pior caso não é perder o catálogo, é o `DISABLE TRIGGER` da
 * limpeza desligar a imutabilidade da auditoria num banco que importa.
 *
 * A checagem é pelo sufixo do nome, e não por host: banco de produção
 * pode estar em localhost num túnel SSH, e "é local, então pode" é
 * exatamente o raciocínio que destrói dado.
 */
export function exigirBancoDeTeste(url: string): void {
  const nome = nomeDoBanco(url);

  if (!nome.endsWith(SUFIXO)) {
    throw new Error(
      `Os testes se recusam a rodar contra "${nome}": o nome do banco ` +
        `precisa terminar em "${SUFIXO}".\n` +
        `A suíte limpa tabelas inteiras — rodar no banco errado apaga ` +
        `dado real.`,
    );
  }
}

/** Esconde a senha ao logar ou lançar erro com a URL. */
export function mascarar(url: string): string {
  try {
    const u = new URL(url);

    if (u.password) {
      u.password = '***';
    }

    return u.toString();
  } catch {
    return '(url inválida)';
  }
}
