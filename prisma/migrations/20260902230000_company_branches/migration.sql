-- Introduce branches beneath each business/company. Parties, suppliers, and items
-- remain company-wide; operational records receive a branch assignment.
CREATE TABLE `branches` (
  `id` VARCHAR(191) NOT NULL,
  `businessId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(24) NOT NULL,
  `address` TEXT NULL,
  `stateCode` VARCHAR(2) NULL,
  `phone` VARCHAR(20) NULL,
  `email` VARCHAR(160) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branches_businessId_code_key` (`businessId`, `code`),
  INDEX `branches_businessId_isActive_idx` (`businessId`, `isActive`),
  CONSTRAINT `branches_businessId_fkey`
    FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `branches` (`id`, `businessId`, `name`, `code`, `address`, `stateCode`, `phone`, `email`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), `id`, 'Main Branch', 'MAIN', `address`, `stateCode`, `phone`, `email`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `businesses`;

ALTER TABLE `invoices` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `production_orders` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `business_documents` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `audit_logs` ADD COLUMN `branchId` VARCHAR(191) NULL;

UPDATE `invoices` AS record
JOIN `branches` AS branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id`;
UPDATE `production_orders` AS record
JOIN `branches` AS branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id`;
UPDATE `business_documents` AS record
JOIN `branches` AS branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id`;

DROP INDEX `invoices_invoiceNumber_key` ON `invoices`;
DROP INDEX `production_orders_businessId_orderNumber_key` ON `production_orders`;
DROP INDEX `business_documents_businessId_documentNumber_key` ON `business_documents`;

CREATE UNIQUE INDEX `invoices_branchId_invoiceNumber_key` ON `invoices` (`branchId`, `invoiceNumber`);
CREATE UNIQUE INDEX `production_orders_branchId_orderNumber_key` ON `production_orders` (`branchId`, `orderNumber`);
CREATE UNIQUE INDEX `business_documents_branchId_documentNumber_key` ON `business_documents` (`branchId`, `documentNumber`);
CREATE INDEX `invoices_businessId_branchId_createdAt_idx` ON `invoices` (`businessId`, `branchId`, `createdAt`);
CREATE INDEX `production_orders_businessId_branchId_createdAt_idx` ON `production_orders` (`businessId`, `branchId`, `createdAt`);
CREATE INDEX `business_documents_businessId_branchId_issueDate_idx` ON `business_documents` (`businessId`, `branchId`, `issueDate`);
CREATE INDEX `audit_logs_branchId_createdAt_idx` ON `audit_logs` (`branchId`, `createdAt`);

ALTER TABLE `invoices`
  ADD CONSTRAINT `invoices_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `production_orders`
  ADD CONSTRAINT `production_orders_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `business_documents`
  ADD CONSTRAINT `business_documents_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `audit_logs`
  ADD CONSTRAINT `audit_logs_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
