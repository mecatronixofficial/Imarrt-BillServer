import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Optional reference fields; quantities and financial totals remain authoritative. */
export class TrackingFieldsDto {
  @IsOptional() @IsString() @MaxLength(120) brand?: string;
  @IsOptional() @IsString() @MaxLength(1000) serialNumbers?: string;
  @IsOptional() @IsString() @MaxLength(100) lotNo?: string;
  @IsOptional() @IsString() @MaxLength(100) barcode?: string;
  @IsOptional() @IsString() @MaxLength(80) size?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(999999999) count?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) mrp?: number;
}

export function trackingFields(value: {
  brand?: string | null; serialNumbers?: string | null; lotNo?: string | null;
  barcode?: string | null; size?: string | null; count?: unknown; mrp?: unknown;
}): TrackingFieldsDto {
  return {
    ...(value.brand != null ? { brand: value.brand } : {}),
    ...(value.serialNumbers != null ? { serialNumbers: value.serialNumbers } : {}),
    ...(value.lotNo != null ? { lotNo: value.lotNo } : {}),
    ...(value.barcode != null ? { barcode: value.barcode } : {}),
    ...(value.size != null ? { size: value.size } : {}),
    ...(value.count != null ? { count: Number(value.count) } : {}),
    ...(value.mrp != null ? { mrp: Number(value.mrp) } : {}),
  };
}
