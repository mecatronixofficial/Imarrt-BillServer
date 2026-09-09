import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordProductionPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['cash', 'bank_transfer', 'upi', 'cheque', 'other'])
  method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
