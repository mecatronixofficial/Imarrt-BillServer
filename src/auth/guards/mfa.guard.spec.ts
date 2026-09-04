import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaGuard } from './mfa.guard';

describe('MfaGuard', () => {
  const getAllAndOverride = vi.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const guard = new MfaGuard(reflector);

  function contextFor(user?: { mfaEnabled: boolean; mfaVerified: boolean }) {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    getAllAndOverride.mockReset();
    getAllAndOverride.mockReturnValue(true);
  });

  it('allows access when a route does not require MFA checking', () => {
    getAllAndOverride.mockReturnValue(false);
    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows access when the user has chosen not to enable MFA', () => {
    expect(guard.canActivate(contextFor({ mfaEnabled: false, mfaVerified: false }))).toBe(true);
  });

  it('requires verification when the user has enabled MFA', () => {
    expect(() => guard.canActivate(contextFor({ mfaEnabled: true, mfaVerified: false })))
      .toThrow(ForbiddenException);
  });

  it('allows verified MFA sessions', () => {
    expect(guard.canActivate(contextFor({ mfaEnabled: true, mfaVerified: true }))).toBe(true);
  });
});
