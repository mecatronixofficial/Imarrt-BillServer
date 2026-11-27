-- Company-wise invoice numbering: one running counter per company and resolved prefix.
-- Existing invoice numbers are not touched; counters start lazily from the highest number already saved.
CREATE TABLE `invoice_number_sequences` (
  `businessId` VARCHAR(191) NOT NULL,
  `prefix` VARCHAR(64) NOT NULL,
  `lastNumber` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`businessId`, `prefix`),
  CONSTRAINT `invoice_number_sequences_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Company-wide duplicate checks look invoices up by company and number.
CREATE INDEX `invoices_businessId_invoiceNumber_idx` ON `invoices` (`businessId`, `invoiceNumber`);
