import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy.js';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import { NAME_ID_CLAIM, encryptClaims } from './claims-cipher.js';

const KEY = '32358357407475453235835740747545';
const config = { getOrThrow: (k: string) => (k === 'JWT_CLAIMS_KEY' ? KEY : 'jwt-secret') };
const sap = { sapUrl: 'u', sapCompanyDb: 'db', sapUsername: 'x', sapPassword: 'y' };

const tenants = {
  find: (c: string) =>
    c === 'TS' ? { code: 'TS', sapUrlFromEnv: true, sap: { sapUrl: 'http://env-sl/b1s/v1/' } } : c === 'KE' ? { code: 'KE', sapUrlRedirect: { from: ['https://old.example:50000/'], to: 'https://192.168.10.22:50000/' } } : c === 'TZ' ? { code: 'TZ' } : undefined,
};

function make(cached = true) {
  const cache = new SapIdentityCache();
  if (cached) cache.set(50, sap);
  return { strategy: new JwtStrategy(config as never, cache, tenants as never), cache };
}

const signedIn = { Id: '50', TenantCode: 'TZ', [NAME_ID_CLAIM]: 'Ram', SAPUserName: 'dodoma', SAPPassword: 'Dod@17', SAPUrl: 'http://sl/b1s/v1/', SapDB: 'Company1' };

describe('JwtStrategy', () => {
  it('decrypts encryptedClaims into the request user and re-attaches the cached SAP session', () => {
    const encryptedClaims = encryptClaims(KEY, { ...signedIn, SAPPassword: 'not-used-while-cached' });
    expect(make().strategy.validate({ encryptedClaims })).toEqual({ sub: 50, userCode: 'Ram', tenantCode: 'TZ', sap });
  });

  it('rebuilds the SAP session from the token when the cache is empty (restart / deploy) and caches it', () => {
    const { strategy, cache } = make(false);
    const user = strategy.validate({ encryptedClaims: encryptClaims(KEY, signedIn) });
    const expected = { sapUrl: 'http://sl/b1s/v1/', sapCompanyDb: 'Company1', sapUsername: 'dodoma', sapPassword: 'Dod@17' };
    expect(user).toEqual({ sub: 50, userCode: 'Ram', tenantCode: 'TZ', sap: expected });
    expect(cache.get(50)).toEqual(expected);
  });

  it("applies the shop's Service Layer redirect when rebuilding", () => {
    const { strategy } = make(false);
    const user = strategy.validate({ encryptedClaims: encryptClaims(KEY, { ...signedIn, TenantCode: 'KE', SAPUrl: 'https://old.example:50000/b1s/v1/' }) });
    expect((user as { sap: { sapUrl: string } }).sap.sapUrl).toBe('https://192.168.10.22:50000/b1s/v1/');
  });

  it('rebuilds with the shop SAP_URL, not the stored address, when the shop takes its SAP URL from env', () => {
    const { strategy } = make(false);
    const user = strategy.validate({ encryptedClaims: encryptClaims(KEY, { ...signedIn, TenantCode: 'TS', SAPUrl: 'http://stored.example:50001/b1s/v1/' }) });
    expect((user as { sap: { sapUrl: string } }).sap.sapUrl).toBe('http://env-sl/b1s/v1/');
  });

  it('asks for a new login when the cache is empty and the token cannot rebuild the session', () => {
    const { strategy } = make(false);
    for (const claims of [{ ...signedIn, SAPPassword: '' }, { ...signedIn, TenantCode: 'XX' }]) {
      expect(() => strategy.validate({ encryptedClaims: encryptClaims(KEY, claims) })).toThrow('Session expired, please log in again');
    }
  });

  it('rejects claims encrypted with a different key', () => {
    const encryptedClaims = encryptClaims('0'.repeat(32), { Id: '50', TenantCode: 'TZ' });
    expect(() => make().strategy.validate({ encryptedClaims })).toThrow(UnauthorizedException);
  });

  it('passes admin tokens through untouched', () => {
    const admin = { role: 'admin' as const, tenantCode: 'TZ', userName: 'a' };
    expect(make().strategy.validate(admin)).toBe(admin);
  });
});
