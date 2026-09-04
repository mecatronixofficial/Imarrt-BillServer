import { IsString, MaxLength } from 'class-validator';

export class DisableMfaDto {
  @IsString()
  @MaxLength(72)
  password: string;

  @IsString()
  code: string;
}
