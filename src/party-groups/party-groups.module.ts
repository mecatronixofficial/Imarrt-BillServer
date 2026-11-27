import { Module } from '@nestjs/common';
import { PartyGroupsController } from './party-groups.controller.js';
import { PartyGroupsService } from './party-groups.service.js';
@Module({ controllers: [PartyGroupsController], providers: [PartyGroupsService], exports: [PartyGroupsService] })
export class PartyGroupsModule {}