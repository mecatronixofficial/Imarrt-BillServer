import { Body, Controller, Get, Headers, Put } from '@nestjs/common';
import { IsBoolean, IsString, Matches, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { ActionSecurityService } from './action-security.service.js';

export class UpdateActionSecurityDto {
  @IsBoolean()
  enabled: boolean;

  @ValidateIf((dto: UpdateActionSecurityDto) => dto.enabled || dto.passcode !== undefined)
  @IsString()
  @Matches(/^[0-9]{6,12}$/, { message: 'Passcode must contain 6–12 digits' })
  passcode?: string;
}

@Controller('action-security')
@RequireMfa()
export class ActionSecurityController {
  constructor(private readonly security: ActionSecurityService) {}

  @Get()
  status(@CurrentUser() user: { id: string }) { return this.security.status(user.id); }

  @Put()
  update(@CurrentUser() user: { id: string }, @Body() dto: UpdateActionSecurityDto, @Headers('x-action-passcode') currentPasscode?: string) {
    return this.security.update(user.id, dto.enabled, dto.passcode, currentPasscode);
  }
}