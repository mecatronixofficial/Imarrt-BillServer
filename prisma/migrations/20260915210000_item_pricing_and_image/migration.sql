ALTER TABLE `items`
    ADD COLUMN `hsnSac` VARCHAR(191) NULL,
    ADD COLUMN `category` VARCHAR(191) NULL,
    ADD COLUMN `salePriceTaxMode` VARCHAR(191) NOT NULL DEFAULT 'WITHOUT_TAX',
    ADD COLUMN `saleDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `saleDiscountType` VARCHAR(191) NOT NULL DEFAULT 'PERCENTAGE',
    ADD COLUMN `wholesalePrice` DECIMAL(12, 2) NULL,
    ADD COLUMN `purchasePrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `purchasePriceTaxMode` VARCHAR(191) NOT NULL DEFAULT 'WITHOUT_TAX';

CREATE TABLE `item_images` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `item_images_itemId_key`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `item_images`
    ADD CONSTRAINT `item_images_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `items`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
