import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

/**
 * Global: practically every domain module needs to audit, and
 * re-importing it in each one would only add noise.
 */
@Global()
@Module({
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
