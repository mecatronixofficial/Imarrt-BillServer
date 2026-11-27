CREATE TABLE `action_security` (
  `userId` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `passcodeHash` VARCHAR(255) NULL,
  `failedAttempts` INTEGER NOT NULL DEFAULT 0,
  `lockedUntil` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`),
  CONSTRAINT `action_security_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `party_groups` (
  `id` VARCHAR(191) NOT NULL,
  `businessId` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `normalizedName` VARCHAR(60) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `party_groups_branchId_normalizedName_key` (`branchId`, `normalizedName`),
  INDEX `party_groups_businessId_idx` (`businessId`),
  CONSTRAINT `party_groups_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `party_groups_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customers` ADD COLUMN `groupId` VARCHAR(191) NULL;
CREATE INDEX `customers_groupId_idx` ON `customers` (`groupId`);

-- Preserve legacy free-text groups and assignments in each existing branch.
INSERT INTO `party_groups` (`id`, `businessId`, `branchId`, `name`, `normalizedName`, `updatedAt`)
SELECT UUID(), MIN(`businessId`), `branchId`, MIN(TRIM(LEFT(`group`, 60))), LOWER(TRIM(LEFT(`group`, 60))), CURRENT_TIMESTAMP(3)
FROM `customers`
WHERE `branchId` IS NOT NULL AND `businessId` IS NOT NULL AND TRIM(COALESCE(`group`, '')) <> ''
GROUP BY `branchId`, LOWER(TRIM(LEFT(`group`, 60)));

UPDATE `customers` c JOIN `party_groups` g
  ON g.`branchId` = c.`branchId` AND g.`normalizedName` = LOWER(TRIM(LEFT(c.`group`, 60)))
SET c.`groupId` = g.`id`, c.`group` = g.`name`;

ALTER TABLE `customers` ADD CONSTRAINT `customers_groupId_fkey`
  FOREIGN KEY (`groupId`) REFERENCES `party_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;