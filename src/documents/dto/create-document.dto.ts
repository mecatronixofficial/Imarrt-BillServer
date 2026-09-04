import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { DocumentItemDto } from './document-item.dto';

export class CreateDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  referenceInvoiceId?: string;

  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  placeOfSupply?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  transportName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  eWayBillNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Document must have at least one line item' })
  @ArrayMaxSize(200, { message: 'Document cannot exceed 200 line items' })
  @ValidateNested({ each: true })
  @Type(() => DocumentItemDto)
  items: DocumentItemDto[];
}
