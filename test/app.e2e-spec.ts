import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type MockDatabaseService, type MockSapService } from './create-app.js';

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

const countryRow = { CountryName: 'Tanzania', QueryURL: 'q', LocalURL: 'l', ReportURL: 'r', SchemeReq: true };

describe('App (e2e)', () => {
  let app: INestApplication;
  let db: MockDatabaseService;
  let sap: MockSapService;

  beforeEach(async () => {
    db = { execProc: vi.fn(), execProcSets: vi.fn(), query: vi.fn(), withTransaction: vi.fn() };
    sap = { verifyCredentials: vi.fn(), request: vi.fn() };
    app = await createTestApp({ db, sap });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api responds (root route survives the global "api" prefix)', async () => {
    await request(app.getHttpServer()).get('/api').expect(200).expect('Hello World!');
  });

  describe('POST /api/auth/login', () => {
    it('rejects a body missing required fields with the unified {status,message} envelope', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ tenantCode: 'TZ' }).expect(400);
      expect(res.body.status).toBe(false);
      expect(res.body.message).toMatch(/userCode/);
    });

    it('rejects a body with an unexpected extra field', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenantCode: 'TZ', userCode: 'a', password: 'b', deviceCode: 'd', notAllowed: true })
        .expect(400);
      expect(res.body.message).toMatch(/notAllowed/);
    });

    it('returns 401 when the user is not found in that tenant', async () => {
      db.execProcSets.mockResolvedValue([[], []]);
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenantCode: 'TZ', userCode: 'GHOST', password: 'x', deviceCode: 'd1' })
        .expect(401);
      expect(res.body.status).toBe(false);
    });

    it('returns a JWT on success and never leaks the raw SAP identity in the response', async () => {
      db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
      sap.verifyCredentials.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenantCode: 'TZ', userCode: 'JANET', password: '1234', deviceCode: 'd1' })
        .expect(201);

      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.split('.')).toHaveLength(3); // header.payload.signature
      expect(res.body.user.sap).toBeUndefined(); // SAP identity never echoed back to the client
      const [, payloadB64] = res.body.accessToken.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
      expect(decodedPayload.sap).toBeUndefined(); // and never embedded in the (merely signed, not encrypted) JWT either
    });
  });

  describe('guarded routes', () => {
    it('rejects /api/crm/items without a bearer token', async () => {
      await request(app.getHttpServer()).get('/api/crm/items').expect(401);
    });

    it('accepts /api/crm/items with a valid token from a real login', async () => {
      db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
      sap.verifyCredentials.mockResolvedValue(undefined);
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenantCode: 'TZ', userCode: 'JANET', password: '1234', deviceCode: 'd1' })
        .expect(201);

      db.execProc.mockResolvedValue([{ ItemCode: 'A1' }]);
      const res = await request(app.getHttpServer())
        .get('/api/crm/items')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(res.body).toEqual({ status: true, message: 'Success', data: [{ ItemCode: 'A1' }] });
      // proves the tenant on the token (not a client-supplied param) drove the query
      expect(db.execProc).toHaveBeenCalledWith('TZ', 'sapDb', 'BZ_POS_ItemMaster', {});
    });
  });

  describe('control-panel admin auth', () => {
    it('rejects a mobile-app JWT on an admin-only route', async () => {
      db.execProcSets.mockResolvedValue([[userRow], [countryRow]]);
      sap.verifyCredentials.mockResolvedValue(undefined);
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenantCode: 'TZ', userCode: 'JANET', password: '1234', deviceCode: 'd1' })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/control-panel/users')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(401);
    });

    it('issues its own admin token that then unlocks admin routes', async () => {
      db.execProc.mockResolvedValueOnce([{ Id: 1 }]); // CtrlLogin succeeds
      const login = await request(app.getHttpServer())
        .get('/api/control-panel/login')
        .query({ tenantCode: 'TZ', userName: 'admin', password: 'pw' })
        .expect(200);

      db.query.mockResolvedValue([{ Id: 1, UserName: 'admin' }]);
      const res = await request(app.getHttpServer())
        .get('/api/control-panel/users')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .expect(200);

      expect(res.body).toEqual([{ Id: 1, UserName: 'admin' }]);
    });
  });
});
