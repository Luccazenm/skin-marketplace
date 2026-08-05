import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SteamOpenIdService } from './steam-openid.service';

@Module({
  controllers: [AuthController],
  providers: [SteamOpenIdService],
})
export class AuthModule {}
