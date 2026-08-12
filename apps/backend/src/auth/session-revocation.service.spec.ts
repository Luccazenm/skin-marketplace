import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { SessionRevocationService } from './session-revocation.service';

describe('SessionRevocationService', () => {
  let service: SessionRevocationService;
  let redis: RedisService;

  const USER = 'user-teste-revogacao';
  const agora = () => Math.floor(Date.now() / 1000);

  const payload = (jti: string, iat = agora()) => ({ jti, sub: USER, iat });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [SessionRevocationService, RedisService],
    }).compile();

    service = moduleRef.get(SessionRevocationService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    const chaves = await redis.keys('revoked:*teste*');
    if (chaves.length > 0) await redis.del(...chaves);
    await redis.del(`revoked:user:${USER}`);
  });

  afterAll(async () => {
    const chaves = await redis.keys('revoked:*teste*');
    if (chaves.length > 0) await redis.del(...chaves);
    await redis.del(`revoked:user:${USER}`);
    await redis.quit();
  });

  it('aceita token que nunca foi revogado', async () => {
    expect(await service.isRevoked(payload('jti-teste-1'))).toBe(false);
  });

  it('recusa token revogado', async () => {
    await service.revokeToken('jti-teste-1', agora() + 3600);

    expect(await service.isRevoked(payload('jti-teste-1'))).toBe(true);
  });

  // Sair no computador não pode desconectar a pessoa do celular.
  it('revogar um token não afeta os outros', async () => {
    await service.revokeToken('jti-teste-1', agora() + 3600);

    expect(await service.isRevoked(payload('jti-teste-2'))).toBe(false);
  });

  it('não grava nada para token que já expirou', async () => {
    await service.revokeToken('jti-teste-velho', agora() - 60);

    expect(await redis.exists('revoked:jti:jti-teste-velho')).toBe(0);
  });

  describe('sair de todos os dispositivos', () => {
    it('derruba tokens emitidos antes do corte', async () => {
      const antigo = payload('jti-teste-antigo', agora() - 300);

      await service.revokeAllForUser(USER);

      expect(await service.isRevoked(antigo)).toBe(true);
    });

    // O token que fizer a próxima entrada precisa funcionar, senão o
    // usuário não consegue mais logar depois de "sair de todos".
    it('não derruba token emitido depois do corte', async () => {
      await service.revokeAllForUser(USER);

      // +2s para ficar claramente após o corte, mesmo com arredondamento
      const novo = payload('jti-teste-novo', agora() + 2);

      expect(await service.isRevoked(novo)).toBe(false);
    });

    // Regressão: o JWT grava iat em segundos, então um token emitido no
    // mesmo segundo do corte tinha iat igual a ele e escapava de uma
    // comparação por "menor que". Era uma janela de um segundo em que
    // "sair de todos" não derrubava a sessão em uso.
    it('derruba token emitido no mesmo segundo do corte', async () => {
      const mesmoSegundo = payload('jti-teste-limite', agora());

      await service.revokeAllForUser(USER);

      expect(await service.isRevoked(mesmoSegundo)).toBe(true);
    });

    it('não afeta outro usuário', async () => {
      await service.revokeAllForUser(USER);

      const deOutro = {
        jti: 'jti-teste-3',
        sub: 'outro-teste',
        iat: agora() - 300,
      };

      expect(await service.isRevoked(deOutro)).toBe(false);
    });
  });

  it('a entrada expira junto com o token', async () => {
    await service.revokeToken('jti-teste-ttl', agora() + 120);

    const ttl = await redis.ttl('revoked:jti:jti-teste-ttl');

    // Guardar por mais tempo que a validade do token só ocuparia memória:
    // depois de expirado, o token já não vale por conta própria.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(121);
  });
});
