-- Let a branch optionally sit beneath another branch of the same company so
-- branches can be organised as a tree. Each branch keeps its own records.
ALTER TABLE `branches` ADD COLUMN `parentId` VARCHAR(191) NULL;

CREATE INDEX `branches_parentId_idx` ON `branches` (`parentId`);

ALTER TABLE `branches`
  ADD CONSTRAINT `branches_parentId_fkey`
    FOREIGN KEY (`parentId`) REFERENCES `branches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
