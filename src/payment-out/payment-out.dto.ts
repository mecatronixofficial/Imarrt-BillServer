import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'other'] as const;

export class PaymentSplitDto {
  @IsIn(PAYMENT_METHODS)
  method: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;
}

export class BillAllocationDto {
  @IsUUID()
  documentId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class CreatePaymentOutDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Settles bills without moving money. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  /** How the money was paid; may be empty when the whole amount is a discount. */
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits: PaymentSplitDto[];

  /** Which bills to settle. Omit to settle the oldest due bills first. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BillAllocationDto)
  allocations?: BillAllocationDto[];
}

export class UpdatePaymentOutDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class VoidPaymentOutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
