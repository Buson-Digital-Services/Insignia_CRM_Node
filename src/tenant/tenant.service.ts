import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SqlConnectionConfig, TenantConfig } from '../common/types.js';

@Injectable()
export class TenantService {
  private readonly tenants: Map<string, TenantConfig>;

  constructor(private readonly config: ConfigService) {
    const codes = (this.config.getOrThrow<string>('TENANT_CODES') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    this.tenants = new Map(
      codes.map((code) => {
        const prefix = `TENANT_${code}`;
        const conn = (suffix: string): SqlConnectionConfig => ({
          server: this.config.getOrThrow<string>(`${prefix}_${suffix}_SERVER`),
          database: this.config.getOrThrow<string>(`${prefix}_${suffix}_NAME`),
          user: this.config.getOrThrow<string>(`${prefix}_${suffix}_USER`),
          password: this.config.getOrThrow<string>(`${prefix}_${suffix}_PASSWORD`),
        });

        const tenant: TenantConfig = {
          code,
          name: this.config.getOrThrow<string>(`${prefix}_NAME`),
          db: conn('DB'),
          sapDb: conn('SAPDB'),
        };
        return [code, tenant];
      }),
    );
  }

  list(): TenantConfig[] {
    return [...this.tenants.values()];
  }

  get(code: string): TenantConfig {
    const tenant = this.tenants.get(code.toUpperCase());
    if (!tenant) {
      throw new NotFoundException(`Unknown tenant/shop code: ${code}`);
    }
    return tenant;
  }
}
