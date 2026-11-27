-- Remember whether each sale invoice and business document was rounded off, so editing it
-- recalculates exactly like the saved copy (purchase orders already store this).
ALTER TABLE `invoices` ADD COLUMN `roundOff` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `business_documents` ADD COLUMN `roundOff` BOOLEAN NOT NULL DEFAULT false;

-- Existing records: the total was rounded when the saved grand total differs from
-- subtotal + tax - discount (the same rule the PDF uses to print the "Round off" row).
-- Saved totals are not changed.
UPDATE `invoices` SET `roundOff` = true
WHERE ABS(`grandTotal` - (`subTotal` + `taxTotal` - `discount`)) >= 0.005;
UPDATE `business_documents` SET `roundOff` = true
WHERE ABS(`grandTotal` - (`subTotal` + `taxTotal` - `discount`)) >= 0.005;

-- Round off is now on by default for every company (it can still be turned off per company
-- in Settings > Transaction, and per transaction with the Round Off checkbox).
UPDATE `businesses`
SET `preferences` = JSON_SET(`preferences`, '$.transaction.autoRoundOff', CAST('true' AS JSON))
WHERE `preferences` IS NOT NULL
  AND JSON_EXTRACT(`preferences`, '$.transaction.autoRoundOff') = CAST('false' AS JSON);
