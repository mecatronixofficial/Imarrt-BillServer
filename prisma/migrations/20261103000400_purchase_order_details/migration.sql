-- Purchase orders gain the purchase bill's header, logistics and payment-type fields, plus attachments.
ALTER TABLE `purchase_orders` ADD COLUMN `accountId` VARCHAR(191) NULL,
    ADD COLUMN `billingName` VARCHAR(150) NULL,
    ADD COLUMN `eWayBillNumber` VARCHAR(30) NULL,
    ADD COLUMN `lrNumber` VARCHAR(150) NULL,
    ADD COLUMN `noOfBags` INTEGER NULL,
    ADD COLUMN `paymentMethod` VARCHAR(30) NULL,
    ADD COLUMN `paymentReference` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(30) NULL,
    ADD COLUMN `placeOfSupply` VARCHAR(100) NULL,
    ADD COLUMN `roundOff` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `transportName` VARCHAR(150) NULL,
    ADD COLUMN `warehouseId` VARCHAR(191) NULL;

CREATE TABLE `purchase_order_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `kind` ENUM('IMAGE', 'DOCUMENT') NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_order_attachments_purchaseOrderId_createdAt_idx`(`purchaseOrderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `purchase_order_attachments` ADD CONSTRAINT `purchase_order_attachments_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
