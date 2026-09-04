import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,24}$/, { message: 'Branch code must contain 2-24 letters, numbers, underscores, or hyphens' })
  code: string;

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
