ALTER TABLE `production_stages` MODIFY `type` ENUM('CUTTING','PRINT_EMBROIDERY','STITCHING','PACKING','MASTER','FABRIC_PURCHASE','WASHING_COMPACTING','FINAL') NOT NULL;
ALTER TABLE `production_orders` MODIFY `status` ENUM('DRAFT','CONFIRMED','IN_PRODUCTION','READY','DISPATCHED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE `production_orders`
  ADD COLUMN `supplierRate` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `invoiceDetails` TEXT NULL,
  ADD COLUMN `transport` VARCHAR(191) NULL,
  ADD COLUMN `destination` VARCHAR(191) NULL,
  ADD COLUMN `sizeColorBreakdown` JSON NULL,
  ADD COLUMN `instructions` JSON NULL;
UPDATE `production_orders` SET `orderDate` = `createdAt`, `confirmedAt` = `createdAt`;
ALTER TABLE `production_stages`
  ADD COLUMN `inputWeightKg` DECIMAL(12,3) NULL,
  ADD COLUMN `outputWeightKg` DECIMAL(12,3) NULL,
  ADD COLUMN `rateUnit` VARCHAR(191) NOT NULL DEFAULT 'PIECE';

CREATE TABLE `production_images` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `stageType` ENUM('CUTTING','PRINT_EMBROIDERY','STITCHING','PACKING','MASTER','FABRIC_PURCHASE','WASHING_COMPACTING','FINAL') NULL,
  `displayName` VARCHAR(191) NULL,
  `color` VARCHAR(191) NULL,
  `sizeLabel` VARCHAR(191) NULL,
  `details` TEXT NULL,
  `fileName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `size` INTEGER NOT NULL,
  `data` LONGBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `production_images_orderId_stageType_idx`(`orderId`, `stageType`),
  PRIMARY KEY (`id`),
  CONSTRAINT `production_images_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `production_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `production_stages` (`id`, `orderId`, `type`, `sequence`, `status`, `plannedQty`, `issuedQty`, `completedQty`, `rejectedQty`, `rate`, `otherCost`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'MASTER', -2, 'COMPLETED', o.`orderedQty`, o.`orderedQty`, o.`orderedQty`, 0, 0, 0, NOW(3), NOW(3) FROM `production_orders` o;
INSERT INTO `production_stages` (`id`, `orderId`, `type`, `sequence`, `status`, `plannedQty`, `issuedQty`, `completedQty`, `rejectedQty`, `rate`, `otherCost`, `rateUnit`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'FABRIC_PURCHASE', -1, 'COMPLETED', o.`orderedQty`, o.`orderedQty`, o.`orderedQty`, 0, 0, 0, 'KG', NOW(3), NOW(3) FROM `production_orders` o;
INSERT INTO `production_stages` (`id`, `orderId`, `type`, `sequence`, `status`, `plannedQty`, `issuedQty`, `completedQty`, `rejectedQty`, `rate`, `otherCost`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'WASHING_COMPACTING', 0, 'COMPLETED', o.`orderedQty`, o.`orderedQty`, o.`orderedQty`, 0, 0, 0, NOW(3), NOW(3) FROM `production_orders` o;
INSERT INTO `production_stages` (`id`, `orderId`, `type`, `sequence`, `status`, `plannedQty`, `issuedQty`, `completedQty`, `rejectedQty`, `rate`, `otherCost`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'FINAL', 5, CASE WHEN p.`status` = 'COMPLETED' THEN 'COMPLETED' ELSE 'PENDING' END, p.`completedQty`, p.`completedQty`, CASE WHEN p.`status` = 'COMPLETED' THEN p.`completedQty` ELSE 0 END, 0, 0, 0, NOW(3), NOW(3)
FROM `production_orders` o JOIN `production_stages` p ON p.`orderId` = o.`id` AND p.`type` = 'PACKING';
