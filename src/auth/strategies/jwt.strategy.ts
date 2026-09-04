import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE, readCookie } from '../auth-cookie.util';

type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: 'access';
  mfa: boolean;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => readCookie(request, ACCESS_TOKEN_COOKIE) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      issuer: 'imart-billing-api',
      audience: 'imart-billing-web',
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (payload.type !== 'access' || !payload.sid || !payload.sub) {
      throw new UnauthorizedException('Invalid access token');
    }

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('Session is invalid or expired');

    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      name: session.user.name,
      sessionId: session.id,
      mfaEnabled: session.user.mfaEnabled,
      mfaVerified: session.mfaVerified && payload.mfa === true,
    };
  }
}
