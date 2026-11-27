import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientInitializationError) ||
          error.errorCode !== 'P1001' ||
          attempt === maxAttempts
        ) {
          throw error;
        }

        const delayMs = attempt * 2_000;
        Logger.warn(
          `Database unreachable (P1001). Retrying in ${delayMs / 1_000}s (attempt ${attempt + 1}/${maxAttempts}).`,
          PrismaService.name,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
