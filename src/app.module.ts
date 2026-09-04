import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PartiesModule } from './parties/parties.module';
import { ItemsModule } from './items/items.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PdfModule } from './pdf/pdf.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { OriginGuard } from './auth/guards/origin.guard';
import { validateEnvironment } from './config/env.validation';
import { MfaGuard } from './auth/guards/mfa.guard';
import { BusinessGuard } from './auth/guards/business.guard';
import { BranchGuard } from './auth/guards/branch.guard';
import { BusinessesModule } from './businesses/businesses.module';
import { BranchesModule } from './branches/branches.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProductionModule } from './production/production.module';
import { DocumentsModule } from './documents/documents.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          genReqId: (request: IncomingMessage, response: ServerResponse) => {
            const suppliedId = request.headers['x-request-id'];
            const requestId =
              typeof suppliedId === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedId)
                ? suppliedId
                : randomUUID();
            response.setHeader('X-Request-Id', requestId);
            return requestId;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            censor: '[Redacted]',
          },
        },
      }),
    }),
    TerminusModule,
    // Global rate limiting: 100 requests / 60s per IP by default.
    // Sensitive routes (login/register) override this with a stricter @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    PartiesModule,
    ItemsModule,
    InvoicesModule,
    PdfModule,
    BusinessesModule,
    BranchesModule,
    SuppliersModule,
    ProductionModule,
    DocumentsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OriginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BusinessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BranchGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MfaGuard,
    },
  ],
})
export class AppModule {}
