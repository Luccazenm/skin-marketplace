import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
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
    TokenService,
    JwtAuthGuard,
  ],
  // Exportados para os módulos de domínio protegerem suas rotas
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
