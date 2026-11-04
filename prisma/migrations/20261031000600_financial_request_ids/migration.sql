-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `lastEditRequestId` VARCHAR(191) NULL,
    ADD COLUMN `requestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `business_documents` ADD COLUMN `requestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `purchase_payments` ADD COLUMN `requestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payment_records` ADD COLUMN `requestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `requestId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `invoices_branchId_requestId_key` ON `invoices`(`branchId`, `requestId`);

-- CreateIndex
CREATE UNIQUE INDEX `business_documents_branchId_requestId_key` ON `business_documents`(`branchId`, `requestId`);

-- CreateIndex
CREATE UNIQUE INDEX `purchase_payments_documentId_requestId_key` ON `purchase_payments`(`documentId`, `requestId`);

-- CreateIndex
CREATE UNIQUE INDEX `payment_records_invoiceId_requestId_key` ON `payment_records`(`invoiceId`, `requestId`);

-- CreateIndex
CREATE UNIQUE INDEX `expenses_branchId_requestId_key` ON `expenses`(`branchId`, `requestId`);
