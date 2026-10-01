import { Module } from '@nestjs/common';
import { ControlPanelController } from './control-panel.controller.js';
import { ControlPanelService } from './control-panel.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SapModule } from '../sap/sap.module.js';
import { TenantModule } from '../tenant/tenant.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, SapModule, TenantModule],
  controllers: [ControlPanelController],
  providers: [ControlPanelService],
})
export class ControlPanelModule {}
