import { PartialType } from '@nestjs/mapped-types';
import { CreatePartyDto } from './create-party.dto.js';

export class UpdatePartyDto extends PartialType(CreatePartyDto) {}
