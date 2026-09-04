import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_MFA_KEY } from '../decorators/require-mfa.decorator';

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user;
    if (user?.mfaEnabled && !user?.mfaVerified) {
      throw new ForbiddenException('Authenticator MFA is required for billing access');
    }
    return true;
  }
}
