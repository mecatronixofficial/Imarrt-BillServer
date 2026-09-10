UPDATE "production_stages"
SET "sequence" = CASE
  WHEN "type" = 'CUTTING' THEN 1
  WHEN "type" = 'STITCHING' THEN 2
  WHEN "type" = 'PRINT_EMBROIDERY' THEN 3
  WHEN "type" = 'PACKING' THEN 4
  ELSE "sequence"
END
WHERE "type" IN ('CUTTING', 'STITCHING', 'PRINT_EMBROIDERY', 'PACKING');
