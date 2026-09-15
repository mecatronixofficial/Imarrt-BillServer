CREATE TABLE `invoice_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `kind` ENUM('IMAGE', 'DOCUMENT') NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `invoice_attachments_invoiceId_createdAt_idx`(`invoiceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invoice_attachments`
    ADD CONSTRAINT `invoice_attachments_invoiceId_fkey`
    FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
