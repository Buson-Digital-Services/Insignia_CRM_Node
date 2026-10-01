import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { SellerkitController } from './sellerkit.controller.js';
import { CrmService } from './crm.service.js';
import { EmailService } from './email.service.js';
import { SapModule } from '../sap/sap.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TenantModule } from '../tenant/tenant.module.js';

@Module({
  imports: [SapModule, DatabaseModule, AuthModule, TenantModule],
  controllers: [CrmController, SellerkitController],
  providers: [CrmService, EmailService],
})
export class CrmModule {}
