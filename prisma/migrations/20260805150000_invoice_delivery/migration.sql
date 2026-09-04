-- Customer-level invoice delivery preferences and auditable delivery attempts.
ALTER TABLE `customers`
  ADD COLUMN `whatsappNumber` VARCHAR(191) NULL,
  ADD COLUMN `invoiceDeliveryMode` ENUM('MANUAL', 'AUTOMATIC') NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `invoiceDeliveryChannel` ENUM('EMAIL', 'WHATSAPP', 'BOTH') NOT NULL DEFAULT 'BOTH';

CREATE TABLE `invoice_deliveries` (
  `id` VARCHAR(191) NOT NULL,
  `invoiceId` VARCHAR(191) NOT NULL,
  `channel` ENUM('EMAIL', 'WHATSAPP') NOT NULL,
  `recipient` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `providerMessageId` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `invoice_deliveries_invoiceId_channel_createdAt_idx` (`invoiceId`, `channel`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `invoice_deliveries_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
