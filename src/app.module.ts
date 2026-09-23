import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { SapModule } from './sap/sap.module.js';
import { DatabaseModule } from './database/database.module.js';
import { CrmModule } from './crm/crm.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { ControlPanelModule } from './control-panel/control-panel.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TenantModule,
    DatabaseModule,
    SapModule,
    AuthModule,
    CrmModule,
    AttendanceModule,
    ControlPanelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
