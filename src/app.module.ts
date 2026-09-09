import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { PartiesModule } from './parties/parties.module.js';
import { ItemsModule } from './items/items.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { OriginGuard } from './auth/guards/origin.guard.js';
import { validateEnvironment } from './config/env.validation.js';
import { MfaGuard } from './auth/guards/mfa.guard.js';
import { BusinessGuard } from './auth/guards/business.guard.js';
import { BranchGuard } from './auth/guards/branch.guard.js';
import { BusinessesModule } from './businesses/businesses.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { ProductionModule } from './production/production.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { AppController } from './app.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
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
