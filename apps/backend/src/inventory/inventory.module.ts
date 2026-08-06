import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryCacheService } from './inventory-cache.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SteamInventoryService } from './steam-inventory.service';

@Module({
  // Precisa do AuthModule pelo JwtAuthGuard. RedisModule é global.
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService, SteamInventoryService, InventoryCacheService],
  exports: [InventoryService],
})
export class InventoryModule {}
