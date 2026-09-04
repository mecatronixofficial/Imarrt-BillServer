type Environment = Record<string, string | undefined>;

export function validateEnvironment(config: Environment): Environment {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FIELD_ENCRYPTION_KEY',
    'CORS_ORIGIN',
  ];
  const missing = required.filter((key) => !config[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if ((config.JWT_SECRET?.length ?? 0) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }
  if ((config.JWT_REFRESH_SECRET?.length ?? 0) < 32) {
    throw new Error('JWT_REFRESH_SECRET must contain at least 32 characters');
  }
  if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (config.CORS_ORIGIN?.split(',').some((origin) => origin.trim() === '*')) {
    throw new Error('CORS_ORIGIN cannot use a wildcard when credentials are enabled');
  }
  if (!/^[a-fA-F0-9]{64}$/.test(config.FIELD_ENCRYPTION_KEY ?? '')) {
    throw new Error('FIELD_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
  }
  for (const key of ['JWT_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN'] as const) {
    const value = config[key];
    if (value && !/^\d+(s|m|h|d)$/i.test(value.trim())) {
      throw new Error(`${key} must use a duration such as 15m, 12h, or 7d`);
    }
  }
  try {
    const databaseUrl = new URL(config.DATABASE_URL ?? '');
    if (databaseUrl.protocol !== 'mysql:') throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL connection URL');
  }
  for (const origin of config.CORS_ORIGIN?.split(',') ?? []) {
    try {
      const parsed = new URL(origin.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
  }

  const nodeEnv = config.NODE_ENV?.trim() || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const port = Number(config.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const logLevel = config.LOG_LEVEL?.trim() || (nodeEnv === 'production' ? 'info' : 'debug');
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new Error('LOG_LEVEL is invalid');
  }

  for (const key of ['SWAGGER_ENABLED', 'TRUST_PROXY', 'PUPPETEER_NO_SANDBOX'] as const) {
    const value = config[key]?.trim().toLowerCase();
    if (value && !['true', 'false'].includes(value)) {
      throw new Error(`${key} must be true or false`);
    }
  }

  return {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: String(port),
    LOG_LEVEL: logLevel,
    SWAGGER_ENABLED: config.SWAGGER_ENABLED ?? (nodeEnv === 'production' ? 'false' : 'true'),
    TRUST_PROXY: config.TRUST_PROXY ?? 'false',
    PUPPETEER_NO_SANDBOX: config.PUPPETEER_NO_SANDBOX ?? 'false',
  };
}
