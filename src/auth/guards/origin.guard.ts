import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    // Browsers attach Origin to cross-origin mutation requests. Non-browser API
    // clients may omit it and still need to authenticate with a valid token.
    const origin = request.headers.origin;
    if (!origin) return true;

    const allowedOrigins = this.config.getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Request origin is not allowed');
    }

    return true;
  }
}
