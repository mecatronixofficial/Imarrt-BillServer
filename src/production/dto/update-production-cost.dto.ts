import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProductionCostDto } from './create-production-cost.dto.js';

// Payments are recorded through the payment-out flow, so paid amount is not editable here.
export class UpdateProductionCostDto extends PartialType(OmitType(CreateProductionCostDto, ['paidAmount'] as const)) {}
