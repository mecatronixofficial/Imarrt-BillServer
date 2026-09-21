CREATE TABLE `purchase_orders` (
  `id` VARCHAR(191) NOT NULL, `businessId` VARCHAR(191) NOT NULL, `branchId` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL, `orderNumber` VARCHAR(191) NOT NULL,
  `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `expectedDeliveryDate` DATETIME(3) NULL,
  `deliveryLocation` TEXT NULL, `paymentTerms` TEXT NULL, `notes` TEXT NULL,
  `status` ENUM('DRAFT','SENT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `subTotal` DECIMAL(12,2) NOT NULL, `taxTotal` DECIMAL(12,2) NOT NULL,
  `discount` DECIMAL(12,2) NOT NULL DEFAULT 0, `grandTotal` DECIMAL(12,2) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `purchase_orders_branchId_orderNumber_key`(`branchId`,`orderNumber`),
  INDEX `purchase_orders_businessId_branchId_status_idx`(`businessId`,`branchId`,`status`),
  INDEX `purchase_orders_supplierId_idx`(`supplierId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_items` (
  `id` VARCHAR(191) NOT NULL, `purchaseOrderId` VARCHAR(191) NOT NULL, `itemId` VARCHAR(191) NULL,
  `description` VARCHAR(191) NOT NULL, `quantity` DECIMAL(12,3) NOT NULL, `unit` VARCHAR(191) NOT NULL DEFAULT 'pcs',
  `unitPrice` DECIMAL(12,2) NOT NULL, `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 0, `lineTotal` DECIMAL(12,2) NOT NULL,
  INDEX `purchase_order_items_purchaseOrderId_idx`(`purchaseOrderId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
