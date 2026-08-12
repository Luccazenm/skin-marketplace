import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/**
 * Configuração aplicada ao app antes de ele atender qualquer requisição.
 *
 * Vive aqui, e não dentro do bootstrap, para que os testes subam
 * exatamente o mesmo app que roda em produção. Prefixo de rota, validação
 * de entrada e leitura de cookie ficam fora do módulo do Nest — um teste
 * que montasse o app por conta própria passaria sem eles e daria falsa
 * confiança: rota respondendo 200 onde produção devolve 404, ou corpo
 * inválido sendo aceito.
 */
export function configurarApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // Necessário para o guard ler o cookie de sessão
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos não declarados no DTO
      forbidNonWhitelisted: true, // e recusa a requisição se vierem
      transform: true,
    }),
  );

  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });

  // Sem isso o Prisma não fecha a conexão em SIGTERM (reload, deploy, docker stop)
  app.enableShutdownHooks();
}
