import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from './auth/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class AppController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Public()
  getHealth() {
    return {
      status: 'ok',
      service: 'billing-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  readiness() {
    return this.health.check([
      async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return { database: { status: 'up' as const } };
      },
    ]);
  }
}
