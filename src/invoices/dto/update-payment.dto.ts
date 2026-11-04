import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdatePaymentDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsIn(['cash', 'bank_transfer', 'upi', 'cheque', 'other'])
  method?: string;

  /** `null` clears the linked cash/bank account. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
