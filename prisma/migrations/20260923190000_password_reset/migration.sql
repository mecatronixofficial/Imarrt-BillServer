ALTER TABLE `users` ADD COLUMN `passwordResetTokenHash` VARCHAR(64) NULL,
    ADD COLUMN `passwordResetExpiresAt` DATETIME(3) NULL;
CREATE UNIQUE INDEX `users_passwordResetTokenHash_key` ON `users`(`passwordResetTokenHash`);
