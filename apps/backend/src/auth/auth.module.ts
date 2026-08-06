import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SteamOpenIdService } from './steam-openid.service';
import { SteamProfileService } from './steam-profile.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SteamOpenIdService, SteamProfileService],
})
export class AuthModule {}
