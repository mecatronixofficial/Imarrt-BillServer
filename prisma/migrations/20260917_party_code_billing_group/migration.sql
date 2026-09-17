-- AlterTable
ALTER TABLE `customers`
  ADD COLUMN `code` VARCHAR(191) NULL,
  ADD COLUMN `billingName` VARCHAR(191) NULL,
  ADD COLUMN `group` VARCHAR(191) NULL;

-- CreateIndex
ALTER TABLE `customers`
  ADD UNIQUE INDEX `customers_businessId_code_key` (`businessId`, `code`);

-- CreateIndex
ALTER TABLE `customers`
  ADD INDEX `customers_businessId_group_idx` (`businessId`, `group`);
