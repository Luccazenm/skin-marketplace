import {
  ConsoleLogger,
  type LoggerService,
  type LogLevel,
} from '@nestjs/common';
import { contextoAtual } from './request-context';

/**
 * Campos que nunca devem sair no log, mesmo que alguém os inclua sem
 * pensar. Comparação por substring e sem diferenciar maiúsculas, para
 * pegar variações como `jwtSecret`, `steam_api_key` ou `sharedSecret`.
 */
const SEGREDOS = [
  'senha',
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
];

/**
 * Log em JSON, com o identificador da requisição em cada linha.
 *
 * Texto solto obriga a ler linha a linha; em JSON dá para filtrar por
 * usuário, por requisição ou por nível — que é o que se quer às duas da
 * manhã com alguém reclamando.
 *
 * Não substitui a trilha de auditoria: isto aqui serve para depurar
 * problema técnico e some quando o container reinicia. Quem responde "o
 * que aconteceu com essa pessoa" é o AuditLog, que vive no banco e não
 * pode ser alterado.
 */
export class StructuredLogger implements LoggerService {
  private readonly console = new ConsoleLogger();

  constructor(private readonly json: boolean) {}

  log(message: unknown, context?: string): void {
    this.emitir('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.emitir('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.emitir('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emitir('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emitir('verbose', message, context);
  }

  private emitir(
    nivel: LogLevel | 'info',
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    if (!this.json) {
      // Em desenvolvimento, legibilidade vale mais que estrutura.
      this.console.setContext(context ?? 'App');
      const ctx = contextoAtual();
      const prefixo = ctx ? `[${ctx.requestId.slice(0, 8)}] ` : '';
      const texto = `${prefixo}${this.texto(message)}`;

      if (nivel === 'error') this.console.error(texto, trace);
      else if (nivel === 'warn') this.console.warn(texto);
      else if (nivel === 'debug') this.console.debug(texto);
      else this.console.log(texto);

      return;
    }

    const ctx = contextoAtual();

    const linha = {
      ts: new Date().toISOString(),
      level: nivel,
      ctx: context,
      msg: this.texto(message),
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      ip: ctx?.ip,
      method: ctx?.method,
      path: ctx?.path,
      trace,
    };

    // Uma linha por evento: é o formato que agregadores de log esperam.
    process.stdout.write(`${JSON.stringify(limpar(linha))}\n`);
  }

  private texto(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;

    try {
      return JSON.stringify(limpar(message));
    } catch {
      return '[mensagem não serializável]';
    }
  }
}

/**
 * Remove campos vazios e mascara o que parece segredo.
 *
 * A máscara é rede de proteção, não permissão para logar credencial: o
 * certo continua sendo não passar isso adiante. Mas um objeto inteiro
 * despejado num log de erro é acidente comum, e o custo de proteger é
 * baixo.
 */
function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6 || valor === null || valor === undefined) {
    return valor ?? undefined;
  }

  if (Array.isArray(valor)) {
    return valor.map((v) => limpar(v, profundidade + 1));
  }

  if (typeof valor !== 'object') {
    return valor;
  }

  const saida: Record<string, unknown> = {};

  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    if (v === undefined) {
      continue;
    }

    const nome = chave.toLowerCase();

    if (SEGREDOS.some((s) => nome.includes(s))) {
      saida[chave] = '[oculto]';
      continue;
    }

    saida[chave] = limpar(v, profundidade + 1);
  }

  return saida;
}
