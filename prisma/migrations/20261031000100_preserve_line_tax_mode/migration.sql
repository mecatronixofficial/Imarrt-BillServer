-- Additive migration: existing invoices remain tax exclusive. No totals or stock are rewritten.
ALTER TABLE `invoice_items` ADD COLUMN `taxInclusive` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `business_document_items` ADD COLUMN `taxInclusive` BOOLEAN NOT NULL DEFAULT false;
