import { IsUUID, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsOptional() @IsUUID() requestId?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
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
