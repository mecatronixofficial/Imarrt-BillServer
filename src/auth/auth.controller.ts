import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { RequireMfa } from './decorators/require-mfa.decorator';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from './auth-cookie.util';

type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
  sessionId: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
};

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Roles(Role.SUPER_ADMIN)
  @RequireMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.register(dto, user.id);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto, this.clientContext(request));
    if (result.mfaRequired) return result;

    setAuthCookies(response, result);
    return { message: 'Login successful', mfaRequired: false };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) throw new UnauthorizedException('Refresh token is missing');

    const tokens = await this.authService.refresh(refreshToken);
    setAuthCookies(response, tokens);
    return { message: 'Session refreshed' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.id, user.sessionId);
  }

  @Delete('sessions/others')
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.revokeOtherSessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  revokeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.revokeSession(user.id, id);
  }

  @Post('mfa/setup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setupMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupMfa(user.id);
  }

  @Post('mfa/enable')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async enableMfa(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.enableMfa(user.id, dto.code);
    clearAuthCookies(response);
    return result;
  }

  @Post('mfa/disable')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async disableMfa(
    @Body() dto: DisableMfaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.disableMfa(user.id, dto);
    clearAuthCookies(response);
    return result;
  }

  @Post('change-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.changePassword(user.id, dto);
    clearAuthCookies(response);
    return result;
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(readCookie(request, REFRESH_TOKEN_COOKIE));
    clearAuthCookies(response);
    return { message: 'Logout successful' };
  }

  private clientContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
