import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ActionSecurityService } from './action-security.service.js';

// Session recovery must remain available even when an action passcode is locked.
const SESSION_ROUTES = /^\/auth\/(login|refresh|logout|forgot-password|reset-password|mfa(?:\/.*)?)\/?$/;

// The passcode protects edits (PUT/PATCH) and deletions (DELETE) only.
// Creating records and other actions (POST) do not ask for it.
const PROTECTED_METHODS = ['PUT', 'PATCH', 'DELETE'];

@Injectable()
export class ActionSecurityGuard implements CanActivate {
  constructor(private readonly security: ActionSecurityService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.id || !PROTECTED_METHODS.includes(request.method)) return true;
    const path = (request.originalUrl ?? request.url).split('?')[0].replace(/^\/api\/v1/, '');
    if (SESSION_ROUTES.test(path)) return true;
    const header = request.headers['x-action-passcode'];
    await this.security.verify(request.user.id, typeof header === 'string' ? header : undefined);
    return true;
  }
}