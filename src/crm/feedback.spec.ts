import { describe, expect, it, vi } from 'vitest';
import { CrmService } from './crm.service.js';

function make(udfs: string[], subject: { Code: number; Type: number }[] = [{ Code: 15, Type: -1 }]) {
  const db = { query: vi.fn(async (_t: string, _k: string, sql: string) => (sql.includes('CUFD') ? udfs.map((AliasID) => ({ AliasID })) : subject)) };
  const sap = { request: vi.fn(async () => ({ ClgCode: 77 })) };
  return { svc: new CrmService(db as never, sap as never, {} as never, {} as never), sap };
}
const me = {} as never;
const body = { CardCode: 'C1', SalesEmployee: 3, Details: 'late delivery', U_PrdCd: 'P1', U_Complaints: 'colour', U_AppTyp: 'Technical', U_Link1: 'http://x/1.jpg' };

describe('saveFeedback', () => {
  it('posts a Customer Feedback phone-call activity with the fields the shop has', async () => {
    const { svc, sap } = make(['PrdCd', 'Complaints', 'AppTyp', 'Link1']);
    await expect(svc.saveFeedback(me, 'UG', body)).resolves.toMatchObject({ status: true, data: { ClgCode: 77 } });
    expect(sap.request).toHaveBeenCalledWith(me, 'post', 'Activities', expect.objectContaining({
      CardCode: 'C1', SalesEmployee: 3, Activity: 'cn_Conversation', ActivityType: -1, Subject: 15, Details: 'late delivery',
      U_PrdCd: 'P1', U_Complaints: 'colour', U_AppTyp: 'Technical', U_Link1: 'http://x/1.jpg',
    }));
  });

  it('skips fields the shop lacks and keeps the product code in the remarks', async () => {
    const { svc, sap } = make(['Complaints', 'Link1']);
    await svc.saveFeedback(me, 'ZM', body);
    const payload = (sap.request.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('U_PrdCd');
    expect(payload).not.toHaveProperty('U_AppTyp');
    expect(payload.Details).toBe('late delivery Product: P1');
  });

  it('rejects when the shop has no Customer Feedback subject and none is sent', async () => {
    await expect(make([], []).svc.saveFeedback(me, 'UG', body)).rejects.toThrow('Customer Feedback');
  });
});
