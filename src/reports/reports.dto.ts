import { IsIn, IsOptional, Matches } from 'class-validator';

export const TRANSACTION_KINDS = [
  'SALE', 'PAYMENT_IN', 'SALE_RETURN', 'ESTIMATE', 'PROFORMA', 'SALE_ORDER', 'DELIVERY_CHALLAN',
  'PURCHASE', 'PAYMENT_OUT', 'PURCHASE_RETURN', 'PURCHASE_ORDER', 'EXPENSE',
  'OTHER_INCOME', 'EMI', 'LOAN', 'CASH_ADJUSTMENT', 'TRANSFER',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class TransactionReportQueryDto {
  /** Inclusive period, as YYYY-MM-DD. */
  @Matches(DAY, { message: 'from must be a date in YYYY-MM-DD format' }) from: string;
  @Matches(DAY, { message: 'to must be a date in YYYY-MM-DD format' }) to: string;
  /** Only one kind of transaction; omit for all. */
  @IsOptional() @IsIn(TRANSACTION_KINDS) type?: TransactionKind;
}
