import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global, like AuditModule and for the same reason: any flow that ends
 * in something the user should be told about needs it, and re-importing
 * it everywhere would only add noise.
 */
@Global()
@Module({
  // Needs AuthModule for JwtAuthGuard.
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
