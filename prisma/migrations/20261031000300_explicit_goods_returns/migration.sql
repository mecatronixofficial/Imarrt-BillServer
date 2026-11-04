-- Existing adjustments retain their original stock behavior. New returns opt in explicitly.
ALTER TABLE `business_documents` ADD COLUMN `returnStock` BOOLEAN NOT NULL DEFAULT false;
