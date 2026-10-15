import { createDecipheriv } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { SapService } from '../sap/sap.service.js';
import type { JwtService } from '@nestjs/jwt';
import type { LoginDto } from './dto/login.dto.js';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import type { TenantService } from '../tenant/tenant.service.js';

const userRow = {
  Id: 38,
  UserCode: 'JANET',
  UserName: 'JANET',
  Branch: 'Dodoma',
  Email: 'janet@insignia.co.tz',
  SAPUserName: 'dodoma',
  SAPPassword: 'Dod@17',
  SAPUrl: 'http://102.69.167.106:50003/b1s/v1/',
  SapDB: 'InsigniaLimited',
  SlpCode: '88',
  Active: 'Y',
  DeviceCode: 'device-1',
  QueryURL: null,
  FCMToken: 'fcm-1',
  VisitCount: 2,
  TodayDeliveryCount: 5,
};

const CLAIMS_KEY = '32358357407475453235835740747545';
const config = { getOrThrow: () => CLAIMS_KEY };
// What the web dashboard does with the token: AES-256-ECB decrypt of encryptedClaims.
const decryptClaims = (b64: string) => {
  const d = createDecipheriv('aes-256-ecb', Buffer.from(CLAIMS_KEY, 'utf8'), null);
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8'));
};

const countryRow = {
  CountryName: 'Tanzania',
  QueryURL: 'http://q',
  LocalURL: 'http://l',
  ReportURL: 'http://r',
  SchemeReq: true,
};

const byKey: Record<string, { code: string; name: string; urls?: unknown; sapUrlRedirect?: unknown; sapCompanyDbForUsers?: unknown; sapUrlFromEnv?: unknown; sap?: unknown }> = {
  TZ: { code: 'TZ', name: 'Tanzania' },
  TANZANIA: { code: 'TZ', name: 'Tanzania' },
  KE: { code: 'KE', name: 'Kenya' },
  KENYA: { code: 'KE', name: 'Kenya' },
};
for (const t of Object.values(byKey)) Object.assign(t, { urls: { queryURL: 'env-q', localURL: 'env-l', reportURL: 'env-r' }, currency: 'KES' });
const tenants = { get: (c: string) => byKey[c.toUpperCase()] };

const dto: LoginDto = { tenantCode: 'TZ', userCode: 'JANET', password: '1234', deviceCode: 'device-1' };

// Answers the login's queries the way the shop DBs would.
function dbAnswers(db: { query: ReturnType<typeof vi.fn> }, user: object | null, country: object | null, manager: object | null = { ManagerFCM: 'mgr-fcm' }) {
  db.query.mockImplementation(async (_t: string, _kind: string, sql: string) => {
    if (sql.includes('UPDATE Users')) return [];
    if (sql.includes('FROM Users WHERE UserCode')) return user ? [user] : [];
    if (sql.includes('FROM OSLP')) return [{ U_CrpUsr: 'Y', U_RepotingTo: 7, TodayDeliveryCount: 5, VisitCount: 2, Series: 1506, SeriesName: 'HEADOF26', TodaySoldQty: 12.5, TodaySoldAmount: 480000 }];
    if (sql.includes('ManagerFCM')) return manager ? [manager] : [];
    if (sql.includes('CountryMaster')) return country ? [country] : [];
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('AuthService', () => {
  let db: { query: ReturnType<typeof vi.fn> };
  let sap: { verifyCredentials: ReturnType<typeof vi.fn> };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  let sapIdentityCache: SapIdentityCache;
  let service: AuthService;

  beforeEach(() => {
    db = { query: vi.fn() };
    sap = { verifyCredentials: vi.fn() };
    jwt = { signAsync: vi.fn().mockResolvedValue('signed.jwt.token') };
    sapIdentityCache = new SapIdentityCache();
    service = new AuthService(
      db as unknown as DatabaseService,
      sap as unknown as SapService,
      jwt as unknown as JwtService,
      sapIdentityCache,
      tenants as unknown as TenantService,
      config as never,
    );
  });

  it('rejects when the stored proc returns no matching user', async () => {
    dbAnswers(db, null, null);
    await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    expect(sap.verifyCredentials).not.toHaveBeenCalled();
  });

  it('rejects with a generic message when SAP credentials are invalid, without leaking the real error', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockRejectedValue(Object.assign(new Error('SAP login failed for InsigniaLimited/dodoma: 401 {...}'), { status: 401 }));

    await expect(service.login(dto)).rejects.toThrow('Invalid SAP Credentials');
  });

  it('says "SAP Connection Failed" - not "Invalid SAP Credentials" - when SAP cannot be reached, and writes nothing', async () => {
    dbAnswers(db, userRow, countryRow);
    for (const err of [new Error('connect ETIMEDOUT 5.31.44.89:50001'), Object.assign(new Error('SAP login failed: 500 {...}'), { status: 500 })]) {
      sap.verifyCredentials.mockRejectedValueOnce(err);
      await expect(service.login(dto)).rejects.toThrow('SAP Connection Failed');
    }
    expect(db.query.mock.calls.some((c) => String(c[2]).includes('UPDATE'))).toBe(false);
  });

  it('never exposes SAP credentials in plain text, caching them server-side instead', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);

    const result = await service.login(dto);

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.user).toEqual({ id: 38, userCode: 'JANET', tenantCode: 'TZ' }); // no `sap` field
    expect(result.country).toEqual(countryRow);

    const signedPayload = jwt.signAsync.mock.calls[0][0];
    expect(Object.keys(signedPayload)).toEqual(['encryptedClaims']); // nothing readable without the key
    expect(JSON.stringify(signedPayload)).not.toMatch(/Dod@17|JANET/);

    expect(sapIdentityCache.get(38)).toEqual({
      sapUrl: userRow.SAPUrl,
      sapCompanyDb: 'InsigniaLimited',
      sapUsername: 'dodoma',
      sapPassword: 'Dod@17',
    });
  });

  it('encryptedClaims decrypts to the legacy .NET claim set the web dashboard reads', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);

    await service.login(dto);

    expect(decryptClaims(jwt.signAsync.mock.calls[0][0].encryptedClaims)).toEqual({
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'JANET',
      UserName: 'JANET',
      Id: '38',
      Branch: 'Dodoma',
      DeviceCode: 'device-1',
      Email: 'janet@insignia.co.tz',
      SAPUserName: 'dodoma',
      SAPPassword: 'Dod@17',
      SAPUrl: 'http://102.69.167.106:50003/b1s/v1/',
      SapDB: 'InsigniaLimited',
      SlpCode: '88',
      QueryURL: '',
      FCMToken: '', // this login sent no FCM token, and the claims reflect the row as saved by the login
      Active: 'Y',
      VisitCount: '2',
      DeliveryCount: '5',
      Series: '1506',
      SeriesName: 'HEADOF26',
      TodaySoldQty: '12.5',
      TodaySoldAmount: '480000',
      Queryurl: 'env-q', // always the .env URLs GetUrls returned, not the DB's CountryMaster row
      Localurl: 'env-l',
      Reporturl: 'env-r',
      CurrencyCode: 'KES',
      TenantCode: 'TZ',
    });
  });

  it('keeps the address stored in the database in the SAPUrl claim, even when the connection itself uses the shop env address', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);
    Object.assign(byKey.KE, { sapUrlFromEnv: true, sap: { sapUrl: 'http://env-sl/b1s/v1/' } });
    try {
      await service.login({ ...dto, tenantCode: 'KE' });
      expect(decryptClaims(jwt.signAsync.mock.lastCall[0].encryptedClaims).SAPUrl).toBe(userRow.SAPUrl); // claim: as stored
      expect(sap.verifyCredentials).toHaveBeenLastCalledWith(expect.objectContaining({ sapUrl: 'http://env-sl/b1s/v1/' })); // connection: env address
    } finally {
      delete (byKey.KE as { sapUrlFromEnv?: unknown }).sapUrlFromEnv;
      delete (byKey.KE as { sap?: unknown }).sap;
    }
  });

  it('uses the env URLs whether or not the shop DB has a CountryMaster row', async () => {
    dbAnswers(db, userRow, null);
    sap.verifyCredentials.mockResolvedValue(undefined);

    await service.login(dto);

    expect(decryptClaims(jwt.signAsync.mock.calls[0][0].encryptedClaims)).toMatchObject({ Queryurl: 'env-q', Localurl: 'env-l', Reporturl: 'env-r', CurrencyCode: 'KES' });
  });

  it('calls the stored proc against the caller-chosen tenant, not a hardcoded one', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);

    await service.login({ ...dto, tenantCode: 'Kenya' });

    // Dropdown sends the country name; the proc gets the canonical code's DB and the name for CountryMaster.
    expect(db.query).toHaveBeenCalledWith('KE', 'app', expect.stringContaining('SELECT * FROM Users'), expect.objectContaining({ UserCode: 'JANET' }));
    expect(db.query).toHaveBeenCalledWith('KE', 'app', expect.stringContaining('UPDATE Users'), expect.objectContaining({ UserCode: 'JANET', DeviceCode: 'device-1' }));
    expect(db.query).toHaveBeenCalledWith('KE', 'sapDb', expect.stringContaining('FROM OSLP'), { SlpCode: '88', SapUser: 'dodoma' });
    expect(db.query).toHaveBeenCalledWith('KE', 'app', expect.stringContaining('CountryMaster'), { CountryName: 'Kenya' });
  });

  it("redirects the user's stored SAPUrl per shop config, leaving other shops alone", async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);
    Object.assign(byKey.KE, { sapUrlRedirect: { from: ['HTTP://102.69.167.106:50003/'], to: 'https://192.168.10.22:50000/' } });
    try {
      await service.login({ ...dto, tenantCode: 'KE' });
      expect(sapIdentityCache.get(38)?.sapUrl).toBe('https://192.168.10.22:50000/b1s/v1/');
      await service.login(dto); // TZ: no redirect configured
      expect(sapIdentityCache.get(38)?.sapUrl).toBe('http://102.69.167.106:50003/b1s/v1/');
    } finally {
      delete (byKey.KE as { sapUrlRedirect?: unknown }).sapUrlRedirect;
    }
  });

  it('forces the shop test company for every user when SAP_COMPANYDB_FOR_USERS is set (live-SAP protection)', async () => {
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockResolvedValue(undefined);
    Object.assign(byKey.KE, { sapCompanyDbForUsers: 'TEST_Kenya_DB' });
    try {
      await service.login({ ...dto, tenantCode: 'KE' });
      expect(sap.verifyCredentials).toHaveBeenLastCalledWith(expect.objectContaining({ sapCompanyDb: 'TEST_Kenya_DB', sapUsername: 'dodoma' }));
      expect(sapIdentityCache.get(38)?.sapCompanyDb).toBe('TEST_Kenya_DB');
      expect(decryptClaims(jwt.signAsync.mock.lastCall[0].encryptedClaims).SapDB).toBe('TEST_Kenya_DB');
      await service.login(dto); // TZ: not set -> the user's own SapDB
      expect(sapIdentityCache.get(38)?.sapCompanyDb).toBe('InsigniaLimited');
    } finally {
      delete (byKey.KE as { sapCompanyDbForUsers?: unknown }).sapCompanyDbForUsers;
    }
  });

  it('treats a user without a reporting manager as not found - and writes nothing', async () => {
    dbAnswers(db, userRow, countryRow, null);
    await expect(service.login(dto)).rejects.toThrow('User Not Found');
    expect(sap.verifyCredentials).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some((c) => String(c[2]).includes('UPDATE'))).toBe(false);
  });

  it('writes nothing when the password is wrong or SAP rejects the user', async () => {
    dbAnswers(db, null, countryRow);
    await expect(service.login(dto)).rejects.toThrow('User Not Found');
    dbAnswers(db, userRow, countryRow);
    sap.verifyCredentials.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
    await expect(service.login(dto)).rejects.toThrow('Invalid SAP Credentials');
    expect(db.query.mock.calls.some((c) => String(c[2]).includes('UPDATE'))).toBe(false);
  });
});
