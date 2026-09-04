import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  // Strong password policy; bcrypt inputs are capped at 72 characters.
  @IsString()
  @MinLength(10)
  @MaxLength(72) // bcrypt max input length
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Password must include upper-case, lower-case, number, and symbol',
  })
  password: string;
}
