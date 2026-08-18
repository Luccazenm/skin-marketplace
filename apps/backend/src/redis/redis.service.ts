import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * The shared Redis client. Beyond the cache, it is what will carry
 * BullMQ's queue in the trade worker.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    super(config.getOrThrow<string>('REDIS_URL'), {
      // BullMQ requires null here, and it is the behaviour we want: fail
      // fast instead of piling up commands on a dead connection.
      maxRetriesPerRequest: null,
    });

    this.on('error', (error: Error) => {
      this.logger.error(`Redis: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
