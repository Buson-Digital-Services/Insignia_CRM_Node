import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TenantService } from './tenant.service.js';

function makeConfig(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
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
    TENANT_TZ_QUERY_URL: 'http://tz-q/api/SellerKit',
    TENANT_TZ_LOCAL_URL: 'http://tz-api/api/auth/',
    TENANT_TZ_REPORT_URL: 'http://tz-r/api/',
    TENANT_TZ_SCHEME_REQ: 'true',
    TENANT_TZ_SAP_URL: 'http://tz-sl/b1s/v1/',
    TENANT_TZ_SAP_COMPANYDB: 'SAP_TZ',
    TENANT_TZ_SAP_USER: 'manager',
    TENANT_TZ_SAP_PASSWORD: 'pw',
    TENANT_KE_NAME: 'Kenya',
    TENANT_KE_DB_SERVER: 'ke-db',
    TENANT_KE_DB_NAME: 'CRM_KE',
    TENANT_KE_DB_USER: 'sa',
    TENANT_KE_DB_PASSWORD: 'pw',
    TENANT_KE_SAPDB_SERVER: 'ke-sap',
    TENANT_KE_SAPDB_NAME: 'SAP_KE',
    TENANT_KE_SAPDB_USER: 'sa',
    TENANT_KE_SAPDB_PASSWORD: 'pw',
    TENANT_KE_QUERY_URL: 'http://ke-q/api/SellerKit',
    TENANT_KE_LOCAL_URL: 'http://ke-api/api/auth/',
    TENANT_KE_REPORT_URL: 'http://ke-r/api/',
    TENANT_KE_SCHEME_REQ: 'false',
    TENANT_KE_SAP_URL: 'http://ke-sl/b1s/v1/',
    TENANT_KE_SAP_COMPANYDB: 'SAP_KE',
    TENANT_KE_SAP_USER: 'manager',
    TENANT_KE_SAP_PASSWORD: 'pw',
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
    expect(tz.sap).toEqual({ sapUrl: 'http://tz-sl/b1s/v1/', sapCompanyDb: 'SAP_TZ', sapUsername: 'manager', sapPassword: 'pw' });
  });

  it('uses a Windows (NTLM) login only for connections that set *_DOMAIN', () => {
    const service = new TenantService(makeConfig({ ...env, TENANT_KE_DB_DOMAIN: 'KE-SQL01' }));
    expect(service.get('KE').db.domain).toBe('KE-SQL01');
    expect(service.get('KE').sapDb.domain).toBeUndefined();
    expect(service.get('TZ').db.domain).toBeUndefined();
  });

  it('rewrites a stored SAP address in any of the listed forms to the address this shop reaches', async () => {
    const { effectiveSapUrl } = await import('./sap-url.js');
    const service = new TenantService(makeConfig({ ...env, TENANT_KE_SAP_URL_FROM: 'https://pub.example:50000/, http://pub.example:50001/', TENANT_KE_SAP_URL_TO: 'http://192.168.10.22:50001/' }));
    const ke = service.get('KE');
    expect(ke.sapUrlRedirect).toEqual({ from: ['https://pub.example:50000/', 'http://pub.example:50001/'], to: 'http://192.168.10.22:50001/' });
    expect(effectiveSapUrl(ke, 'https://pub.example:50000/b1s/v1/')).toBe('http://192.168.10.22:50001/b1s/v1/');
    expect(effectiveSapUrl(ke, 'HTTP://PUB.example:50001/b1s/v1/')).toBe('http://192.168.10.22:50001/b1s/v1/');
    expect(effectiveSapUrl(ke, 'http://102.69.167.106:50003/b1s/v1/')).toBe('http://102.69.167.106:50003/b1s/v1/'); // another form: left alone
    expect(effectiveSapUrl(service.get('TZ'), 'https://pub.example:50000/b1s/v1/')).toBe('https://pub.example:50000/b1s/v1/'); // no redirect configured
  });

  it('SAP_URL_FROM_ENV=true makes every user of the shop connect to the shop SAP_URL, whatever their row says', async () => {
    const { effectiveSapUrl } = await import('./sap-url.js');
    const service = new TenantService(makeConfig({ ...env, TENANT_KE_SAP_URL_FROM_ENV: 'true' }));
    const ke = service.get('KE');
    expect(ke.sapUrlFromEnv).toBe(true);
    for (const stored of ['https://pub.example:50000/b1s/v1/', 'http://pub.example:50001/b1s/v1/', '', 'garbage']) {
      expect(effectiveSapUrl(ke, stored)).toBe(ke.sap.sapUrl);
    }
    expect(service.get('TZ').sapUrlFromEnv).toBe(false); // off unless asked for
    expect(effectiveSapUrl(service.get('TZ'), 'http://own:50003/b1s/v1/')).toBe('http://own:50003/b1s/v1/');
  });

  it('builds the pre-login GetUrls payload from env', () => {
    const service = new TenantService(makeConfig(env));
    expect(service.get('Kenya').urls).toEqual({
      countryName: 'Kenya',
      queryURL: 'http://ke-q/api/SellerKit',
      localURL: 'http://ke-api/api/auth/',
      reportURL: 'http://ke-r/api/',
      schemeReq: false,
    });
    expect(service.get('TZ').urls.schemeReq).toBe(true);
  });

  it('looks up a tenant case-insensitively', () => {
    const service = new TenantService(makeConfig(env));
    expect(service.get('tz').name).toBe('Tanzania');
  });

  it('also resolves by country name, which is what the login dropdown sends', () => {
    const service = new TenantService(makeConfig(env));
    expect(service.get('tanzania').code).toBe('TZ');
  });

  it('throws NotFoundException for an unknown shop code', () => {
    const service = new TenantService(makeConfig(env));
    expect(() => service.get('UG')).toThrow('Unknown tenant/shop code: UG');
  });
});
