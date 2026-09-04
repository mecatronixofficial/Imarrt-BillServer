import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum } from 'class-validator';
import { InvoiceDeliveryChannel } from '@prisma/client';

export class DeliverInvoiceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(InvoiceDeliveryChannel, { each: true })
  channels: InvoiceDeliveryChannel[];
}
