import { IsEmail, IsIn, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Role } from '@prisma/client';

// Owners add staff via this DTO. OWNER is intentionally excluded; additional
// owner accounts use the owner-protected registration endpoint.
const ADDABLE_ROLES = [Role.ACCOUNTANT, Role.STAFF] as const;

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Password must include upper-case, lower-case, number, and symbol',
  })
  password: string;

  @IsIn(ADDABLE_ROLES)
  role: typeof ADDABLE_ROLES[number];
}
