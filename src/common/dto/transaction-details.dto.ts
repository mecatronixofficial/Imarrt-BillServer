import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
export class TransactionDetailsDto {
  @IsOptional() @IsString() @MaxLength(150) billingName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(150) transportName?: string;
  @IsOptional() @IsString() @MaxLength(300) deliveryLocation?: string;
  @IsOptional() @IsString() @MaxLength(150) lrNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) eWayBillNumber?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) noOfBags?: number;
}
export function transactionDetails(value: {billingName?:string|null;phone?:string|null;transportName?:string|null;deliveryLocation?:string|null;lrNumber?:string|null;eWayBillNumber?:string|null;noOfBags?:number|null}): TransactionDetailsDto {
  return Object.fromEntries(Object.entries({billingName:value.billingName,phone:value.phone,transportName:value.transportName,deliveryLocation:value.deliveryLocation,lrNumber:value.lrNumber,eWayBillNumber:value.eWayBillNumber,noOfBags:value.noOfBags}).filter(([,v])=>v!=null));
}
export function transactionDetailsText(value: Parameters<typeof transactionDetails>[0]): string {
  const labels:Record<string,string>={billingName:'Billing Name',phone:'Phone',transportName:'Transport',deliveryLocation:'Delivery Location',lrNumber:'LR Number & Date',eWayBillNumber:'E-Way Bill No.',noOfBags:'No. of Bags'};
  return Object.entries(transactionDetails(value)).filter(([,v])=>v!==''&&v!==undefined).map(([k,v])=>`${labels[k]}: ${v}`).join('\n');
}
