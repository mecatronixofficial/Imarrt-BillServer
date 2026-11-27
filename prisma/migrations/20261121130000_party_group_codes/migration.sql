-- Party groups get a business-unique code such as "G-0001", like party codes ("P-0001").
ALTER TABLE `party_groups` ADD COLUMN `code` VARCHAR(30) NULL;

-- Number existing groups per business in creation order.
UPDATE `party_groups` g
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `businessId` ORDER BY `createdAt`, `id`) AS `rn`
  FROM `party_groups`
) n ON n.`id` = g.`id`
SET g.`code` = CONCAT('G-', LPAD(n.`rn`, 4, '0'));

CREATE UNIQUE INDEX `party_groups_businessId_code_key` ON `party_groups` (`businessId`, `code`);
