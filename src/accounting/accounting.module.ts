import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { AuditService } from '../common/utils/audit.service.js';
@Module({controllers:[AccountingController,FinanceController],providers:[FinanceService,AccountingService,AuditService],exports:[FinanceService]})
export class AccountingModule {}
