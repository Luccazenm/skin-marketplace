import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditOutcome,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** Contexto de rede, para investigar padrão suspeito. */
export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  /** Convenção "dominio.acao" — ver AUDIT_ACTIONS. */
  action: string;
  outcome: AuditOutcome;
  targetType?: string;
  targetId?: string;
  /** Em alteração, guardar antes e depois. */
  metadata?: Prisma.InputJsonValue;
  context?: AuditContext;
}

/**
 * Escreve a trilha de auditoria.
 *
 * Serve para responder "essa pessoa está dizendo a verdade?" meses depois
 * de um item ou de um valor sumir. Por isso registra tanto o que deu certo
 * quanto o que foi recusado: uma sequência de recusas é um padrão de golpe
 * que só aparece se as tentativas ficarem gravadas.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra sem derrubar a operação.
   *
   * Falha ao auditar não pode impedir alguém de entrar no site. Para
   * operações que mexem em dinheiro, use recordInTransaction: ali o
   * registro precisa mesmo cair junto se algo der errado.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.write(this.prisma, entry);
    } catch (erro) {
      // Um registro perdido é ruim, mas derrubar a operação por causa
      // disso seria pior. Fica no log de aplicação para não sumir calado.
      this.logger.error(
        `Falha ao gravar auditoria de ${entry.action}: ${String(erro)}`,
      );
    }
  }

  /**
   * Registra dentro de uma transação já aberta.
   *
   * Use quando o registro precisa existir se e somente se a operação
   * existir — movimentação de saldo, mudança de dono de item. Aqui a falha
   * propaga de propósito: operação de dinheiro sem rastro é pior que
   * operação não realizada.
   */
  async recordInTransaction(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await this.write(tx, entry);
  }

  private async write(
    client: Prisma.TransactionClient | PrismaClient,
    entry: AuditEntry,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        outcome: entry.outcome,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata,
        ip: entry.context?.ip ?? null,
        userAgent: entry.context?.userAgent?.slice(0, 500) ?? null,
      },
    });
  }
}

/**
 * Extrai o contexto de rede da requisição.
 *
 * `req.ip` respeita o trust proxy do Express: atrás de proxy reverso, é
 * preciso configurá-lo, senão todo mundo aparece como o IP do proxy — e a
 * auditoria de rede não vale nada.
 */
export function auditContext(req: Request): AuditContext {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Ações conhecidas. Constantes em vez de texto solto para que uma consulta
 * por "todas as trocas de trade URL" não dependa de ninguém ter digitado
 * a mesma string duas vezes.
 */
export const AUDIT_ACTIONS = {
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
  TRADE_URL_UPDATED: 'user.trade_url.updated',
  DEPOSIT_REQUESTED: 'deposit.requested',
  BOT_REGISTERED: 'bot.registered',
} as const;

export { AuditActorType, AuditOutcome };
