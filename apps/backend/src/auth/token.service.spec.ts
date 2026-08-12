import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwt: JwtService;
  let config: ConfigService;

  const payload = { sub: 'user-123', steamId: '76561198000000001' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => ({
            secret: c.getOrThrow<string>('JWT_SECRET'),
            signOptions: {
              expiresIn: c.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
            },
          }),
        }),
      ],
      providers: [TokenService],
    }).compile();

    service = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);
    config = moduleRef.get(ConfigService);
  });

  describe('sign', () => {
    it('gera token que a própria verificação aceita', () => {
      const verificado = service.verify(service.sign(payload));

      expect(verificado?.sub).toBe(payload.sub);
      expect(verificado?.steamId).toBe(payload.steamId);
    });

    // Sem jti único, revogar um logout derrubaria todas as sessões da
    // pessoa — sair no computador desconectaria o celular.
    it('gera jti diferente a cada emissão', () => {
      const a = service.verify(service.sign(payload))!;
      const b = service.verify(service.sign(payload))!;

      expect(a.jti).toBeDefined();
      expect(a.jti).not.toBe(b.jti);
    });

    it('inclui iat e exp', () => {
      const v = service.verify(service.sign(payload))!;
      const ttl = config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

      expect(v.iat).toBeGreaterThan(0);
      expect(v.exp - v.iat).toBe(ttl);
    });

    // O token vive dias e não pode ser revisto: dado mutável embutido
    // vira uma cópia desatualizada que o usuário carrega por aí.
    it('não carrega saldo nem estado de banimento', () => {
      const bruto = jwt.decode<Record<string, unknown>>(service.sign(payload));

      expect(Object.keys(bruto).sort()).toEqual(
        ['exp', 'iat', 'jti', 'steamId', 'sub'].sort(),
      );
    });
  });

  describe('verify', () => {
    it('recusa texto que não é token', () => {
      expect(service.verify('qualquer coisa')).toBeNull();
    });

    it('recusa token assinado com outra chave', () => {
      const outro = new JwtService({ secret: 'chave-diferente-de-teste-123' });
      const forjado = outro.sign(payload);

      expect(service.verify(forjado)).toBeNull();
    });

    it('recusa token expirado', () => {
      const expirado = jwt.sign(payload, { expiresIn: '-1s' });

      expect(service.verify(expirado)).toBeNull();
    });

    // Alterar o payload sem reassinar é a tentativa mais simples de
    // trocar de identidade.
    it('recusa token adulterado', () => {
      const [head, , sig] = service.sign(payload).split('.');
      const outroPayload = Buffer.from(
        JSON.stringify({ ...payload, sub: 'outro-usuario' }),
      ).toString('base64url');

      expect(service.verify(`${head}.${outroPayload}.${sig}`)).toBeNull();
    });
  });

  describe('cookieOptions', () => {
    it('impede leitura por JavaScript da página', () => {
      // Sem httpOnly, um XSS levaria a sessão junto.
      expect(service.cookieOptions().httpOnly).toBe(true);
    });

    it('usa sameSite lax contra CSRF', () => {
      expect(service.cookieOptions().sameSite).toBe('lax');
    });

    it('expira junto com o token', () => {
      const ttl = config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

      // maxAge do cookie é em milissegundos; se divergirem, o cookie some
      // antes do token expirar ou o contrário.
      expect(service.cookieOptions().maxAge).toBe(ttl * 1000);
    });
  });
});
