import { ProductionCostCategory } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateProductionCostDto {
  @IsEnum(ProductionCostCategory)
  category: ProductionCostCategory;

  @IsString()
  @MaxLength(180)
  description: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
