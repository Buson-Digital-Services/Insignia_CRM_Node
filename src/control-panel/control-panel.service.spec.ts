import { describe, expect, it, vi } from 'vitest';
import { ControlPanelService } from './control-panel.service.js';

const shopSap = { sapUrl: 'http://sl/b1s/v1/', sapCompanyDb: 'DB', sapUsername: 'manager', sapPassword: 'pw' };
const row = (CardCode: string) => ({ CardCode, SalesEmployee: 1, Subject: 1, U_PlanDate: '2026-09-23', U_PlanTime: '10:00' });

function make(request: ReturnType<typeof vi.fn>) {
  const tenants = { get: () => ({ sap: shopSap }) };
  return new ControlPanelService({} as never, {} as never, { request } as never, tenants as never);
}

describe('ControlPanelService.bulkCreateActivities', () => {
  it('posts nothing when any CardCode is unknown', async () => {
    const request = vi.fn(async (_sap, method: string, path: string) => {
      if (path.startsWith("BusinessPartners('BAD')")) throw new Error('404');
      if (method === 'post') throw new Error('should not post');
      return {};
    });
    const res = await make(request).bulkCreateActivities('TZ', [row('C1'), row('BAD')]);
    expect(res.status).toBe(false);
    expect(res.message).toContain('Invalid Customer Code (BAD)');
    expect(request.mock.calls.some((c) => c[1] === 'post')).toBe(false);
  });

  it('escapes quotes in CardCode, defaults UDFs, and reports rows created before a failure', async () => {
    let posts = 0;
    const request = vi.fn(async (_sap, method: string, _path: string, body?: Record<string, unknown>) => {
      if (method === 'get') return {};
      expect(body).toMatchObject({ U_Status: 'A', U_IsPlanned: 'Yes' });
      if (++posts === 2) throw new Error('SAP says no');
      return { ClgCode: 100 + posts };
    });
    const res = await make(request).bulkCreateActivities('TZ', [row("O'NEIL"), row('C2')]);
    expect(request.mock.calls[0][2]).toBe("BusinessPartners('O''NEIL')?$select=CardCode");
    expect(res).toMatchObject({ status: false, data: { created: [101] } });
    expect(res.message).toContain('1 of 2 already created');
  });
});
