import { IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateProductionOrderDto {
  @IsString()
  @MaxLength(60)
  orderNumber: string;

  @IsUUID()
  partyId: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsString()
  @MaxLength(150)
  styleName: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  fabricName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fabricGsm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  color?: string;

  @IsOptional()
  @IsObject()
  sizeBreakdown?: Record<string, number>;

  @IsInt()
  @Min(1)
  orderedQty: number;

  @IsNumber()
  @Min(0)
  saleRate: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
