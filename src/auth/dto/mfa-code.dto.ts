import { IsString, Matches } from 'class-validator';

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Authenticator code must contain 6 digits' })
  code: string;
}
