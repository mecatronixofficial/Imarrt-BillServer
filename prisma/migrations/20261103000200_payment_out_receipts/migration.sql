-- Payment-Out receipts: one supplier payment that may settle several purchase bills.
ALTER TABLE `purchase_payments` ADD COLUMN `receiptId` VARCHAR(191) NULL;

CREATE TABLE `payment_out_receipts` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `receiptNumber` VARCHAR(40) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reference` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `paid` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `requestId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` VARCHAR(191) NULL,
    `voidReason` VARCHAR(500) NULL,

    INDEX `payment_out_receipts_businessId_branchId_paidAt_idx`(`businessId`, `branchId`, `paidAt`),
    INDEX `payment_out_receipts_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `payment_out_receipts_branchId_receiptNumber_key`(`branchId`, `receiptNumber`),
    UNIQUE INDEX `payment_out_receipts_branchId_requestId_key`(`branchId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_out_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `kind` ENUM('IMAGE', 'DOCUMENT') NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_out_attachments_receiptId_createdAt_idx`(`receiptId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `purchase_payments_receiptId_idx` ON `purchase_payments`(`receiptId`);

-- Backfill: each existing payment becomes its own receipt, reusing the payment id as the receipt id.
-- Numbers follow the new PO-<year>-<sequence> format per branch, oldest first.
INSERT INTO `payment_out_receipts`
  (`id`, `businessId`, `branchId`, `supplierId`, `receiptNumber`, `paidAt`, `reference`, `description`,
   `paid`, `discount`, `requestId`, `createdById`, `createdAt`, `updatedAt`, `voidedAt`, `voidedById`, `voidReason`)
SELECT
  p.`id`, d.`businessId`, d.`branchId`, d.`supplierId`,
  CONCAT('PO-', YEAR(p.`paidAt`), '-', LPAD(ROW_NUMBER() OVER (PARTITION BY d.`branchId`, YEAR(p.`paidAt`) ORDER BY p.`paidAt`, p.`createdAt`, p.`id`), 6, '0')),
  p.`paidAt`, p.`reference`, p.`notes`, p.`amount`, 0, NULL, p.`createdById`, p.`createdAt`, CURRENT_TIMESTAMP(3),
  p.`voidedAt`, p.`voidedById`, p.`voidReason`
FROM `purchase_payments` p
JOIN `business_documents` d ON d.`id` = p.`documentId`;

UPDATE `purchase_payments` SET `receiptId` = `id` WHERE `receiptId` IS NULL;

ALTER TABLE `purchase_payments` ADD CONSTRAINT `purchase_payments_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `payment_out_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payment_out_receipts` ADD CONSTRAINT `payment_out_receipts_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_out_receipts` ADD CONSTRAINT `payment_out_receipts_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payment_out_receipts` ADD CONSTRAINT `payment_out_receipts_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payment_out_attachments` ADD CONSTRAINT `payment_out_attachments_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `payment_out_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
