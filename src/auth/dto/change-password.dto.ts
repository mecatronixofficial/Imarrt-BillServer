import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'New password must include upper-case, lower-case, number, and symbol',
  })
  newPassword: string;
}
