import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
