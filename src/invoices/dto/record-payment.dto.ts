import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['cash', 'bank_transfer', 'upi', 'cheque', 'other'])
  method: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
