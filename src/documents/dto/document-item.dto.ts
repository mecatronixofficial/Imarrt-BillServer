import { TrackingFieldsDto } from '../../common/dto/tracking-fields.dto.js';
import { Matches, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class DocumentItemDto extends TrackingFieldsDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsString()
  @MaxLength(200)
  @Matches(/\S/, {message:'Item description is required'})
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnSac?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

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
