import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RecordPurchasePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['cash', 'bank_transfer', 'upi', 'cheque', 'other'])
  method: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
