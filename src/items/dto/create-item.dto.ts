import { IsIn, IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

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
  @MaxLength(20)
  hsnSac?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

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
  @IsIn(['WITHOUT_TAX', 'WITH_TAX'])
  salePriceTaxMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  saleDiscount?: number;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'AMOUNT'])
  saleDiscountType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsIn(['WITHOUT_TAX', 'WITH_TAX'])
  purchasePriceTaxMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;
}
