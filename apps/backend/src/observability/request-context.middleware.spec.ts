import type { NextFunction, Request, Response } from 'express';
import { contextoAtual, enriquecerContexto } from './request-context';
import { requestContextMiddleware } from './request-context.middleware';

describe('requestContextMiddleware', () => {
  const requisicao = (headers: Record<string, string> = {}): Request =>
    ({
      headers,
      ip: '203.0.113.9',
      method: 'GET',
      path: '/api/inventory',
    }) as unknown as Request;

  const resposta = () => {
    const cabecalhos: Record<string, string> = {};
    return {
      cabecalhos,
      res: {
        setHeader: (nome: string, valor: string) => {
          cabecalhos[nome] = valor;
        },
      } as unknown as Response,
    };
  };

  it('abre o contexto com dados da requisição', () => {
    const { res } = resposta();
    let visto: ReturnType<typeof contextoAtual>;

    requestContextMiddleware(requisicao(), res, (() => {
      visto = contextoAtual();
    }) as NextFunction);

    expect(visto!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(visto!.ip).toBe('203.0.113.9');
    expect(visto!.method).toBe('GET');
    expect(visto!.path).toBe('/api/inventory');
  });

  // Devolvido ao cliente: vira o número de protocolo que o usuário pode
  // informar ao relatar um erro.
  it('devolve o id no cabeçalho da resposta', () => {
    const { cabecalhos, res } = resposta();

    requestContextMiddleware(requisicao(), res, (() => {}) as NextFunction);

    expect(cabecalhos['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  // Mesmo id no proxy e aqui: é o que permite seguir uma requisição
  // atravessando as camadas.
  it('reaproveita o id enviado pelo proxy', () => {
    const { cabecalhos, res } = resposta();
    let visto: ReturnType<typeof contextoAtual>;

    requestContextMiddleware(
      requisicao({ 'x-request-id': 'proxy-abc-123' }),
      res,
      (() => {
        visto = contextoAtual();
      }) as NextFunction,
    );

    expect(visto!.requestId).toBe('proxy-abc-123');
    expect(cabecalhos['x-request-id']).toBe('proxy-abc-123');
  });

  describe('id vindo de fora com formato inválido', () => {
    // Sem validar, alguém injetaria quebra de linha e forjaria entradas
    // no log — o que arruinaria a investigação que o log deveria apoiar.
    it.each([
      ['com quebra de linha', 'abc\n{"level":"info","msg":"forjado"}'],
      ['curto demais', 'abc'],
      ['com espaço', 'id falso'],
      ['longo demais', 'x'.repeat(200)],
    ])('gera um novo quando o id vem %s', (_caso, valor) => {
      const { res } = resposta();
      let visto: ReturnType<typeof contextoAtual>;

      requestContextMiddleware(
        requisicao({ 'x-request-id': valor }),
        res,
        (() => {
          visto = contextoAtual();
        }) as NextFunction,
      );

      expect(visto!.requestId).not.toBe(valor);
      expect(visto!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('dá ids diferentes a requisições diferentes', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 3; i++) {
      const { res } = resposta();
      requestContextMiddleware(requisicao(), res, (() => {
        ids.add(contextoAtual()!.requestId);
      }) as NextFunction);
    }

    expect(ids.size).toBe(3);
  });

  describe('enriquecerContexto', () => {
    // O guard usa isto: quando a requisição chega não se sabe quem é, e o
    // userId só existe depois de autenticar.
    it('acrescenta o userId ao contexto aberto', () => {
      const { res } = resposta();
      let visto: ReturnType<typeof contextoAtual>;

      requestContextMiddleware(requisicao(), res, (() => {
        enriquecerContexto({ userId: 'user-789' });
        visto = contextoAtual();
      }) as NextFunction);

      expect(visto!.userId).toBe('user-789');
      // Não apaga o que já estava
      expect(visto!.ip).toBe('203.0.113.9');
    });

    it('não estoura fora de requisição', () => {
      expect(() => enriquecerContexto({ userId: 'x' })).not.toThrow();
    });
  });
});
