import { IsEnum } from 'class-validator';
import { DocumentStatus } from '@prisma/client';

export class UpdateDocumentStatusDto {
  @IsEnum(DocumentStatus)
  status: DocumentStatus;
}
