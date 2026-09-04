import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  mfaCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}
