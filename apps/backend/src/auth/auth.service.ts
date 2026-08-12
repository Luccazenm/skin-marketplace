import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  type AuditContext,
} from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SteamBanService } from './steam-ban.service';
import { SteamProfileService } from './steam-profile.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly steamProfile: SteamProfileService,
    private readonly steamBan: SteamBanService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recebe um steamId JÁ VALIDADO pelo OpenID e devolve o usuário
   * correspondente, criando-o no primeiro login.
   *
   * Nunca chamar com um steamId que não passou por SteamOpenIdService.
   */
  async loginWithSteam(steamId: string, context?: AuditContext): Promise<User> {
    const agora = new Date();

    // Barreiras que rodam ANTES de qualquer escrita.
    //
    // A ordem importa: uma tentativa de login numa conta protegida não pode
    // modificar essa conta antes de ser recusada. Fazer o upsert primeiro
    // deixava quem tentou entrar sobrescrever nome e avatar da conta alvo.
    const existente = await this.prisma.user.findUnique({
      where: { steamId },
      select: { id: true, isPlatform: true, isBanned: true },
    });

    // Conta de sistema é intocável: nem escreve, nem responde nada útil.
    if (existente?.isPlatform) {
      this.logger.error(
        `Tentativa de login na conta da plataforma via steamId ${steamId}`,
      );

      await this.audit.record({
        actorType: AuditActorType.ANONYMOUS,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: existente.id,
        metadata: { motivo: 'conta_da_plataforma', steamId },
        context,
      });

      throw new ForbiddenException('Conta indisponível');
    }

    // Banido registra a tentativa — só o carimbo de horário, nada vindo de
    // fora. Saber que um suspenso tentou entrar é informação útil.
    if (existente?.isBanned) {
      await this.prisma.user.update({
        where: { id: existente.id },
        data: { lastLoginAt: agora },
      });

      this.logger.warn(`Login recusado para conta banida: ${steamId}`);

      await this.audit.record({
        actorType: AuditActorType.USER,
        actorId: existente.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: existente.id,
        metadata: { motivo: 'conta_suspensa', steamId },
        context,
      });

      throw new ForbiddenException('Esta conta está suspensa');
    }

    const [perfil, ban] = await Promise.all([
      this.steamProfile.fetchProfile(steamId),
      this.steamBan.fetchBanStatus(steamId),
    ]);

    // Só gravamos o status de ban se conseguimos apurá-lo. Quando a Steam
    // não responde, preservamos o último valor conhecido — sobrescrever com
    // um palpite liberaria ou bloquearia operações por engano.
    const dadosDeBan = ban
      ? {
          steamEconomyBan: ban.economyBan,
          steamVacBanned: ban.vacBanned,
          steamBanCheckedAt: agora,
        }
      : {};

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
        ...dadosDeBan,
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
        ...dadosDeBan,
      },
    });

    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      // primeiroLogin distingue conta nova de retorno — útil quando
      // alguém alega nunca ter usado o site.
      metadata: {
        steamId,
        primeiroLogin: existente === null,
        steamEconomyBan: user.steamEconomyBan,
      },
      context,
    });

    return user;
  }
}
