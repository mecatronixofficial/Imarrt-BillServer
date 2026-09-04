import { IsBoolean, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { PartyBalanceType, PartyDeliveryChannel, PartyDeliveryMode, PartyGstType } from '@prisma/client';

export class CreatePartyDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappNumber?: string;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsEnum(PartyDeliveryMode)
  invoiceDeliveryMode?: PartyDeliveryMode;

  @IsOptional()
  @IsEnum(PartyDeliveryChannel)
  invoiceDeliveryChannel?: PartyDeliveryChannel;

  @ValidateIf((dto: CreatePartyDto) => dto.gstType === PartyGstType.REGISTERED_REGULAR || dto.gstType === PartyGstType.REGISTERED_COMPOSITION || dto.gstType === PartyGstType.SEZ)
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'GSTIN must be a valid 15-character alphanumeric identifier' })
  gstin?: string;

  @IsOptional()
  @IsEnum(PartyGstType)
  gstType?: PartyGstType;

  @IsOptional()
  @IsString()
  billingAddr?: string;

  @IsOptional()
  @IsString()
  shippingAddr?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number;

  @IsOptional()
  @IsEnum(PartyBalanceType)
  openingBalanceType?: PartyBalanceType;

  @IsOptional()
  @IsString()
  notes?: string;
}
