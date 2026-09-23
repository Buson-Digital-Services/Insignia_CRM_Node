import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { TenantModule } from '../tenant/tenant.module.js';

@Module({
  imports: [TenantModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
