import { ProductionOrderStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateProductionStatusDto {
  @IsEnum(ProductionOrderStatus)
  status: ProductionOrderStatus;
}
