import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { requestContextMiddleware } from './observability/request-context.middleware';

/**
 * Configuration applied to the app before it serves any request.
 *
 * It lives here, rather than inside the bootstrap, so the tests boot
 * exactly the same app that runs in production. The route prefix, input
 * validation and cookie parsing sit outside the Nest module — a test
 * that assembled the app on its own would pass without them and give
 * false confidence: a route answering 200 where production returns 404,
 * or an invalid body being accepted.
 */
export function setupApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // First of all: opens the context so that any log emitted during the
  // request — including an error from a later middleware — carries its
  // identifier.
  app.use(requestContextMiddleware);

  // Needed so the guard can read the session cookie
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips fields not declared in the DTO
      forbidNonWhitelisted: true, // and refuses the request if they arrive
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

  // Without this Prisma does not close the connection on SIGTERM
  // (reload, deploy, docker stop)
  app.enableShutdownHooks();
}
