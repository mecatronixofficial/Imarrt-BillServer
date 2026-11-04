import {IsIn,IsNumber,IsOptional,IsString,IsUUID,MaxLength,Min,MinLength} from 'class-validator';
export class WarehouseDto {
 @IsString() @MinLength(1) @MaxLength(100) name:string;
 @IsOptional() @IsString() @MaxLength(2000) address?:string;
}
export class StockOperationDto {
 @IsUUID() requestId:string;
 @IsUUID() itemId:string;
 @IsIn(['IN','OUT','TRANSFER']) kind:string;
 @IsNumber({maxDecimalPlaces:3}) @Min(0.001) quantity:number;
 @IsOptional() @IsUUID() warehouseId?:string;
 @IsOptional() @IsUUID() fromWarehouseId?:string;
 @IsOptional() @IsString() @MaxLength(2000) notes?:string;
}
