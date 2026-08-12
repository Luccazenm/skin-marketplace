import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global: praticamente todo módulo de domínio precisa auditar, e reimportar
 * em cada um só criaria ruído.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
