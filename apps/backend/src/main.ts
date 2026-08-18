import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { setupApp } from './app-setup';
import { AppModule } from './app.module';
import { StructuredLogger } from './observability/structured-logger';

async function bootstrap() {
  // bufferLogs segura o que for emitido durante a inicialização até o
  // logger definitivo assumir — sem isso, os logs do boot sairiam no
  // formato antigo.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // JSON em produção, para dar para filtrar por usuário e requisição.
  // Em desenvolvimento, texto legível vale mais.
  app.useLogger(
    new StructuredLogger(config.get<string>('NODE_ENV') === 'production'),
  );

  // Mesma configuração usada pelos testes — ver app-setup.ts
  setupApp(app);

  // Enquanto não existe frontend, o Swagger é a bancada de testes da API.
  // Fora de produção para não expor a superfície inteira publicamente.
  if (config.get<string>('NODE_ENV') !== 'production') {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Skin Marketplace API')
        .setDescription('Marketplace de skins de CS2')
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup('docs', app, documento);
  }

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  new Logger('Bootstrap').log(`API ouvindo em http://localhost:${port}/api`);
}

void bootstrap();
