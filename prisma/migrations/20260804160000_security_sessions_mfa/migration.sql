ALTER TABLE `users`
  ADD COLUMN `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` DATETIME(3) NULL,
  ADD COLUMN `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `mfaSecret` TEXT NULL,
  ADD COLUMN `mfaRecoveryCodes` TEXT NULL,
  ADD COLUMN `passwordChangedAt` DATETIME(3) NULL;

CREATE TABLE `auth_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `refreshTokenHash` VARCHAR(64) NOT NULL,
  `userAgent` VARCHAR(500) NULL,
  `ipAddress` VARCHAR(45) NULL,
  `mfaVerified` BOOLEAN NOT NULL DEFAULT false,
  `expiresAt` DATETIME(3) NOT NULL,
  `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `auth_sessions_refreshTokenHash_key`(`refreshTokenHash`),
  INDEX `auth_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
  INDEX `auth_sessions_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `auth_sessions`
  ADD CONSTRAINT `auth_sessions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
