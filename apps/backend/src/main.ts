import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { configurarApp } from './app-setup';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Mesma configuração usada pelos testes — ver app-setup.ts
  configurarApp(app);

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
