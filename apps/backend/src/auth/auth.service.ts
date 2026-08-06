import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SteamProfileService } from './steam-profile.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly steamProfile: SteamProfileService,
  ) {}

  /**
   * Recebe um steamId JÁ VALIDADO pelo OpenID e devolve o usuário
   * correspondente, criando-o no primeiro login.
   *
   * Nunca chamar com um steamId que não passou por SteamOpenIdService.
   */
  async loginWithSteam(steamId: string): Promise<User> {
    const perfil = await this.steamProfile.fetchProfile(steamId);
    const agora = new Date();

    const user = await this.prisma.user.upsert({
      where: { steamId },

      // Primeiro login: cria a conta.
      create: {
        steamId,
        // Sem perfil disponível o steamId serve de nome até a próxima
        // sincronização. É feio, mas é melhor que barrar o cadastro.
        username: perfil?.username ?? steamId,
        avatarUrl: perfil?.avatarUrl,
        profileUrl: perfil?.profileUrl,
        steamCreatedAt: perfil?.steamCreatedAt,
        lastLoginAt: agora,
      },

      // Logins seguintes: só o que a Steam é dona.
      // balance, isBanned, tradeUrl, email e isPlatform NÃO entram aqui —
      // são estado nosso e sobrescrevê-los com dados da Steam apagaria
      // saldo e banimento a cada login.
      update: {
        ...(perfil
          ? {
              username: perfil.username,
              avatarUrl: perfil.avatarUrl,
              profileUrl: perfil.profileUrl,
              steamCreatedAt: perfil.steamCreatedAt,
            }
          : {}),
        lastLoginAt: agora,
      },
    });

    // Checado depois do upsert de propósito: queremos o lastLoginAt
    // registrado mesmo em tentativa de acesso de conta banida.
    if (user.isBanned) {
      this.logger.warn(`Login recusado para conta banida: ${steamId}`);
      throw new ForbiddenException('Esta conta está suspensa');
    }

    // A conta da plataforma existe só como contraparte contábil e não tem
    // dono. Um steamId real tem 17 dígitos e nunca colide com o sentinela,
    // mas a checagem fica como rede de proteção.
    if (user.isPlatform) {
      this.logger.error(
        `Tentativa de login na conta da plataforma via steamId ${steamId}`,
      );
      throw new ForbiddenException('Conta indisponível');
    }

    return user;
  }
}
