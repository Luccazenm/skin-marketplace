import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { requestContextMiddleware } from './observability/request-context.middleware';

/**
 * Configuração aplicada ao app antes de ele atender qualquer requisição.
 *
 * Vive aqui, e não dentro do bootstrap, para que os testes subam
 * exatamente o mesmo app que roda em produção. Prefixo de rota, validação
 * de entrada e leitura de cookie ficam fora do módulo do Nest — um teste
 * que montasse o app por conta própria passaria sem eles e daria falsa
 * confiança: rota respondendo 200 onde produção devolve 404, ou body
 * inválido sendo aceito.
 */
export function setupApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // Primeiro de todos: abre o contexto para que qualquer log emitido
  // durante a requisição — inclusive de erro em middleware seguinte —
  // saia com o identificador dela.
  app.use(requestContextMiddleware);

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
