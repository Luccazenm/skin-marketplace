import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cliente Redis compartilhado. Além do cache, é o que vai sustentar a fila
 * do BullMQ no worker de trocas.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    super(config.getOrThrow<string>('REDIS_URL'), {
      // O BullMQ exige null aqui, e é o comportamento que queremos: falhar
      // rápido em vez de acumular comandos numa conexão morta.
      maxRetriesPerRequest: null,
    });

    this.on('error', (erro: Error) => {
      this.logger.error(`Redis: ${erro.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
