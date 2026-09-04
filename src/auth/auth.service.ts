import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/utils/audit.service';
import { decryptField, encryptField } from '../common/utils/encryption.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import { durationToMilliseconds } from './auth-cookie.util';
import {
  buildTotpUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hashToken,
  verifyTotp,
} from './totp.util';
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from './password.util';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 10;
const JWT_ISSUER = 'imart-billing-api';
const JWT_AUDIENCE = 'imart-billing-web';

export type ClientContext = {
  ipAddress?: string;
  userAgent?: string;
};

type SessionTokenPayload = {
  sub: string;
  sid: string;
  type: 'access' | 'refresh';
  mfa: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto, actorUserId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash,
        role: Role.OWNER,
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    await this.audit.log({
      userId: actorUserId,
      action: 'OWNER_ACCOUNT_CREATED',
      entityType: 'User',
      entityId: user.id,
    });
    return user;
  }

  async login(dto: LoginDto, context: ClientContext) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await verifyPassword(user.passwordHash, dto.password);
    if (!passwordValid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts,
          lockedUntil:
            failedLoginAttempts >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCK_DURATION_MS)
              : null,
        },
      });
      await this.audit.log({
        userId: user.id,
        action: failedLoginAttempts >= MAX_FAILED_LOGINS ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: context.ipAddress,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const upgradedPasswordHash = passwordHashNeedsUpgrade(user.passwordHash)
      ? await hashPassword(dto.password)
      : undefined;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordHash: upgradedPasswordHash,
      },
    });

    if (user.mfaEnabled) {
      const secondFactorValid = await this.verifySecondFactor(
        user.id,
        user.mfaSecret,
        user.mfaRecoveryCodes,
        dto.mfaCode,
        dto.recoveryCode,
      );
      if (!dto.mfaCode && !dto.recoveryCode) {
        return { mfaRequired: true as const };
      }
      if (!secondFactorValid) {
        await this.audit.log({
          userId: user.id,
          action: 'MFA_FAILED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: context.ipAddress,
        });
        throw new UnauthorizedException('Invalid authenticator or recovery code');
      }
    }

    const tokens = await this.createSession(user.id, user.email, user.role, user.mfaEnabled, context);
    await this.audit.log({
      userId: user.id,
      action: 'LOGIN_SUCCEEDED',
      entityType: 'AuthSession',
      entityId: tokens.sessionId,
      ipAddress: context.ipAddress,
    });
    return { mfaRequired: false as const, ...tokens };
  }

  async refresh(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const presentedHash = hashToken(refreshToken);
    const hashesMatch = timingSafeEqual(
      Buffer.from(presentedHash),
      Buffer.from(session.refreshTokenHash),
    );
    if (!hashesMatch) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const tokens = this.signTokens(
      session.user.id,
      session.user.email,
      session.user.role,
      session.id,
      session.mfaVerified,
    );
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: presentedHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: hashToken(tokens.refreshToken),
        lastUsedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedException('Session has already been refreshed');
    }

    return tokens;
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) return;
    try {
      const payload = this.verifyRefreshToken(refreshToken);
      await this.prisma.authSession.updateMany({
        where: { id: payload.sid, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logout is intentionally idempotent; invalid cookies are still cleared.
    }
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        mfaVerified: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) throw new BadRequestException('Session not found');
    return { success: true };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const result = await this.prisma.authSession.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true, revoked: result.count };
  }

  async setupMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new ConflictException('MFA is already enabled');

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptField(secret), mfaRecoveryCodes: null },
    });
    return { secret, otpauthUri: buildTotpUri(secret, user.email) };
  }

  async enableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret || user.mfaEnabled) {
      throw new BadRequestException('Start MFA setup before enabling it');
    }

    const secret = decryptField(user.mfaSecret);
    if (!verifyTotp(secret, code)) {
      throw new BadRequestException('Invalid authenticator code');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaRecoveryCodes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
        },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      userId,
      action: 'MFA_ENABLED',
      entityType: 'User',
      entityId: userId,
    });
    return { recoveryCodes, requiresLogin: true };
  }

  async disableMfa(userId: string, dto: DisableMfaDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }
    const passwordValid = await verifyPassword(user.passwordHash, dto.password);
    const codeValid = await this.verifySecondFactor(
      user.id,
      user.mfaSecret,
      user.mfaRecoveryCodes,
      /^\d{6}$/.test(dto.code) ? dto.code : undefined,
      /^\d{6}$/.test(dto.code) ? undefined : dto.code,
    );
    if (!passwordValid || !codeValid) {
      throw new UnauthorizedException('Invalid password or MFA code');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      userId,
      action: 'MFA_DISABLED',
      entityType: 'User',
      entityId: userId,
    });
    return { success: true, requiresLogin: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await verifyPassword(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException('New password must be different');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      userId,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: userId,
    });
    return { success: true, requiresLogin: true };
  }

  private async createSession(
    userId: string,
    email: string,
    role: Role,
    mfaVerified: boolean,
    context: ClientContext,
  ) {
    const sessionId = randomUUID();
    const tokens = this.signTokens(userId, email, role, sessionId, mfaVerified);
    const expiresAt = new Date(
      Date.now() +
        durationToMilliseconds(
          this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
          DEFAULT_REFRESH_TOKEN_MS,
        ),
    );
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: hashToken(tokens.refreshToken),
        userAgent: context.userAgent?.slice(0, 500),
        ipAddress: context.ipAddress?.slice(0, 45),
        mfaVerified,
        expiresAt,
      },
    });

    const excessSessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      skip: MAX_ACTIVE_SESSIONS,
      select: { id: true },
    });
    if (excessSessions.length > 0) {
      await this.prisma.authSession.updateMany({
        where: { id: { in: excessSessions.map(({ id }) => id) } },
        data: { revokedAt: new Date() },
      });
    }

    return { ...tokens, sessionId };
  }

  private signTokens(
    userId: string,
    email: string,
    role: Role,
    sessionId: string,
    mfaVerified: boolean,
  ) {
    const common = { sub: userId, email, role, sid: sessionId, mfa: mfaVerified };
    const accessToken = this.jwtService.sign(
      { ...common, type: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
    const refreshToken = this.jwtService.sign(
      { ...common, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as JwtSignOptions['expiresIn'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
    return { accessToken, refreshToken };
  }

  private verifyRefreshToken(token: string): SessionTokenPayload {
    try {
      const payload = this.jwtService.verify<SessionTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.type !== 'refresh' || !payload.sid || !payload.sub) throw new Error();
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async verifySecondFactor(
    userId: string,
    encryptedSecret: string | null,
    storedRecoveryCodes: string | null,
    mfaCode?: string,
    recoveryCode?: string,
  ): Promise<boolean> {
    if (mfaCode && encryptedSecret) {
      return verifyTotp(decryptField(encryptedSecret), mfaCode);
    }
    if (recoveryCode && storedRecoveryCodes) {
      const hashes = this.parseRecoveryCodes(storedRecoveryCodes);
      const presentedHash = hashRecoveryCode(recoveryCode);
      const index = hashes.indexOf(presentedHash);
      if (index === -1) return false;
      hashes.splice(index, 1);
      await this.prisma.user.update({
        where: { id: userId },
        data: { mfaRecoveryCodes: JSON.stringify(hashes) },
      });
      return true;
    }
    return false;
  }

  private parseRecoveryCodes(value: string): string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
}
