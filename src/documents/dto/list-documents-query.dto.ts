import { DocumentStatus, DocumentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Inclusive issue-date range, as YYYY-MM-DD. */
  @IsOptional()
  @Matches(DAY, { message: 'from must be a date in YYYY-MM-DD format' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to must be a date in YYYY-MM-DD format' })
  to?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
