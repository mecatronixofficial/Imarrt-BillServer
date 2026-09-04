import { IsNumber, IsOptional, IsString, IsUUID, Max, Min, MaxLength } from 'class-validator';

export class InvoiceItemDto {
  @IsOptional()
  @IsUUID()
  itemId?: string; // link to catalog item, optional (allows ad-hoc line items)

  @IsString()
  @MaxLength(200)
  description: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}
