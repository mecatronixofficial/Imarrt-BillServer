import { Module } from '@nestjs/common';
import { ActionSecurityController } from './action-security.controller.js';
import { ActionSecurityService } from './action-security.service.js';

@Module({ controllers: [ActionSecurityController], providers: [ActionSecurityService], exports: [ActionSecurityService] })
export class ActionSecurityModule {}