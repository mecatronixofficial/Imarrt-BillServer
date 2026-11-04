ALTER TABLE `purchase_payments`
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedById` VARCHAR(191) NULL,
  ADD COLUMN `voidReason` VARCHAR(500) NULL;

CREATE INDEX `purchase_payments_documentId_voidedAt_idx` ON `purchase_payments`(`documentId`, `voidedAt`);
