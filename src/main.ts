import 'reflect-metadata';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression = require('compression');
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    routeConflictPolicy: { duplicate: 'error', shadow: 'warn' },
    routeResolutionStrategy: 'specificity',
  });
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));

  const isProduction = config.getOrThrow<string>('NODE_ENV') === 'production';
  const corsOrigins = config
    .getOrThrow<string>('CORS_ORIGIN')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (config.get<string>('TRUST_PROXY') === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  app.use(compression({ threshold: 1024 }));

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  if (config.get<string>('SWAGGER_ENABLED') === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Billing API')
      .setDescription('Business billing, inventory, invoicing, and production API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('access_token')
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
      { jsonDocumentUrl: 'api/docs/openapi.json' },
    );
  }

  const port = Number(config.getOrThrow<string>('PORT'));
  const host = config.get<string>('HOST', '0.0.0.0');
  await app.listen(port, host);

  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  app.get(Logger).log(`Backend listening on http://${host}:${port}/api/v1`);
}

bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  NestLogger.error('Application failed to start', detail);
  process.stderr.write(`Application failed to start: ${detail}\n`);
  process.exitCode = 1;
});
