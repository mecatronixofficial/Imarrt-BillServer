import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, Max, MinLength } from 'class-validator';
export class AccountDto {
  @IsString() @MinLength(1) @MaxLength(150) accountHolder: string;
  @IsString() @MinLength(1) @MaxLength(150) bankName: string;
  @Matches(/^\d{9,18}$/) accountNumber: string;
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/) ifsc: string;
  @IsString() @MaxLength(150) branch: string;
  @IsIn(['CURRENT','SAVINGS','CASH_CREDIT','OVERDRAFT']) accountType: string;
  @IsString() @MaxLength(150) upiId: string;
  @IsNumber({maxDecimalPlaces:2}) openingBalance: number;
  @IsBoolean() primary: boolean;
}
export class ExpenseDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsString() @MinLength(1) @MaxLength(200) description: string;
  @IsString() @MinLength(1) @MaxLength(80) category: string;
  @IsDateString() expenseDate: string;
  @IsNumber({maxDecimalPlaces:2}) @Min(0.01) amount: number;
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(100) taxRate?: number;
  @IsIn(['cash','bank_transfer','upi','cheque','other']) method: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(150) reference?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}
export class ExpenseCategoryDto {
  @IsString() @Matches(/\S/, { message: 'Enter a category name' }) @MaxLength(80) name: string;
}
export class DeleteExpenseCategoryQueryDto {
  /** Category that receives this category's expenses before it is deleted. */
  @IsOptional() @IsUUID() moveTo?: string;
}
