import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import { CreateBusinessDto } from './create-business.dto.js';

/**
 * Every field is optional. Optional text fields accept `null` so clients can
 * clear a value. GSTIN requirements depend on the stored registration state, so
 * the service enforces them rather than the DTO.
 */
export class UpdateBusinessDto extends PartialType(OmitType(CreateBusinessDto, ['gstin'] as const)) {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN must be a valid 15-character GST number',
  })
  gstin?: string | null;
}
