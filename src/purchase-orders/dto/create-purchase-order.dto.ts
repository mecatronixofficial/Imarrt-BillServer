import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

class PurchaseOrderItemDto {
  @IsOptional() @IsUUID() itemId?: string;
  @IsString() @MaxLength(191) description: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) taxRate?: number;
}

export class CreatePurchaseOrderDto {
  @IsString() @MaxLength(60) orderNumber: string;
  @IsUUID() supplierId: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) deliveryLocation?: string;
  @IsOptional() @IsString() @MaxLength(5000) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
