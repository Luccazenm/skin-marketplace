import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogSyncService } from './catalog-sync.service';

@Module({
  imports: [PrismaModule],
  providers: [CatalogSyncService],
  exports: [CatalogSyncService],
})
export class CatalogModule {}
