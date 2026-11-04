import { TrackingFieldsDto } from '../../common/dto/tracking-fields.dto.js';
import { TransactionDetailsDto } from '../../common/dto/transaction-details.dto.js';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PurchaseOrderItemDto extends TrackingFieldsDto {
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsUUID() itemId?: string;
  @IsString() @MaxLength(191) description: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(100) taxRate?: number;
}

export class CreatePurchaseOrderDto extends TransactionDetailsDto {
  /** Left blank, the next number in the PORD-<year>-000001 series is used. */
  @IsOptional() @IsString() @MaxLength(60) orderNumber?: string;
  /** Orders start as a draft unless saved as sent or confirmed. */
  @IsOptional() @IsIn(['DRAFT', 'SENT', 'CONFIRMED']) status?: 'DRAFT' | 'SENT' | 'CONFIRMED';
  @IsUUID() supplierId: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(5000) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsBoolean() roundOff?: boolean;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(100) placeOfSupply?: string;
  /** How the supplier will be paid. `credit` means pay later. */
  @IsOptional() @IsIn(['credit', 'cash', 'bank_transfer', 'upi', 'cheque', 'other']) paymentMethod?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(191) paymentReference?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
