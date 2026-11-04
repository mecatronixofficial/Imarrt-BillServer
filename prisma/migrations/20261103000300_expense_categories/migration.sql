CREATE TABLE `expense_categories` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expense_categories_businessId_branchId_idx`(`businessId`, `branchId`),
    UNIQUE INDEX `expense_categories_branchId_name_key`(`branchId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every category name already used on an expense becomes a category of its branch.
INSERT INTO `expense_categories` (`id`, `businessId`, `branchId`, `name`, `createdAt`)
SELECT UUID(), e.`businessId`, e.`branchId`, LEFT(TRIM(e.`category`), 80), MIN(e.`createdAt`)
FROM `expenses` e
WHERE TRIM(e.`category`) <> ''
GROUP BY e.`businessId`, e.`branchId`, LEFT(TRIM(e.`category`), 80);
