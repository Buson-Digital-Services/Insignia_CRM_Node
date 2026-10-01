import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SapIdentityCache } from '../src/auth/sap-identity-cache.service.js';
import { createTestApp, type MockDatabaseService, type MockSapService } from './create-app.js';

// Routes are the legacy .NET API's names, called under a shop base URL (/api/<Country>/...).
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

describe('App (e2e)', () => {
  let app: INestApplication;
  let db: MockDatabaseService;
  let sap: MockSapService;

  // Answers queries the way a shop's DBs would; `user: null` = wrong user/password.
  const dbAnswers = (user: object | null = userRow) =>
    db.query.mockImplementation(async (_t: string, _kind: string, sql: string) => {
      if (sql.includes('UPDATE Users')) return [];
      if (sql.includes('FROM Users WHERE UserCode')) return user ? [user] : [];
      if (sql.includes('FROM OSLP')) return [{ U_CrpUsr: 'Y', U_RepotingTo: 7, TodayDeliveryCount: 0, VisitCount: 0 }];
      if (sql.includes('ManagerFCM')) return [{ ManagerFCM: 'm' }];
      if (sql.includes('CountryMaster')) return [];
      if (sql.includes('COL_LENGTH')) return [{ len: 20 }];
      if (sql.includes('FROM OBTQ')) return [{ itemcode: 'A1' }];
      if (sql.includes('FROM OVTG')) return [{ Rate: 18 }];
      if (sql.includes('MAX(DocEntry)')) return [{ n: 0 }];
      if (sql.includes('FROM Users')) return [{ Id: 1, UserName: 'admin' }];
      throw new Error(`unexpected query: ${sql}`);
    });

  const login = async (country = 'Tanzania') => {
    const res = await request(app.getHttpServer()).get(`/api/${country}/GetLoginDetails/JANET/1234/d1/f1`).expect(200);
    return res.body.data as string;
  };

  beforeEach(async () => {
    db = { execProc: vi.fn(), execProcSets: vi.fn(), query: vi.fn(), withTransaction: vi.fn() };
    sap = { verifyCredentials: vi.fn().mockResolvedValue(undefined), checkCredentials: vi.fn().mockResolvedValue(undefined), request: vi.fn() };
    app = await createTestApp({ db, sap });
    dbAnswers();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api responds (root route survives the global "api" prefix)', async () => {
    await request(app.getHttpServer()).get('/api').expect(200).expect('Hello World!');
  });

  describe('login', () => {
    it('GetLoginDetails under the shop base URL returns { status, message, data: <jwt> } holding only encryptedClaims', async () => {
      const res = await request(app.getHttpServer()).get('/api/Tanzania/GetLoginDetails/JANET/1234/d1/f1').expect(200);
      expect(res.body).toMatchObject({ status: true, message: 'Success' });
      const payload = JSON.parse(Buffer.from(res.body.data.split('.')[1], 'base64').toString());
      expect(Object.keys(payload).sort()).toEqual(['encryptedClaims', 'exp', 'iat']);
      expect(db.query).toHaveBeenCalledWith('TZ', 'app', expect.stringContaining('SELECT * FROM Users'), expect.objectContaining({ UserCode: 'JANET' }));
    });

    it('also accepts the legacy form with the country last, on a URL without a shop', async () => {
      const res = await request(app.getHttpServer()).get('/api/GetLoginDetails/JANET/1234/d1/f1/Kenya').expect(200);
      expect(res.body.status).toBe(true);
      expect(db.query).toHaveBeenCalledWith('KE', 'app', expect.stringContaining('SELECT * FROM Users'), expect.anything());
    });

    it('returns 401 for an unknown user and writes nothing', async () => {
      dbAnswers(null);
      const res = await request(app.getHttpServer()).get('/api/Tanzania/GetLoginDetails/GHOST/x/d1/f1').expect(401);
      expect(res.body).toEqual({ status: false, message: 'User Not Found' });
      expect(db.query.mock.calls.some((c) => String(c[2]).includes('UPDATE'))).toBe(false);
    });

    it('POST auth/login still validates its JSON body', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ tenantCode: 'TZ', userCode: 'a', password: 'b', deviceCode: 'd', notAllowed: true }).expect(400);
      expect(res.body.message).toMatch(/notAllowed/);
    });
  });

  describe('data routes (legacy names, need the login token)', () => {
    it('rejects a call without a token', async () => {
      await request(app.getHttpServer()).get('/api/Tanzania/ItemMaster?whscode=HOFG').expect(401);
    });

    it('serves ItemMaster for the token\'s shop; query names are case-insensitive and `sapuser` is ignored', async () => {
      const token = await login();
      const res = await request(app.getHttpServer()).get('/api/Tanzania/ItemMaster?WhsCode=HOFG&sapuser=whoever').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body).toEqual({ status: true, message: 'Success', data: [{ itemcode: 'A1' }] });
      expect(db.query).toHaveBeenCalledWith('TZ', 'sapDb', expect.stringContaining('FROM OBTQ'), { whscode: 'HOFG' });
    });

    it("rejects the token under another shop's base URL", async () => {
      const token = await login();
      await request(app.getHttpServer()).get('/api/Kenya/ItemMaster?whscode=HOFG').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('answers 400, not a SQL error, for a missing/non-numeric query value', async () => {
      const token = await login();
      const res = await request(app.getHttpServer()).get('/api/Tanzania/GetQuotationDetails').set('Authorization', `Bearer ${token}`).expect(400);
      expect(res.body.message).toMatch(/docentry/);
    });

    it('Sellerkit approve-quotation goes to SAP as the logged-in user, not to SQL, and needs a token', async () => {
      const body = { constr: 'ignored', query: "BZ_ApproveQuoteinCRMandPOS '12'" };
      const denied = await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').send(body).expect(401);
      const why = 'Login required: send the login token as "Authorization: Bearer <token>"';
      expect(denied.body).toEqual({ status: false, message: why, msg: why, data: null }); // old query-service shape too
      expect(sap.request).not.toHaveBeenCalled();

      const token = await login();
      db.query.mockClear();
      const res = await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send(body).expect(200);
      expect(res.body).toEqual({ status: true, message: 'Success', msg: 'Success', data: '[{"Column1":1}]' });
      expect(sap.request).toHaveBeenCalledTimes(1);
      expect(sap.request).toHaveBeenCalledWith(expect.objectContaining({ sapUsername: 'dodoma', sapCompanyDb: 'InsigniaLimited' }), 'patch', 'Quotations(12)', { U_DL_Approval: 'Y' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('CreateQuotation sends CardName to SAP and no longer accepts series / header DiscountPercent', async () => {
      const token = await login();
      const quote = { CardCode: 'C001', CardName: 'Walk-in customer', DocDate: '2026-09-30', DocDueDate: '2026-10-07', TaxDate: '2026-09-30', DocumentLines: [{ ItemCode: 'A1', Quantity: 2 }] };
      sap.request.mockResolvedValue({ DocEntry: 5 });
      const res = await request(app.getHttpServer()).post('/api/Tanzania/CreateQuotation?sapuser=x').set('Authorization', `Bearer ${token}`).send(quote).expect(200);
      expect(res.body).toMatchObject({ status: true, data: { DocEntry: 5 } });
      const payload = sap.request.mock.lastCall![3];
      expect(payload).toMatchObject({ CardCode: 'C001', CardName: 'Walk-in customer' });
      expect(payload).not.toHaveProperty('Series');
      expect(payload).not.toHaveProperty('DiscountPercent');

      for (const removed of [{ series: 71 }, { DiscountPercent: 5 }]) {
        const bad = await request(app.getHttpServer()).post('/api/Tanzania/CreateQuotation').set('Authorization', `Bearer ${token}`).send({ ...quote, ...removed }).expect(400);
        expect(bad.body.message).toMatch(new RegExp(Object.keys(removed)[0]));
      }
    });

    it('Sellerkit answers 404 "not available" when the shop has no such procedure, and passes the XML argument through intact', async () => {
      const token = await login();
      const xml = '<DocumentElements><SCHEMES><LineNum>1</LineNum></SCHEMES></DocumentElements>';
      const query = `BZ_CRM_CHeckApproval 'C1',100.5, '<?xml version="1.0" encoding="UTF-8"?>${xml}'`;

      db.execProc.mockResolvedValueOnce([{ SAPName: 'SOLIMITAPP', SAPPassword: 'x', RespMessage: 'ok' }]);
      const ok = await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send({ constr: 'ignored', query }).expect(200);
      expect(JSON.parse(ok.body.data)[0].SAPName).toBe('SOLIMITAPP');
      expect(db.execProc).toHaveBeenLastCalledWith('TZ', 'sapDb', 'BZ_CRM_CHeckApproval', { CardCode: 'C1', DocTotal: 100.5, xml });

      db.execProc.mockRejectedValueOnce(Object.assign(new Error("Could not find stored procedure 'BZ_CRM_CHeckApproval'."), { number: 2812 }));
      const missing = await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send({ query }).expect(404);
      expect(missing.body).toEqual({ status: false, message: 'This query is not available for this country', msg: 'This query is not available for this country', data: null });
    });

    it('CreateSalesOrder creates an order that needs approval under the approval account, server-side', async () => {
      const token = await login();
      db.execProc.mockResolvedValueOnce([{ SAPName: 'SOLIMITAPP', SAPPassword: 'secret-1234', RespMessage: 'Document needs Credit Limit Approval. Hence saved as Draft!!!' }]);
      sap.request.mockResolvedValue({ DocEntry: 5 });
      const res = await request(app.getHttpServer())
        .post('/api/Tanzania/CreateSalesOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({ CardCode: 'C1', DocDate: '2026-09-30', DocDueDate: '2026-09-30', DocumentLines: [{ ItemCode: 'A1', Quantity: '2', UnitPrice: '100', TaxCode: '01' }] })
        .expect(200);
      expect(res.body).toEqual({ status: true, message: 'Document needs Credit Limit Approval. Hence saved as Draft!!!', data: { DocEntry: 5 } });
      expect(JSON.stringify(res.body)).not.toContain('secret-1234');
      expect(db.execProc).toHaveBeenCalledWith('TZ', 'sapDb', 'BZ_CRM_CHeckApproval', expect.objectContaining({ CardCode: 'C1', DocTotal: 236 }));
      expect(sap.request).toHaveBeenCalledWith(expect.objectContaining({ sapUsername: 'SOLIMITAPP', sapPassword: 'secret-1234', sapCompanyDb: 'InsigniaLimited' }), 'post', 'Orders', expect.anything());
    });

    it('a 401 says why: no token, bad token', async () => {
      const call = (auth?: string) => {
        const r = request(app.getHttpServer()).post('/api/Kenya/Sellerkit').send({ query: "BZ_CRM_CHeckApproval 'C1',1,'<a/>'" });
        return (auth ? r.set('Authorization', auth) : r).expect(401);
      };
      expect((await call()).body.message).toMatch(/Login required/);
      expect((await call('Bearer not.a.token')).body.message).toBe('Invalid token');
    });

    it('a login survives a server restart: the SAP session is rebuilt from the token', async () => {
      const token = await login();
      (app.get(SapIdentityCache) as unknown as { cache: Map<number, unknown> }).cache.clear(); // what a restart does
      sap.request.mockResolvedValue({});
      await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send({ query: "BZ_ApproveQuoteinCRMandPOS '12'" }).expect(200);
      expect(sap.request).toHaveBeenCalledWith({ sapUrl: userRow.SAPUrl, sapCompanyDb: 'InsigniaLimited', sapUsername: 'dodoma', sapPassword: 'Dod@17' }, 'patch', 'Quotations(12)', expect.anything());
    });

    it('CreateSalesOrder takes the frontend request exactly as it sends it (numbers as text, extra fields)', async () => {
      const token = await login();
      const frontendBody = {
        CardCode: 'D11137', CardName: 'INSIGNIA AFRICA LTD - UGANDA', Comments: 'new order', DocDate: '2026-09-30', DocDueDate: '2026-09-30',
        DocumentLines: [{ BaseEntry: 0, Currency: 'TZS', DiscountPercent: '0.00', ItemCode: '10101W001A', ItemDescription: 'ALKALI RESISTING PRIMER (WB) WHITE - 20 LT', Quantity: '12.00', ShipDate: '2026-09-30', TaxCode: '01', UnitPrice: '2000.00', WarehouseCode: 'KEFG' }],
        DocumentStatus: 'bost_Open', NumAtCard: 'TESTERSSS', SalesPersonCode: '1', Series: '1506', U_DeviceCode: '', U_DeviceTransID: '360805f7-2b07-4f9b-8b10-6d339d38c9ba',
        U_GP_Approval: '1', U_latitude: '11.014084242162879', U_longitude: '76.96248024382152', U_Order_Type: '1', U_OrderDate: '2026-09-30', U_Received_Time: '15:51',
      };
      sap.request.mockResolvedValue({ DocEntry: 77 });
      const res = await request(app.getHttpServer()).post('/api/Tanzania/CreateSalesOrder?sapuser=manager').set('Authorization', `Bearer ${token}`).send(frontendBody).expect(200);
      expect(res.body).toMatchObject({ status: true, data: { DocEntry: 77 } });
      const [, method, path, payload] = sap.request.mock.lastCall!;
      expect([method, path]).toEqual(['post', 'Orders']);
      expect(payload).toMatchObject({ CardCode: 'D11137', SalesPersonCode: 1, Series: 1506, NumAtCard: 'TESTERSSS', U_Order_Type: '1', U_GP_Approval: '1' });
      expect(payload.DocumentLines).toEqual([
        { ItemCode: '10101W001A', ItemDescription: 'ALKALI RESISTING PRIMER (WB) WHITE - 20 LT', Quantity: 12, UnitPrice: 2000, DiscountPercent: 0, VatGroup: '01', ShipDate: '2026-09-30', WarehouseCode: 'KEFG', Currency: 'TZS' },
      ]);
    });

    it('no longer serves the earlier Node-style paths', async () => {
      const token = await login();
      for (const path of ['/api/crm/items', '/api/items', '/api/control-panel/users']) {
        await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).expect(404);
      }
    });
  });

  describe('SapLogin (legacy: POST SapLogin?sapUser=&sapPassword=)', () => {
    it('checks the credentials against the shop SAP company with a fresh login and answers like the legacy API', async () => {
      const res = await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=dodoma&sapPassword=Dod%4017').expect(200);
      expect(res.body).toEqual({ status: true, message: 'SAP Connected dodoma' });
      expect(sap.checkCredentials).toHaveBeenCalledWith({ sapUrl: 'http://test-sl/b1s/v1/', sapCompanyDb: 'SAP_TZ_TEST', sapUsername: 'dodoma', sapPassword: 'Dod@17' });
    });

    it('answers 401 for a wrong password, 400 for any other SAP failure or missing parameters', async () => {
      sap.checkCredentials.mockRejectedValueOnce(Object.assign(new Error('SAP login failed: 401 {...}'), { status: 401 }));
      const wrong = await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=dodoma&sapPassword=nope').expect(401);
      expect(wrong.body).toEqual({ status: false, message: 'Invalid SAP Credentials' });

      sap.checkCredentials.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:50000'));
      const down = await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=dodoma&sapPassword=x').expect(400);
      expect(down.body).toEqual({ status: false, message: 'SAP Connection Failed' }); // no internals leaked

      await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=dodoma').expect(400);
    });

    it("switches a logged-in user's SAP session to the verified credentials, keeping their own SAP URL/company", async () => {
      const token = await login();
      await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=manager&sapPassword=secret').set('Authorization', `Bearer ${token}`).expect(200);
      expect(sap.checkCredentials).toHaveBeenCalledWith({ sapUrl: userRow.SAPUrl, sapCompanyDb: 'InsigniaLimited', sapUsername: 'manager', sapPassword: 'secret' });

      await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send({ query: "BZ_ApproveQuoteinCRMandPOS '12'" }).expect(200);
      expect(sap.request).toHaveBeenCalledWith(expect.objectContaining({ sapUsername: 'manager', sapPassword: 'secret' }), 'patch', 'Quotations(12)', expect.anything());
    });

    it('does not switch anything when the credentials are wrong', async () => {
      const token = await login();
      sap.checkCredentials.mockRejectedValueOnce(Object.assign(new Error('401'), { status: 401 }));
      await request(app.getHttpServer()).post('/api/Tanzania/SapLogin?sapUser=manager&sapPassword=bad').set('Authorization', `Bearer ${token}`).expect(401);
      await request(app.getHttpServer()).post('/api/Tanzania/Sellerkit').set('Authorization', `Bearer ${token}`).send({ query: "BZ_ApproveQuoteinCRMandPOS '12'" }).expect(200);
      expect(sap.request).toHaveBeenCalledWith(expect.objectContaining({ sapUsername: 'dodoma' }), 'patch', 'Quotations(12)', expect.anything());
    });
  });

  describe('pre-login routes', () => {
    it('take the shop from the base URL they are called under', async () => {
      db.execProc.mockResolvedValue([{ MenuKey: 1 }]);
      await request(app.getHttpServer()).get('/api/Uganda/Getmenus').expect(200);
      expect(db.execProc).toHaveBeenCalledWith('UG', 'app', 'Get_Menus', {});
    });

    it('answer 400 when called without a shop', async () => {
      const res = await request(app.getHttpServer()).get('/api/Getmenus').expect(400);
      expect(res.body.message).toMatch(/Country missing/);
    });

    it('POSTs take the legacy body field names and answer 200 like the legacy API', async () => {
      db.execProc.mockResolvedValue([{ Msg: 'Reset done' }]);
      await request(app.getHttpServer()).post('/api/Tanzania/ResetDevicecode').send({ DeviceCode: 'd1', UserCode: 'JANET' }).expect(200);
      expect(db.execProc).toHaveBeenCalledWith('TZ', 'app', 'BZ_ResetDevicecode', expect.objectContaining({ UserCode: 'JANET' }));
    });
  });

  describe('control panel (admin token)', () => {
    it('rejects a mobile-app token on an admin route', async () => {
      const token = await login();
      await request(app.getHttpServer()).get('/api/Tanzania/UserNames').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('GetLogin issues an admin token that unlocks admin routes', async () => {
      db.execProc.mockResolvedValueOnce([{ Id: 1 }]); // CtrlLogin succeeds
      const res = await request(app.getHttpServer()).get('/api/Tanzania/GetLogin/admin/pw').expect(200);
      const users = await request(app.getHttpServer()).get('/api/Tanzania/UserNames').set('Authorization', `Bearer ${res.body.data.accessToken}`).expect(200);
      expect(users.body).toEqual([{ Id: 1, UserName: 'admin' }]);
    });
  });
});
