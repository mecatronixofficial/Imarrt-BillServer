CREATE TABLE `production_payments` (
  `id` VARCHAR(191) NOT NULL,
  `costId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `method` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `production_payments_costId_paidAt_idx`(`costId`, `paidAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `production_payments_costId_fkey` FOREIGN KEY (`costId`) REFERENCES `production_costs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
