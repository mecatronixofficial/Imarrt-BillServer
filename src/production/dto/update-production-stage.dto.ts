import { ProductionStageStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateProductionStageDto {
  @IsOptional()
  @IsEnum(ProductionStageStatus)
  status?: ProductionStageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  partnerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  dcNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  plannedQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  issuedQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  completedQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rejectedQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherCost?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
