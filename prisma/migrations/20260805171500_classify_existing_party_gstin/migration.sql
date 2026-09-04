-- Parties that already had an encrypted GSTIN before GST classification was introduced
-- are registered parties, not unregistered parties.
UPDATE `customers`
SET `gstType` = 'REGISTERED_REGULAR'
WHERE `gstType` = 'UNREGISTERED'
  AND `gstin` IS NOT NULL
  AND TRIM(`gstin`) <> '';
