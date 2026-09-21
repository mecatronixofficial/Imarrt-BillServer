ALTER TABLE `business_documents`
  ADD COLUMN `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE `purchase_payments` (
  `id` VARCHAR(191) NOT NULL,
  `documentId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `method` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `purchase_payments_documentId_paidAt_idx`(`documentId`, `paidAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `purchase_payments`
  ADD CONSTRAINT `purchase_payments_documentId_fkey`
  FOREIGN KEY (`documentId`) REFERENCES `business_documents`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
