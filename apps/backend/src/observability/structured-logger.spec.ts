import { StructuredLogger } from './structured-logger';
import { executarComContexto } from './request-context';

describe('StructuredLogger', () => {
  let escrito: string[];
  let stdoutMock: jest.SpyInstance;
  let logger: StructuredLogger;

  const ultimaLinha = () =>
    JSON.parse(escrito[escrito.length - 1]) as Record<string, unknown>;

  beforeEach(() => {
    escrito = [];
    stdoutMock = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        escrito.push(String(chunk));
        return true;
      });

    logger = new StructuredLogger(true);
  });

  afterEach(() => {
    stdoutMock.mockRestore();
  });

  it('emite uma linha JSON por evento', () => {
    logger.log('mensagem de teste', 'MeuServico');

    expect(escrito).toHaveLength(1);
    expect(escrito[0].endsWith('\n')).toBe(true);

    const linha = ultimaLinha();
    expect(linha.level).toBe('info');
    expect(linha.msg).toBe('mensagem de teste');
    expect(linha.ctx).toBe('MeuServico');
    expect(linha.ts).toBeDefined();
  });

  it('registra o nível de cada método', () => {
    logger.warn('a', 'X');
    expect(ultimaLinha().level).toBe('warn');

    logger.error('b', 'trace aqui', 'X');
    expect(ultimaLinha().level).toBe('error');
    expect(ultimaLinha().trace).toBe('trace aqui');

    logger.debug('c', 'X');
    expect(ultimaLinha().level).toBe('debug');
  });

  describe('contexto da requisição', () => {
    // O motivo de tudo isso: sem o requestId, os logs de uma falha ficam
    // espalhados no meio dos de todas as outras requisições simultâneas.
    it('inclui requestId e dados da requisição', () => {
      executarComContexto(
        {
          requestId: 'req-123',
          userId: 'user-456',
          ip: '203.0.113.5',
          method: 'POST',
          path: '/api/deposits',
        },
        () => logger.log('depósito enfileirado', 'DepositsService'),
      );

      const linha = ultimaLinha();
      expect(linha.requestId).toBe('req-123');
      expect(linha.userId).toBe('user-456');
      expect(linha.ip).toBe('203.0.113.5');
      expect(linha.method).toBe('POST');
      expect(linha.path).toBe('/api/deposits');
    });

    // O contexto atravessa await: um log lá no fundo da cadeia sai com o
    // mesmo id, sem ninguém precisar passar isso como parâmetro.
    it('sobrevive a await', async () => {
      await executarComContexto({ requestId: 'req-async' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger.log('depois do await', 'X');
      });

      expect(ultimaLinha().requestId).toBe('req-async');
    });

    it('funciona fora de requisição, sem contexto', () => {
      logger.log('rotina de inicialização', 'Bootstrap');

      const linha = ultimaLinha();
      expect(linha.msg).toBe('rotina de inicialização');
      expect(linha.requestId).toBeUndefined();
    });
  });

  describe('mascaramento', () => {
    // Rede de proteção: o certo é não passar credencial adiante, mas
    // despejar um objeto inteiro num log de erro é acidente comum.
    it('oculta campos que parecem segredo', () => {
      logger.log(
        {
          usuario: 'mazzo',
          password: 'senha-real',
          jwtSecret: 'abc123',
          steam_api_key: 'chave',
          authorization: 'Bearer xyz',
          sessionToken: 'tok',
        },
        'X',
      );

      const msg = JSON.parse(String(ultimaLinha().msg)) as Record<
        string,
        unknown
      >;

      expect(msg.usuario).toBe('mazzo');
      expect(msg.password).toBe('[oculto]');
      expect(msg.jwtSecret).toBe('[oculto]');
      expect(msg.steam_api_key).toBe('[oculto]');
      expect(msg.authorization).toBe('[oculto]');
      expect(msg.sessionToken).toBe('[oculto]');
    });

    it('oculta em objeto aninhado', () => {
      logger.log({ req: { headers: { cookie: 'session=abc' } } }, 'X');

      const msg = JSON.parse(String(ultimaLinha().msg)) as {
        req: { headers: { cookie: string } };
      };

      expect(msg.req.headers.cookie).toBe('[oculto]');
    });

    it('oculta dentro de lista', () => {
      logger.log({ contas: [{ nome: 'bot1', password: 'x' }] }, 'X');

      const msg = JSON.parse(String(ultimaLinha().msg)) as {
        contas: { nome: string; password: string }[];
      };

      expect(msg.contas[0].nome).toBe('bot1');
      expect(msg.contas[0].password).toBe('[oculto]');
    });

    it('não estoura com referência circular', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      expect(() => logger.log(circular, 'X')).not.toThrow();
      expect(ultimaLinha().msg).toBeDefined();
    });
  });

  it('extrai a mensagem de um Error', () => {
    logger.error(new Error('algo quebrou'), undefined, 'X');

    expect(ultimaLinha().msg).toBe('algo quebrou');
  });

  describe('modo desenvolvimento', () => {
    // Em dev, legibilidade vale mais que estrutura — e sair JSON no
    // terminal atrapalharia mais do que ajudaria.
    it('escreve texto legível, não JSON', () => {
      const dev = new StructuredLogger(false);

      dev.log('mensagem de dev', 'MeuServico');

      const saida = escrito.join('');
      expect(saida).toContain('mensagem de dev');
      expect(() => {
        JSON.parse(saida);
      }).toThrow();
    });

    // Um prefixo curto basta para separar requisições concorrentes no
    // terminal; o id inteiro só atrapalharia a leitura.
    it('mostra o começo do requestId como prefixo', () => {
      const dev = new StructuredLogger(false);

      executarComContexto(
        { requestId: 'abcdef12-3456-7890-abcd-ef1234567890' },
        () => dev.log('com contexto', 'X'),
      );

      expect(escrito.join('')).toContain('[abcdef12]');
    });
  });
});
