import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { SapService } from '../sap/sap.service.js';
import type { JwtService } from '@nestjs/jwt';
import type { LoginDto } from './dto/login.dto.js';
import { SapIdentityCache } from './sap-identity-cache.service.js';

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
};

const countryRow = {
  CountryName: 'Tanzania',
  QueryURL: 'http://q',
  LocalURL: 'http://l',
  ReportURL: 'http://r',
  SchemeReq: true,
};

const dto: LoginDto = { tenantCode: 'TZ', userCode: 'JANET', password: '1234', deviceCode: 'device-1' };

describe('AuthService', () => {
  let db: { execProcSets: ReturnType<typeof vi.fn> };
  let sap: { verifyCredentials: ReturnType<typeof vi.fn> };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  let sapIdentityCache: SapIdentityCache;
  let service: AuthService;

  beforeEach(() => {
    db = { execProcSets: vi.fn() };
    sap = { verifyCredentials: vi.fn() };
    jwt = { signAsync: vi.fn().mockResolvedValue('signed.jwt.token') };
    sapIdentityCache = new SapIdentityCache();
    service = new AuthService(
      db as unknown as DatabaseService,
      sap as unknown as SapService,
      jwt as unknown as JwtService,
      sapIdentityCache,
    );
  });

  it('rejects when the stored proc returns no matching user', async () => {
    db.execProcSets.mockResolvedValue([[], []]);
    await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    expect(sap.verifyCredentials).not.toHaveBeenCalled();
  });

  it('rejects with a generic message when SAP credentials are invalid, without leaking the real error', async () => {
    db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
    sap.verifyCredentials.mockRejectedValue(new Error('SAP login failed for InsigniaLimited/dodoma: 401 {...}'));

    await expect(service.login(dto)).rejects.toThrow('Invalid SAP Credentials');
  });

  it('never returns or signs the raw SAP credentials, caching them server-side instead', async () => {
    db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
    sap.verifyCredentials.mockResolvedValue(undefined);

    const result = await service.login(dto);

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.user).toEqual({ id: 38, userCode: 'JANET', tenantCode: 'TZ' }); // no `sap` field
    expect(result.country).toEqual(countryRow);

    const signedPayload = jwt.signAsync.mock.calls[0][0];
    expect(signedPayload).toEqual({ sub: 38, userCode: 'JANET', tenantCode: 'TZ' }); // no sap/password in the JWT either
    expect(JSON.stringify(signedPayload)).not.toMatch(/Dod@17/);

    expect(sapIdentityCache.get(38)).toEqual({
      sapUrl: userRow.SAPUrl,
      sapCompanyDb: 'InsigniaLimited',
      sapUsername: 'dodoma',
      sapPassword: 'Dod@17',
    });
  });

  it('calls the stored proc against the caller-chosen tenant, not a hardcoded one', async () => {
    db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
    sap.verifyCredentials.mockResolvedValue(undefined);

    await service.login({ ...dto, tenantCode: 'ke' });

    expect(db.execProcSets).toHaveBeenCalledWith('ke', 'app', 'UpdateDeviceCodetest', expect.objectContaining({ UserCode: 'JANET' }));
  });
});
