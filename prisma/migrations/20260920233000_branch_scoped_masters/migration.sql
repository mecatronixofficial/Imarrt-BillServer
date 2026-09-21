ALTER TABLE `customers` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `suppliers` ADD COLUMN `branchId` VARCHAR(191) NULL;
ALTER TABLE `items` ADD COLUMN `branchId` VARCHAR(191) NULL;

UPDATE `customers` record
JOIN `branches` branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id` WHERE record.`branchId` IS NULL;
UPDATE `suppliers` record
JOIN `branches` branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id` WHERE record.`branchId` IS NULL;
UPDATE `items` record
JOIN `branches` branch ON branch.`businessId` = record.`businessId` AND branch.`code` = 'MAIN'
SET record.`branchId` = branch.`id` WHERE record.`branchId` IS NULL;

CREATE INDEX `customers_branchId_name_idx` ON `customers` (`branchId`, `name`);
CREATE INDEX `suppliers_branchId_name_idx` ON `suppliers` (`branchId`, `name`);
CREATE INDEX `items_branchId_name_idx` ON `items` (`branchId`, `name`);
ALTER TABLE `customers` ADD CONSTRAINT `customers_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `items` ADD CONSTRAINT `items_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
