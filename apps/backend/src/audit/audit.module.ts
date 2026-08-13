import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

/**
 * Global: praticamente todo módulo de domínio precisa auditar, e reimportar
 * em cada um só criaria ruído.
 */
@Global()
@Module({
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
