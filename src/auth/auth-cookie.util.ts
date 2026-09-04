import { CookieOptions, Request, Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

const DEFAULT_ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function durationToMilliseconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const match = /^(\d+)(s|m|h|d)$/i.exec(value.trim());
  if (!match) return fallback;

  const amount = Number(match[1]);
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[match[2].toLowerCase() as keyof typeof multipliers];
}

function baseCookieOptions(path: string): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path,
  };
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.cookie;
  if (!cookies) return undefined;

  for (const entry of cookies.split(';')) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = entry.slice(0, separatorIndex).trim();
    if (key !== name) continue;

    const value = entry.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

export function setAuthCookies(
  response: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const accessOptions = baseCookieOptions('/api/v1');
  const refreshOptions = baseCookieOptions('/api/v1/auth');

  response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...accessOptions,
    maxAge: durationToMilliseconds(
      process.env.JWT_EXPIRES_IN,
      DEFAULT_ACCESS_TOKEN_MAX_AGE_MS,
    ),
  });
  response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...refreshOptions,
    maxAge: durationToMilliseconds(
      process.env.JWT_REFRESH_EXPIRES_IN,
      DEFAULT_REFRESH_TOKEN_MAX_AGE_MS,
    ),
  });
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions('/api/v1'));
  response.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions('/api/v1/auth'));
}
