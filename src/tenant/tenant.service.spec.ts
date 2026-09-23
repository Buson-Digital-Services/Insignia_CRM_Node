import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TenantService } from './tenant.service.js';

function makeConfig(env: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = env[key];
      if (value === undefined) {
        throw new Error(`Missing env var ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService;
}

describe('TenantService', () => {
  const env = {
    TENANT_CODES: 'TZ, KE',
    TENANT_TZ_NAME: 'Tanzania',
    TENANT_TZ_DB_SERVER: 'tz-db',
    TENANT_TZ_DB_NAME: 'CRM_TZ',
    TENANT_TZ_DB_USER: 'sa',
    TENANT_TZ_DB_PASSWORD: 'pw',
    TENANT_TZ_SAPDB_SERVER: 'tz-sap',
    TENANT_TZ_SAPDB_NAME: 'SAP_TZ',
    TENANT_TZ_SAPDB_USER: 'sa',
    TENANT_TZ_SAPDB_PASSWORD: 'pw',
    TENANT_KE_NAME: 'Kenya',
    TENANT_KE_DB_SERVER: 'ke-db',
    TENANT_KE_DB_NAME: 'CRM_KE',
    TENANT_KE_DB_USER: 'sa',
    TENANT_KE_DB_PASSWORD: 'pw',
    TENANT_KE_SAPDB_SERVER: 'ke-sap',
    TENANT_KE_SAPDB_NAME: 'SAP_KE',
    TENANT_KE_SAPDB_USER: 'sa',
    TENANT_KE_SAPDB_PASSWORD: 'pw',
  };

  it('parses TENANT_CODES (trimming whitespace) into one config per code', () => {
    const service = new TenantService(makeConfig(env));
    expect(service.list().map((t) => t.code)).toEqual(['TZ', 'KE']);
  });

  it('builds separate app-DB and SAP-mirror-DB connection configs per tenant', () => {
    const service = new TenantService(makeConfig(env));
    const tz = service.get('TZ');
    expect(tz.db).toEqual({ server: 'tz-db', database: 'CRM_TZ', user: 'sa', password: 'pw' });
    expect(tz.sapDb).toEqual({ server: 'tz-sap', database: 'SAP_TZ', user: 'sa', password: 'pw' });
  });

  it('looks up a tenant case-insensitively', () => {
    const service = new TenantService(makeConfig(env));
    expect(service.get('tz').name).toBe('Tanzania');
  });

  it('throws NotFoundException for an unknown shop code', () => {
    const service = new TenantService(makeConfig(env));
    expect(() => service.get('UG')).toThrow('Unknown tenant/shop code: UG');
  });
});
