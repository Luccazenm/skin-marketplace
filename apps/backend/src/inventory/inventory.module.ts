import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { SteamInventoryService } from './steam-inventory.service';

@Module({
  // Precisa do AuthModule pelo JwtAuthGuard
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [SteamInventoryService],
  exports: [SteamInventoryService],
})
export class InventoryModule {}
