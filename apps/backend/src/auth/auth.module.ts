import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionRevocationService } from './session-revocation.service';
import { SteamAccountStateService } from './steam-account-state.service';
import { SteamBanService } from './steam-ban.service';
import { SteamOpenIdService } from './steam-openid.service';
import { SteamProfileService } from './steam-profile.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SteamOpenIdService,
    SteamProfileService,
    SteamBanService,
    SteamAccountStateService,
    TokenService,
    SessionRevocationService,
    JwtAuthGuard,
  ],
  // Exported so the domain modules can protect their own routes
  exports: [TokenService, SessionRevocationService, JwtAuthGuard],
})
export class AuthModule {}
