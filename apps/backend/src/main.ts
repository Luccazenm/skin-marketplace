import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { setupApp } from './app-setup';
import { AppModule } from './app.module';
import { StructuredLogger } from './observability/structured-logger';

async function bootstrap() {
  // bufferLogs holds whatever is emitted during start-up until the real
  // logger takes over — without it, the boot logs would come out in the
  // old format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // JSON in production, so it can be filtered by user and request. In
  // development, readable text is worth more.
  app.useLogger(
    new StructuredLogger(config.get<string>('NODE_ENV') === 'production'),
  );

  // The same configuration the tests use — see app-setup.ts
  setupApp(app);

  // While there is no frontend, Swagger is the API's workbench. Kept out
  // of production so the whole surface is not exposed publicly.
  if (config.get<string>('NODE_ENV') !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Skin Marketplace API')
        .setDescription('CS2 skin marketplace')
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup('docs', app, document);
  }

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  new Logger('Bootstrap').log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
