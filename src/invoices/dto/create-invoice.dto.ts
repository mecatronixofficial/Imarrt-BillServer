import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsEnum,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { InvoiceDeliveryChannel, PartyDeliveryMode } from '@prisma/client';
import { InvoiceItemDto } from './invoice-item.dto.js';

export class CreateInvoiceDto {
  @IsUUID()
  partyId: string;

  /** Required only when the company turned off automatic numbering. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,39}$/, { message: 'Invoice number may use letters, numbers, / _ . - and be at most 40 characters' })
  invoiceNumber?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsEnum(PartyDeliveryMode)
  deliveryMode?: PartyDeliveryMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsEnum(InvoiceDeliveryChannel, { each: true })
  deliveryChannels?: InvoiceDeliveryChannel[];

  @IsArray()
  @ArrayMinSize(1, { message: 'Invoice must have at least one line item' })
  @ArrayMaxSize(200, { message: 'Invoice cannot exceed 200 line items' })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}
