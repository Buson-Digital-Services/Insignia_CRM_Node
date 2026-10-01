import { describe, expect, it, vi } from 'vitest';
import { CrmService } from './crm.service.js';

const own = { sapUrl: 'http://sl/b1s/v1/', sapCompanyDb: 'DB', sapUsername: 'dodoma', sapPassword: 'own-pw' };
const order = (extra: Record<string, unknown> = {}, lines: unknown[] = [{ ItemCode: 'A1', Quantity: 12, UnitPrice: 2000, DiscountPercent: 0, TaxCode: '01', WarehouseCode: 'KEFG' }]) =>
  ({ CardCode: 'D11137', DocDate: '2026-09-30', DocDueDate: '2026-09-30', DocumentLines: lines, ...extra }) as never;

function make(execProc: (...a: unknown[]) => unknown, query?: (...a: unknown[]) => unknown) {
  const db = { execProc: vi.fn(execProc), query: vi.fn(query ?? (async () => [{ Rate: 18 }])) };
  const sap = { request: vi.fn().mockResolvedValue({ DocEntry: 9 }) };
  return { svc: new CrmService(db as never, sap as never, {} as never, {} as never), db, sap };
}
const approvalRow = { SAPName: 'SODAYSAPP', SAPPassword: '1234', RespMessage: 'Document needs Credit Days Approval. Hence saved as Draft!!!' };

describe('CrmService.createSalesOrder approval', () => {
  it('creates the order under the approval account the shop proc names, and reports its message', async () => {
    const { svc, db, sap } = make(async () => [approvalRow]);
    const res = await svc.createSalesOrder(own, order(), 'KE');

    expect(sap.request).toHaveBeenCalledTimes(1);
    expect(sap.request.mock.calls[0][0]).toEqual({ ...own, sapUsername: 'SODAYSAPP', sapPassword: '1234' }); // same SAP URL + company, approval account
    expect(res).toEqual({ status: true, message: approvalRow.RespMessage, data: { DocEntry: 9 } });
    expect(JSON.stringify(res)).not.toContain('1234'); // the approval password stays on the server

    const [tenant, kind, proc, params] = db.execProc.mock.calls[0];
    expect([tenant, kind, proc]).toEqual(['KE', 'sapDb', 'BZ_CRM_CHeckApproval']);
    expect(params).toMatchObject({ CardCode: 'D11137', DocTotal: 28320 }); // 12 x 2000 + 18% tax, worked out here
    expect((params as { xml: string }).xml).toBe(
      '<DocumentElements><SCHEMES><LineNum>1</LineNum><ItemCode>A1</ItemCode><Quantity>12</Quantity><PriceBefDi>2000</PriceBefDi><U_Cartons>0</U_Cartons><Balance>0</Balance><Customer>D11137</Customer><Warehouse>KEFG</Warehouse></SCHEMES></DocumentElements>',
    );
  });

  it("uses the caller's own SAP account when no approval is needed", async () => {
    for (const rows of [[{ SAPName: '', SAPPassword: '', RespMessage: 'Order created Successfully!!!' }], [{ SAPName: null, SAPPassword: null, RespMessage: null }], []]) {
      const { svc, sap } = make(async () => rows);
      const res = await svc.createSalesOrder(own, order(), 'TZ');
      expect(sap.request.mock.calls[0][0]).toBe(own);
      expect(res.message).toBe('Sales Order Created');
    }
  });

  it("skips the check in a shop whose SAP DB has no such procedure (e.g. Zambia), but fails closed on any other error", async () => {
    const missing = make(async () => Promise.reject(Object.assign(new Error('Could not find stored procedure'), { number: 2812 })));
    await missing.svc.createSalesOrder(own, order(), 'ZM');
    expect(missing.sap.request.mock.calls[0][0]).toBe(own);

    const broken = make(async () => Promise.reject(new Error('connection lost')));
    await expect(broken.svc.createSalesOrder(own, order(), 'KE')).rejects.toThrow('connection lost');
    expect(broken.sap.request).not.toHaveBeenCalled(); // never create an unchecked order
  });

  it('ignores a total sent by the client - it could be used to dodge the credit-limit check', async () => {
    const { svc, db } = make(async () => []);
    await svc.createSalesOrder(own, order({ DocTotal: 1 }), 'KE');
    expect(db.execProc.mock.calls[0][3]).toMatchObject({ DocTotal: 28320 });
  });

  it("takes a quotation line's item, price, discount and tax from that quotation", async () => {
    const { svc, db, sap } = make(
      async () => [],
      async (...a: unknown[]) => (String(a[2]).includes('QUT1') ? [{ ItemCode: 'Q1', WhsCode: 'W1', Price: 100, DiscPrcnt: 10, VatPrcnt: 16 }] : [{ Rate: 18 }]),
    );
    await svc.createSalesOrder(own, order({}, [{ BaseEntry: 5, BaseLine: 0, Quantity: 2 }]), 'KE');
    const params = db.execProc.mock.calls[0][3] as { DocTotal: number; xml: string };
    expect(params.DocTotal).toBe(208.8); // 2 x 100 x 0.90 x 1.16
    expect(params.xml).toContain('<ItemCode>Q1</ItemCode>');
    expect(params.xml).toContain('<Warehouse>W1</Warehouse>');
    expect(sap.request.mock.calls[0][3].DocumentLines[0]).toMatchObject({ BaseType: 23, BaseEntry: 5, BaseLine: 0, Quantity: 2 });
  });
});

describe('CrmService.createSalesOrder when SAP answers "-2028 No matching records found"', () => {
  const sapError = new Error('SAP Service Layer error on POST Orders: 404 {"error":{"code":-2028,"message":{"value":"No matching records found (ODBC -2028)"}}}');
  // a database that knows only series 8, tax code O1, item A1, warehouse KEFG, customer D11137, salesperson 1
  const known: Record<string, unknown[]> = { NNM1: [{ Series: 8, SeriesName: 'KESO26' }], OVTG: [{ Code: 'O1' }], OITM: [{}], OWHS: [{}], OCRD: [{}], OSLP: [{}] };
  const lookup = async (...a: unknown[]) => {
    const [, , sql, p] = a as [string, string, string, { v?: unknown }];
    if (sql.startsWith('SELECT 1')) {
      const table = /FROM (\w+)/.exec(sql)![1];
      const valid: Record<string, unknown[]> = { NNM1: [8], OVTG: ['O1'], OITM: ['A1'], OWHS: ['KEFG'], OCRD: ['D11137'], OSLP: [1] };
      return valid[table].includes(p.v) ? [{}] : [];
    }
    return sql.includes('NNM1') ? known.NNM1 : sql.includes('OVTG') ? [{ Code: 'O0' }, { Code: 'O1' }] : [];
  };
  const line = (extra = {}) => ({ ItemCode: 'A1', Quantity: 1, UnitPrice: 10, WarehouseCode: 'KEFG', TaxCode: 'O1', ...extra });

  it('names the values this company does not have, with the valid choices', async () => {
    const { svc, sap } = make(async () => [], lookup);
    sap.request.mockRejectedValue(sapError);
    await expect(svc.createSalesOrder(own, order({ Series: 1506 }, [line({ TaxCode: '01' })]), 'KE')).rejects.toThrow(
      'SAP rejected the document - not found in this company: Series 1506 (valid: 8=KESO26); TaxCode 01 (valid: O0, O1)',
    );
  });

  it('passes the original SAP error through when every value exists, and looks nothing up for other errors', async () => {
    const all = make(async () => [], lookup);
    all.sap.request.mockRejectedValue(sapError);
    await expect(all.svc.createSalesOrder(own, order({ Series: 8 }, [line()]), 'KE')).rejects.toBe(sapError);

    const other = make(async () => [], lookup);
    other.sap.request.mockRejectedValue(new Error('SAP Service Layer error on POST Orders: 400 {"error":{"code":-5002}}'));
    const callsBefore = other.db.query.mock.calls.length;
    await expect(other.svc.createSalesOrder(own, order({ Series: 1506 }, [line()]), 'KE')).rejects.toThrow('-5002');
    expect(other.db.query.mock.calls.length).toBe(callsBefore + 2); // the tax-rate lookup and the latest-draft snapshot, nothing to diagnose
  });
});

describe('CrmService.createSalesOrder when SAP saves the document as an approval draft', () => {
  const draftReply = new Error('SAP Service Layer error on POST Orders: 404 {"error":{"code":-2028,"message":{"value":"No matching records found (ODBC -2028)"}}}');
  // SAP reports a document saved as a draft for approval as -2028; the draft itself exists in ODRF
  const db = async (...a: unknown[]) => {
    const sql = String(a[2]);
    if (sql.includes('MAX(DocEntry)')) return [{ n: 31 }];
    if (sql.includes('FROM ODRF D')) return [{ DocEntry: 32, DocNum: 15 }];
    return [{ Rate: 16 }];
  };

  it('answers success with the draft number instead of an error, and looks only for drafts made after the request', async () => {
    const { svc, sap, db: mock } = make(async () => [approvalRow], db);
    sap.request.mockRejectedValue(draftReply);
    const res = await svc.createSalesOrder(own, order(), 'KE');
    expect(res).toEqual({ status: true, message: approvalRow.RespMessage, data: { DocEntry: 32, DocNum: 15, IsDraft: true } });
    const lookup = mock.query.mock.calls.find((c) => String(c[2]).includes('FROM ODRF D'))!;
    expect(lookup[3]).toEqual({ after: 31, type: '17', card: 'D11137', user: 'SODAYSAPP' }); // this account, this customer, newer than the snapshot
  });

  it('has its own wording when no approval message came from the shop', async () => {
    const { svc, sap } = make(async () => [], db);
    sap.request.mockRejectedValue(draftReply);
    const res = await svc.createSalesOrder(own, order(), 'KE');
    expect(res).toMatchObject({ status: true, message: 'Document needs approval. Hence saved as Draft!!!', data: { DocEntry: 32, IsDraft: true } });
  });

  it('sends the tax code as VatGroup - the Service Layer ignores TaxCode on document lines', async () => {
    const { svc, sap } = make(async () => [], async () => [{ Rate: 16 }]);
    await svc.createSalesOrder(own, order({}, [{ ItemCode: 'A1', Quantity: 1, UnitPrice: 10, TaxCode: 'O1' }]), 'KE');
    const line = sap.request.mock.calls[0][3].DocumentLines[0];
    expect(line).toMatchObject({ VatGroup: 'O1' });
    expect(line).not.toHaveProperty('TaxCode');
  });
});

