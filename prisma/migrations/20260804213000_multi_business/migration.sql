-- Add multi-business structures without modifying or reassigning legacy records.
ALTER TABLE `users`
  MODIFY `role` ENUM('SUPER_ADMIN', 'OWNER', 'ACCOUNTANT', 'STAFF') NOT NULL DEFAULT 'STAFF';

CREATE TABLE `businesses` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `legalName` VARCHAR(160) NULL,
  `gstRegistered` BOOLEAN NOT NULL DEFAULT false,
  `gstin` VARCHAR(512) NULL,
  `address` TEXT NULL,
  `stateCode` VARCHAR(2) NULL,
  `phone` VARCHAR(20) NULL,
  `email` VARCHAR(160) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `businesses_createdById_idx` (`createdById`),
  INDEX `businesses_name_idx` (`name`),
  CONSTRAINT `businesses_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `business_members` (
  `businessId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`businessId`, `userId`),
  INDEX `business_members_userId_idx` (`userId`),
  CONSTRAINT `business_members_businessId_fkey`
    FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `business_members_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customers` ADD COLUMN `businessId` VARCHAR(191) NULL;
ALTER TABLE `items` ADD COLUMN `businessId` VARCHAR(191) NULL;
ALTER TABLE `invoices` ADD COLUMN `businessId` VARCHAR(191) NULL;
ALTER TABLE `audit_logs` ADD COLUMN `businessId` VARCHAR(191) NULL;

CREATE INDEX `customers_businessId_name_idx` ON `customers` (`businessId`, `name`);
CREATE INDEX `items_businessId_name_idx` ON `items` (`businessId`, `name`);
CREATE INDEX `invoices_businessId_status_idx` ON `invoices` (`businessId`, `status`);
CREATE INDEX `audit_logs_businessId_createdAt_idx` ON `audit_logs` (`businessId`, `createdAt`);

ALTER TABLE `customers`
  ADD CONSTRAINT `customers_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `items`
  ADD CONSTRAINT `items_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoices`
  ADD CONSTRAINT `invoices_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `audit_logs`
  ADD CONSTRAINT `audit_logs_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
