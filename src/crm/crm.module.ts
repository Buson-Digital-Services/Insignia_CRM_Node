import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { CrmService } from './crm.service.js';
import { EmailService } from './email.service.js';
import { SapModule } from '../sap/sap.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [SapModule, DatabaseModule, AuthModule],
  controllers: [CrmController],
  providers: [CrmService, EmailService],
})
export class CrmModule {}
