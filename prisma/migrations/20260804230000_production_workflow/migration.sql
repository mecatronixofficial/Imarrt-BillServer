-- Add the production workflow as new business-scoped tables only.
CREATE TABLE `suppliers` (
  `id` VARCHAR(191) NOT NULL,
  `businessId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `contactName` VARCHAR(191) NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NULL,
  `gstin` VARCHAR(191) NULL,
  `address` TEXT NULL,
  `notes` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  INDEX `suppliers_businessId_name_idx` (`businessId`, `name`),
  PRIMARY KEY (`id`),
  CONSTRAINT `suppliers_businessId_fkey`
    FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_orders` (
  `id` VARCHAR(191) NOT NULL,
  `businessId` VARCHAR(191) NULL,
  `orderNumber` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `styleName` VARCHAR(191) NOT NULL,
  `fabricName` VARCHAR(191) NULL,
  `fabricGsm` VARCHAR(191) NULL,
  `color` VARCHAR(191) NULL,
  `sizeBreakdown` JSON NULL,
  `orderedQty` INTEGER NOT NULL,
  `saleRate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `dueDate` DATETIME(3) NULL,
  `status` ENUM('CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `production_orders_businessId_orderNumber_key` (`businessId`, `orderNumber`),
  INDEX `production_orders_businessId_status_idx` (`businessId`, `status`),
  INDEX `production_orders_customerId_idx` (`customerId`),
  INDEX `production_orders_supplierId_idx` (`supplierId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `production_orders_businessId_fkey`
    FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `production_orders_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `production_orders_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `production_orders_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_stages` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `type` ENUM('CUTTING', 'PRINT_EMBROIDERY', 'STITCHING', 'PACKING') NOT NULL,
  `sequence` INTEGER NOT NULL,
  `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
  `partnerName` VARCHAR(191) NULL,
  `dcNumber` VARCHAR(191) NULL,
  `plannedQty` INTEGER NOT NULL DEFAULT 0,
  `issuedQty` INTEGER NOT NULL DEFAULT 0,
  `completedQty` INTEGER NOT NULL DEFAULT 0,
  `rejectedQty` INTEGER NOT NULL DEFAULT 0,
  `rate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `otherCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `startDate` DATETIME(3) NULL,
  `dueDate` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `production_stages_orderId_type_key` (`orderId`, `type`),
  INDEX `production_stages_orderId_sequence_idx` (`orderId`, `sequence`),
  PRIMARY KEY (`id`),
  CONSTRAINT `production_stages_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `production_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_costs` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NULL,
  `category` ENUM('FABRIC', 'COLLAR_RIB', 'ACCESSORIES', 'LABELS', 'TAGS', 'POLY_BAGS', 'BUTTONS', 'CARTONS', 'TRANSPORT', 'OTHER') NOT NULL,
  `description` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 1,
  `rate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `production_costs_orderId_category_idx` (`orderId`, `category`),
  INDEX `production_costs_supplierId_idx` (`supplierId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `production_costs_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `production_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `production_costs_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
