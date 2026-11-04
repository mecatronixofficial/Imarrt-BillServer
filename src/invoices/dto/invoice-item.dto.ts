import { TrackingFieldsDto } from '../../common/dto/tracking-fields.dto.js';
import { Matches, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MaxLength } from 'class-validator';

export class InvoiceItemDto extends TrackingFieldsDto {
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @MaxLength(20) hsnSac?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string; // link to catalog item, optional (allows ad-hoc line items)

  @IsString()
  @MaxLength(200)
  @Matches(/\S/, {message:'Item description is required'})
  description: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;
}
