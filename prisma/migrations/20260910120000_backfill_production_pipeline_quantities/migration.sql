UPDATE `production_stages` AS `next_stage`
INNER JOIN `production_stages` AS `previous_stage`
  ON `previous_stage`.`orderId` = `next_stage`.`orderId`
  AND `previous_stage`.`type` = 'CUTTING'
SET
  `next_stage`.`plannedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`issuedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`status` = 'IN_PROGRESS'
WHERE `next_stage`.`type` = 'STITCHING'
  AND `previous_stage`.`status` = 'COMPLETED'
  AND `previous_stage`.`completedQty` > 0
  AND `next_stage`.`status` = 'PENDING'
  AND `next_stage`.`completedQty` = 0
  AND `next_stage`.`rejectedQty` = 0;

UPDATE `production_stages` AS `next_stage`
INNER JOIN `production_stages` AS `previous_stage`
  ON `previous_stage`.`orderId` = `next_stage`.`orderId`
  AND `previous_stage`.`type` = 'STITCHING'
SET
  `next_stage`.`plannedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`issuedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`status` = 'IN_PROGRESS'
WHERE `next_stage`.`type` = 'PRINT_EMBROIDERY'
  AND `previous_stage`.`status` = 'COMPLETED'
  AND `previous_stage`.`completedQty` > 0
  AND `next_stage`.`status` = 'PENDING'
  AND `next_stage`.`completedQty` = 0
  AND `next_stage`.`rejectedQty` = 0;

UPDATE `production_stages` AS `next_stage`
INNER JOIN `production_stages` AS `previous_stage`
  ON `previous_stage`.`orderId` = `next_stage`.`orderId`
  AND `previous_stage`.`type` = 'PRINT_EMBROIDERY'
SET
  `next_stage`.`plannedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`issuedQty` = `previous_stage`.`completedQty`,
  `next_stage`.`status` = 'IN_PROGRESS'
WHERE `next_stage`.`type` = 'PACKING'
  AND `previous_stage`.`status` = 'COMPLETED'
  AND `previous_stage`.`completedQty` > 0
  AND `next_stage`.`status` = 'PENDING'
  AND `next_stage`.`completedQty` = 0
  AND `next_stage`.`rejectedQty` = 0;
