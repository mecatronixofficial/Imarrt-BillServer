ALTER TABLE `business_documents`
  ADD COLUMN `paymentMethod` VARCHAR(191) NULL;

CREATE TABLE `business_document_attachments` (
  `id` VARCHAR(191) NOT NULL,
  `documentId` VARCHAR(191) NOT NULL,
  `kind` ENUM('IMAGE', 'DOCUMENT') NOT NULL,
  `fileName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(100) NOT NULL,
  `size` INTEGER NOT NULL,
  `data` LONGBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `business_document_attachments_documentId_createdAt_idx`(`documentId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `business_document_attachments`
  ADD CONSTRAINT `business_document_attachments_documentId_fkey`
  FOREIGN KEY (`documentId`) REFERENCES `business_documents`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
