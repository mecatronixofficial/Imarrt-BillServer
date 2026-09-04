import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsNumber()
  @Min(0)
  salePrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;
}
