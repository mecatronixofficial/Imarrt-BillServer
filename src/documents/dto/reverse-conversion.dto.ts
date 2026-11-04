import { IsUUID } from 'class-validator';

export class ReverseConversionDto {
  @IsUUID()
  targetId: string;
}
