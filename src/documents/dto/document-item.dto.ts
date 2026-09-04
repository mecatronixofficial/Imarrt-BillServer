import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class DocumentItemDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsString()
  @MaxLength(200)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnSac?: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}
