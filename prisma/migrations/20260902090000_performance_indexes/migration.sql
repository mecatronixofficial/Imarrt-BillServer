-- Scope item SKUs to a business and add indexes used by list and ledger queries.
ALTER TABLE `businesses` ADD COLUMN `gstinHash` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `businesses_gstinHash_key` ON `businesses`(`gstinHash`);

DROP INDEX `items_sku_key` ON `items`;
CREATE UNIQUE INDEX `items_businessId_sku_key` ON `items`(`businessId`, `sku`);

CREATE INDEX `production_orders_businessId_createdAt_idx`
  ON `production_orders`(`businessId`, `createdAt`);
CREATE INDEX `invoices_businessId_createdAt_idx`
  ON `invoices`(`businessId`, `createdAt`);
CREATE INDEX `invoices_customerId_issueDate_idx`
  ON `invoices`(`customerId`, `issueDate`);
CREATE INDEX `business_documents_businessId_issueDate_idx`
  ON `business_documents`(`businessId`, `issueDate`);
CREATE INDEX `invoice_items_invoiceId_idx` ON `invoice_items`(`invoiceId`);
CREATE INDEX `payment_records_invoiceId_paidAt_idx`
  ON `payment_records`(`invoiceId`, `paidAt`);
