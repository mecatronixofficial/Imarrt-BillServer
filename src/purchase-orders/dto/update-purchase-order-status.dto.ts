import { IsEnum } from 'class-validator';
import { PurchaseOrderStatus } from '@prisma/client';
export class UpdatePurchaseOrderStatusDto { @IsEnum(PurchaseOrderStatus) status: PurchaseOrderStatus; }
