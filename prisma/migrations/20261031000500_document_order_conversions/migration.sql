-- AlterTable
ALTER TABLE `business_documents` MODIFY `type` ENUM('QUOTATION', 'PROFORMA_INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_CHALLAN', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SALES_ORDER') NOT NULL;

-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `convertedDocumentId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `purchase_order_items` ADD COLUMN `taxInclusive` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `invoice_items` ADD COLUMN `hsnSac` VARCHAR(191) NULL,
    ADD COLUMN `unit` VARCHAR(191) NOT NULL DEFAULT 'pcs';

-- CreateIndex
CREATE UNIQUE INDEX `purchase_orders_convertedDocumentId_key` ON `purchase_orders`(`convertedDocumentId`);

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_convertedDocumentId_fkey` FOREIGN KEY (`convertedDocumentId`) REFERENCES `business_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
