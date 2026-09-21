CREATE TABLE `workspace_branches` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `address` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `workspace_branches_createdById_code_key`(`createdById`, `code`),
  INDEX `workspace_branches_createdById_isActive_idx`(`createdById`, `isActive`),
  PRIMARY KEY (`id`),
  CONSTRAINT `workspace_branches_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `businesses` ADD COLUMN `workspaceBranchId` VARCHAR(191) NULL;
INSERT INTO `workspace_branches` (`id`, `name`, `code`, `createdById`, `createdAt`, `updatedAt`)
SELECT UUID(), 'Main Branch', CONCAT('MAIN_', LEFT(REPLACE(`createdById`, '-', ''), 8)), `createdById`, NOW(3), NOW(3) FROM `businesses` GROUP BY `createdById`;
UPDATE `businesses` b JOIN `workspace_branches` wb ON wb.`createdById` = b.`createdById` SET b.`workspaceBranchId` = wb.`id`;
CREATE INDEX `businesses_workspaceBranchId_idx` ON `businesses`(`workspaceBranchId`);
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_workspaceBranchId_fkey` FOREIGN KEY (`workspaceBranchId`) REFERENCES `workspace_branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
