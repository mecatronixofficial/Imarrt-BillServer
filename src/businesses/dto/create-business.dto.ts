import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @IsBoolean()
  gstRegistered: boolean;

  @ValidateIf((dto: CreateBusinessDto) => dto.gstRegistered)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN must be a valid 15-character GST number',
  })
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^\d{2}$/, { message: 'State code must contain two digits' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}
