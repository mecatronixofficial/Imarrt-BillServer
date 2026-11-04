import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class LoanDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) principal: number;
  @IsDateString() openingDate: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsUUID() requestId: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class LoanPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) principal: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) interest: number;
  @IsDateString() paidAt: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsUUID() requestId: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class CashAdjustmentDto {
  /** An outgoing cash entry can be posted directly as a linked loan repayment. */
  @IsOptional() @IsUUID() loanId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) interest?: number;
  @IsIn(['IN', 'OUT']) direction: 'IN' | 'OUT';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) amount: number;
  @IsDateString() date: string;
  /** The type typed in by the user, shown as the transaction's type. Blank shows "Add Cash" / "Reduce Cash". */
  @IsOptional() @IsString() @MaxLength(60) type?: string;
  /** Optional description. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsUUID() requestId: string;
}
export class IncomeCategoryDto {
  @IsString() @Matches(/\S/) @MaxLength(100) name: string;
}
export class IncomeDto {
  @IsUUID() categoryId: string;
  @IsDateString() date: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) amount: number;
  @IsOptional() @IsUUID() accountId?: string;
  @IsUUID() requestId: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class TransferDto {
  @IsOptional() @IsUUID() fromAccountId?: string;
  @IsOptional() @IsUUID() toAccountId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) amount: number;
  @IsDateString() date: string;
  @IsUUID() requestId: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
/** Edits a deposit/withdrawal, other income or cash adjustment. The direction (in or out) never changes. */
export class UpdateFinanceEntryDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) amount: number;
  @IsDateString() date: string;
  /** Cash adjustments only: the typed-in type. Blank goes back to "Add Cash" / "Reduce Cash". */
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Cash adjustments only: switch between adding (IN) and reducing (OUT) cash. */
  @IsOptional() @IsIn(['IN', 'OUT']) direction?: 'IN' | 'OUT';
}
/** Links a "Reduce Cash" adjustment to a loan account as an EMI payment. */
export class ConvertToLoanPaymentDto {
  @IsUUID() loanId: string;
  /** The interest part of the amount; the rest reduces the loan balance. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) interest?: number;
}
export class ChequeActionDto {
  @IsIn(['DEPOSIT', 'REOPEN']) action: 'DEPOSIT' | 'REOPEN';
  @IsOptional() @IsUUID() accountId?: string;
  @IsUUID() requestId: string;
}
