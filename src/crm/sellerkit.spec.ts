import { describe, expect, it } from 'vitest';
import { parseSellerkitQuery } from './sellerkit.js';

describe('parseSellerkitQuery', () => {
  it('accepts the legacy proc call forms and binds the argument as a parameter', () => {
    for (const q of ['[GetSalesPersonDetails] 88', 'EXEC GetSalesPersonDetails 88', 'exec [dbo].[getsalespersondetails] 88;', "[GetSalesPersonDetails] '88'"]) {
      expect(parseSellerkitQuery(q).params).toEqual({ SlpCode: 88 });
    }
  });

  it('accepts an approved SELECT exactly as the dashboard sends it, with its values bound as parameters', () => {
    const r = parseSellerkitQuery("Select Series, SeriesName From nnm1 Where ObjectCode = '2' And DocSubType = 'C'");
    expect(r.sql).toBe('Select Series, SeriesName From NNM1 Where ObjectCode = @p0 And DocSubType = @p1');
    expect(r.params).toEqual({ p0: '2', p1: 'C' });
  });

  it('accepts the other approved dashboard queries exactly as sent', () => {
    expect(parseSellerkitQuery("select * from ocrg where Grouptype = 'c'")).toEqual({ sql: 'select * from OCRG where GroupType = @p0', params: { p0: 'c' } });
    expect(parseSellerkitQuery('Select GroupNum, PymntGroup from OCTG')).toEqual({ sql: 'Select GroupNum, PymntGroup from OCTG', params: {} });
    expect(parseSellerkitQuery("SELECT slpcode, slpname FROM OSLP WHERE Active = 'Y' ORDER BY slpname").params).toEqual({ p0: 'Y' });
    expect(parseSellerkitQuery('Select territryID, descript From OTER where parent > 0')).toEqual({ sql: 'Select territryID, descript From OTER where parent > @p0', params: { p0: 0 } });
    expect(
      parseSellerkitQuery("SELECT ItemCode, WhsCode AS WarehouseCode, IsCommited AS Committed, OnOrder AS Ordered FROM OITW WHERE ItemCode = 'AEM/104' and WhsCode='KEFG' ORDER BY WhsCode;"),
    ).toEqual({
      sql: 'SELECT ItemCode, WhsCode AS WarehouseCode, IsCommited AS Committed, OnOrder AS Ordered FROM OITW WHERE ItemCode = @p0 and WhsCode=@p1 ORDER BY WhsCode',
      proc: undefined,
      sap: undefined,
      params: { p0: 'AEM/104', p1: 'KEFG' },
    });
    expect(parseSellerkitQuery('select * from ocls')).toEqual({ sql: 'select * from OCLS', proc: undefined, sap: undefined, params: {} });
    expect(() => parseSellerkitQuery('select * from ocls where 1=1')).toThrow();
    expect(parseSellerkitQuery('BZ_CRM_SalesType').params).toEqual({});
    expect(parseSellerkitQuery('exec [BZ_CRM_SalesType]').sql).toContain("AliasID = 'SaleType'");
  });

  it("routes an approved shop proc to the shop's own procedure with typed, bound arguments", () => {
    expect(parseSellerkitQuery("[BZ_CRM_GET_QUOTATION_BY_SLPCODE] '1','2026-04-01','2026-09-04'")).toEqual({
      sql: undefined,
      proc: 'BZ_CRM_GET_QUOTATION_BY_SLPCODE',
      params: { SlpCode: 1, FromDate: '2026-04-01', ToDate: '2026-09-04' },
    });
    for (const bad of ["[BZ_CRM_GET_QUOTATION_BY_SLPCODE] '1','2026-04-01'", "[BZ_CRM_GET_QUOTATION_BY_SLPCODE] '1','x','2026-09-04'", "[BZ_CRM_GET_QUOTATION_BY_SLPCODE] '1','2026-04-01','2026-09-04''; DROP TABLE OQUT--'"]) {
      expect(() => parseSellerkitQuery(bad), bad).toThrow();
    }
  });

  it('turns the approve-quotation call into a Service Layer change on that one quotation', () => {
    const r = parseSellerkitQuery("BZ_ApproveQuoteinCRMandPOS '12'");
    expect(r.sap).toEqual({ method: 'patch', path: 'Quotations(12)', body: { U_DL_Approval: 'Y' } });
    expect(r.sql).toBeUndefined();
    expect(r.proc).toBeUndefined();
    for (const bad of ["BZ_ApproveQuoteinCRMandPOS '12)/Cancel'", 'BZ_ApproveQuoteinCRMandPOS 12 OR 1=1', 'BZ_ApproveQuoteinCRMandPOS']) {
      expect(() => parseSellerkitQuery(bad), bad).toThrow();
    }
  });

  it('accepts the order-list and approval-request queries as the dashboard sends them', () => {
    const open = parseSellerkitQuery("SELECT DocEntry,DocNum,DocDate,CardCode,CardName,DocStatus,CANCELED FROM ORDR WHERE DocStatus = 'O' AND CANCELED = 'N' AND (CardCode LIKE '%%' OR CardName LIKE '%%') AND DocDate >= '2026-09-01' AND DocDate <= '2026-09-23' ORDER BY DocDate DESC");
    expect(open.params).toEqual({ p0: 'O', p1: 'N', p2: '%%', p3: '%%', p4: '2026-09-01', p5: '2026-09-23' });

    const closed = parseSellerkitQuery("SELECT DocEntry,DocNum,DocDate,CardCode,CardName,DocStatus AS DocumentStatus,CANCELED AS CancelStatus FROM ORDR WHERE DocStatus = 'C' AND CANCELED = 'N' AND DocDate >= '2026-09-01' AND DocDate <= '2026-09-30' ORDER BY DocDate DESC");
    expect(closed.params).toEqual({ p0: 'C', p1: 'N', p2: '2026-09-01', p3: '2026-09-30' });

    const approvals = (status: string, end = '') =>
      parseSellerkitQuery(`SELECT DISTINCT T0.WddCode, T0.WtmCode, T0.ObjType, T0.CurrStep, T0.CreateDate, T0.CreateTime, T0.DraftEntry, T2.USER_CODE AS FromUser, T3.DocNum, T3.DocDate, T3.CardCode, T3.CardName FROM OWDD T0 INNER JOIN WST1 T1 ON T0.CurrStep = T1.WstCode INNER JOIN OUSR T2 ON T2.USERID = T0.UserSign INNER JOIN ODRF T3 ON T3.DocEntry = T0.DraftEntry WHERE T0.Status = '${status}' AND T3.SlpCode = 1 AND T3.CardCode = 'D11137' AND T3.DocDate >= '2026-09-01' AND T3.DocDate <= '2026-09-30' ORDER BY T0.CreateDate DESC, T0.CreateTime DESC${end}`);
    expect(approvals('W', ';').params).toEqual({ p0: 'W', p1: 1, p2: 'D11137', p3: '2026-09-01', p4: '2026-09-30' });
    expect(approvals('N').sql).toBe(approvals('W', ';').sql); // same statement, only the value differs
    expect(approvals('W').sql).toContain('OWDD T0 INNER JOIN WST1 T1'); // table aliases with digits are not treated as values
  });

  it('passes the approval-check proc a card code, a number and the XML document as bound parameters', () => {
    const xml = '<DocumentElements><SCHEMES><LineNum>1</LineNum><ItemCode>10101W001A</ItemCode><Quantity>12</Quantity><Warehouse>KEFG</Warehouse></SCHEMES></DocumentElements>';
    const r = parseSellerkitQuery(`BZ_CRM_CHeckApproval 'D11137',28320.00, '<?xml version="1.0" encoding="UTF-8"?>${xml}'`);
    expect(r).toEqual({ sql: undefined, proc: 'BZ_CRM_CHeckApproval', sap: undefined, params: { CardCode: 'D11137', DocTotal: 28320, xml } });
    // commas, quotes and newlines inside the XML text are data, not argument separators
    const tricky = "<a><b>x, y</b><c>it''s</c></a>";
    expect(parseSellerkitQuery(`[BZ_CRM_CHeckApproval] 'C1', 5, '${tricky}'`).params).toMatchObject({ CardCode: 'C1', DocTotal: 5, xml: "<a><b>x, y</b><c>it's</c></a>" });
  });

  it('rejects malformed approval-check calls instead of guessing', () => {
    for (const bad of [
      "BZ_CRM_CHeckApproval 'C1', abc, '<a/>'",
      "BZ_CRM_CHeckApproval 'C1', 5",
      "BZ_CRM_CHeckApproval 'C1', 5, 'not xml'",
      "BZ_CRM_CHeckApproval 'C1', 5, '<a/>' extra",
      "BZ_CRM_CHeckApproval 'C1', 5, '<a/>",
      `BZ_CRM_CHeckApproval 'C1', 5, '<a>${'x'.repeat(200_001)}</a>'`,
    ]) {
      expect(() => parseSellerkitQuery(bad), bad.slice(0, 50)).toThrow();
    }
  });

  it('accepts the approved-sales-orders query with bracketed names, a number and a BETWEEN range', () => {
    const r = parseSellerkitQuery("Select T0.[WddCode],T0.[WtmCode],T0.[ObjType],T0.[CurrStep],T0.[CreateDate], T0.[CreateTime],T0.[DraftEntry],T2.[USER_CODE] [FromUser], T3.[DocNum], T3.[DocDate] ,T3.[CardCode], T3.[CardName] From [OWDD] T0 Inner Join [OUSR] T2 on T2.[USERID] = T0.[UserSign] Inner Join [ODRF] T3 on T3.[DocEntry] = T0.[DraftEntry] Where T0.[Status] = 'Y' and T3.[DocStatus] <> 'C' And T0.[ObjType] = 17 and T3.[SlpCode] = 1 and t3.DocDate between '20250301' and '20260930' order by T3.[DocDate] desc");
    expect(r.params).toEqual({ p0: 'Y', p1: 'C', p2: 17, p3: 1, p4: '20250301', p5: '20260930' });
    expect(r.sql).toContain("T0.[Status] = @p0");
    expect(r.sql).toContain('between @p4 and @p5');
  });

  it('accepts the planning-screen queries, with the trailing /*r=0*/ marker the dashboard appends', () => {
    expect(parseSellerkitQuery("BZ_CRM_Get_Cust_for_saleCall '1' /*r=0*/")).toEqual({ sql: undefined, proc: 'BZ_CRM_Get_Cust_for_saleCall', sap: undefined, params: { SlpCode: 1 } });
    const r = parseSellerkitQuery("Select count(*) Cnt From oclg where slpcode = 1 and U_CheckedIn = 'Yes' and U_Status = 'A' and U_PlanDate = '2026-09-30' /*r=0*/");
    expect(r.params).toEqual({ p0: 1, p1: 'Yes', p2: 'A', p3: '2026-09-30' });
    expect(r.sql).toBe('Select count(*) Cnt From OCLG where SlpCode = @p0 and U_CheckedIn = @p1 and U_Status = @p2 and U_PlanDate = @p3');
  });

  it('ignores comments only outside quoted text, and never lets a comment smuggle SQL through', () => {
    expect(parseSellerkitQuery("/*x*/ [GetSalesPersonDetails] /* y */ 88 /*z*/").params).toEqual({ SlpCode: 88 });
    // "/*" inside a quoted value is data, not a comment
    expect(parseSellerkitQuery("select * from OCRG where GroupType = 'a/*b*/c'").params).toEqual({ p0: 'a/*b*/c' });
    // an unterminated comment is not silently dropped; the text must still match an approved statement
    for (const bad of ['select * from OCLS /* DROP TABLE OCLS', "[GetSalesPersonDetails] 88 /* ; DROP TABLE OQUT", 'select * from OCLS /*a*/ where 1=1']) {
      expect(() => parseSellerkitQuery(bad), bad).toThrow();
    }
  });

  it('accepts the checked-in visits query as the dashboard sends it', () => {
    const r = parseSellerkitQuery("Select T0.ClgCode, T0.CardCode , CardName,T2.Name VisitReg,CntctTime,CntctDate,T0.Details,CntctSbjct From oclg T0 Inner Join OCRD T1 on T0.CardCode = T1.CardCode Inner Join OCLS T2 on T2.Code = T0.CntctSbjct where T0.slpcode = 1 and U_CheckedIn = 'Yes' and U_Status = 'A'");
    expect(r.params).toEqual({ p0: 1, p1: 'Yes', p2: 'A' });
    expect(r.sql).toContain('where T0.SlpCode = @p0 and U_CheckedIn = @p1 and U_Status = @p2');
    expect(r.sql).toContain('Inner Join OCLS T2 on T2.Code'); // aliases with digits stay intact
  });

  it('accepts the document-details procs by DocEntry, in any letter case, and rejects anything else', () => {
    const r = parseSellerkitQuery('[Getdraftdetails] 102');
    expect(r.params).toEqual({ docentry: 102 });
    expect(r.sql).toContain('FROM ODRF T0');
    expect(parseSellerkitQuery('exec GetOrderDetails 7').sql).toContain('FROM ORDR T0');
    expect(parseSellerkitQuery("[GetQuotationDetails] '9'").sql).toContain('FROM OQUT T0');
    expect(parseSellerkitQuery('sp_GetQuotation 3').sql).toContain('OQUT');
    for (const q of ['[GetDraftDetails] 1', '[GetOrderDetails] 1', '[GetQuotationDetails] 1', 'sp_GetQuotation 1']) expect(parseSellerkitQuery(q).withLines, q).toBe(true); // header + items
    expect(parseSellerkitQuery('BZ_CRM_SalesType').withLines).toBeUndefined();
    for (const bad of ['[GetDraftDetails]', '[GetDraftDetails] abc', '[GetDraftDetails] 1 OR 1=1', '[GetDraftDetails] 1, 2', '[GetDraftDetails] 102; DROP TABLE ODRF']) {
      expect(() => parseSellerkitQuery(bad), bad).toThrow();
    }
  });

  it('matches regardless of spacing/case and lets the values vary - including hostile ones, which stay data', () => {
    const r = parseSellerkitQuery("  select series,  seriesname\n from NNM1 where objectcode = '17' and docsubtype = 'x'' OR 1=1 --' ; ");
    expect(r.sql).toContain('@p0');
    expect(r.params).toEqual({ p0: '17', p1: "x' OR 1=1 --" });
  });

  it('rejects anything whose structure is not on the approved list', () => {
    for (const q of [
      'SELECT * FROM Users',
      'DROP TABLE OCRD',
      '[GetSalesPersonDetails] 88; DROP TABLE OCRD',
      '[GetSalesPersonDetails] 88 OR 1=1',
      '[xp_cmdshell] dir',
      '[GetSalesPersonDetails]',
      "Select Series, SeriesName, Remark From nnm1 Where ObjectCode = '2' And DocSubType = 'C'",
      "Select Series, SeriesName From nnm1 Where ObjectCode = '2' And DocSubType = 'C' OR 1=1",
      "Select Series, SeriesName From nnm1 Where ObjectCode = '2' And DocSubType = 'C'; DELETE FROM OCRD",
      "Select Series, SeriesName From nnm1 Where ObjectCode = '2' And DocSubType = 'C' UNION SELECT name, password FROM sys.sql_logins",
      '',
    ]) {
      expect(() => parseSellerkitQuery(q), q).toThrow();
    }
  });
});
