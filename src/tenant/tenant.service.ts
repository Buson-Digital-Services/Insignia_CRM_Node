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
          domain: this.config.get<string>(`${prefix}_${suffix}_DOMAIN`) || undefined, // blank = SQL login
        });

        const name = this.config.getOrThrow<string>(`${prefix}_NAME`);
        const redirectFrom = this.config.get<string>(`${prefix}_SAP_URL_FROM`);
        const redirectTo = this.config.get<string>(`${prefix}_SAP_URL_TO`);
        const tenant: TenantConfig = {
          code,
          name,
          urls: {
            countryName: name,
            queryURL: this.config.getOrThrow<string>(`${prefix}_QUERY_URL`),
            localURL: this.config.getOrThrow<string>(`${prefix}_LOCAL_URL`),
            reportURL: this.config.getOrThrow<string>(`${prefix}_REPORT_URL`),
            schemeReq: this.config.getOrThrow<string>(`${prefix}_SCHEME_REQ`).toLowerCase() === 'true',
          },
          currency: this.config.get<string>(`${prefix}_CURRENCY`)?.trim().toUpperCase() || undefined,
          db: conn('DB'),
          sapDb: conn('SAPDB'),
          sapUrlFromEnv: this.config.get<string>(`${prefix}_SAP_URL_FROM_ENV`)?.trim().toLowerCase() === 'true',
          sapUrlRedirect: redirectFrom && redirectTo ? { from: redirectFrom.split(',').map((f) => f.trim()).filter(Boolean), to: redirectTo } : undefined,
          sapCompanyDbForUsers: this.config.get<string>(`${prefix}_SAP_COMPANYDB_FOR_USERS`) || undefined,
          sap: {
            sapUrl: this.config.getOrThrow<string>(`${prefix}_SAP_URL`),
            sapCompanyDb: this.config.getOrThrow<string>(`${prefix}_SAP_COMPANYDB`),
            sapUsername: this.config.getOrThrow<string>(`${prefix}_SAP_USER`),
            sapPassword: this.config.getOrThrow<string>(`${prefix}_SAP_PASSWORD`),
          },
        };
        return [code, tenant];
      }),
    );
  }

  list(): TenantConfig[] {
    return [...this.tenants.values()];
  }

  /** Code ("TZ") or country name ("Tanzania"), case-insensitive - the app's dropdown sends the name. */
  find(code: string): TenantConfig | undefined {
    const key = code.toUpperCase();
    return this.tenants.get(key) ?? this.list().find((t) => t.name.toUpperCase() === key);
  }

  get(code: string): TenantConfig {
    const tenant = this.find(code);
    if (!tenant) {
      throw new NotFoundException(`Unknown tenant/shop code: ${code}`);
    }
    return tenant;
  }
}
