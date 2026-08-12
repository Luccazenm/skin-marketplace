import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
