import { BadRequestException } from '@nestjs/common';
import * as Q from './sap-queries.js';

// The legacy Sellerkit endpoint ran whatever SQL + connection string the browser sent, as sa.
// Here the browser can only send a query from the two lists below; it runs on the logged-in
// user's shop SAP DB with every value bound as a parameter. Add an entry per query the
// dashboard needs - nothing else is ever executed.

// 1. Procedure-style calls: "[Name] arg, arg" / "EXEC Name arg". `sql` = the logic lives in this
//    API (the proc is missing or wrong in some shop); `proc` = call the shop's own proc, which
//    every shop has with the same parameters but shop-specific logic; `sap` = a change, made
//    through the caller's own SAP Service Layer session instead of a direct table UPDATE.
type Param = { name: string; type: 'int' | 'decimal' | 'date' | 'string' | 'xml' };
export type SapAction = { method: 'patch'; path: string; body: Record<string, unknown> };
const PROCS: Record<string, { sql?: string; proc?: string; sap?: (p: Record<string, unknown>) => SapAction; params: Param[] }> = {
  GetSalesPersonDetails: { sql: Q.SALES_PERSON_DETAILS, params: [{ name: 'SlpCode', type: 'int' }] },
  BZ_CRM_SalesType: { sql: Q.SALES_TYPES, params: [] },
  // Today's planned (open) activities of a salesperson, with customer and subject - each shop's own proc
  // (Tanzania's also returns contact time/date and the checked-in flag).
  BZ_CRM_Get_Cust_for_saleCall: { proc: 'BZ_CRM_Get_Cust_for_saleCall', params: [{ name: 'SlpCode', type: 'int' }] },
  // Which approval an order needs (credit limit, credit days, cash, NC products...). Logic differs per
  // shop; the proc only reads. Returns SAPName / SAPPassword / RespMessage.
  BZ_CRM_CHeckApproval: {
    proc: 'BZ_CRM_CHeckApproval',
    params: [
      { name: 'CardCode', type: 'string' },
      { name: 'DocTotal', type: 'decimal' },
      { name: 'xml', type: 'xml' },
    ],
  },
  // Approve a quotation. The proc (Tanzania only) was: UPDATE OQUT SET U_DL_Approval = 'Y' WHERE DocEntry = @DocEntry
  BZ_ApproveQuoteinCRMandPOS: {
    sap: (p) => ({ method: 'patch', path: `Quotations(${p.DocEntry})`, body: { U_DL_Approval: 'Y' } }),
    params: [{ name: 'DocEntry', type: 'int' }],
  },
  // Quotations of a salesperson and their team in a date range (Tanzania's adds approval status)
  BZ_CRM_GET_QUOTATION_BY_SLPCODE: {
    proc: 'BZ_CRM_GET_QUOTATION_BY_SLPCODE',
    params: [
      { name: 'SlpCode', type: 'int' },
      { name: 'FromDate', type: 'date' },
      { name: 'ToDate', type: 'date' },
    ],
  },
};

// 2. Plain SELECTs, written exactly as the dashboard sends them. A request matches when it
//    is the same statement ignoring whitespace, letter case and the literal values; those
//    values are bound as parameters (so "= '2'" may be any value, but the statement may not change).
const STATEMENTS = [
  // Document numbering series for an object type (e.g. '2' = business partners, sub type 'C' = customers)
  "Select Series, SeriesName From NNM1 Where ObjectCode = '2' And DocSubType = 'C'",
  // Number of a salesperson's checked-in activities planned for a day
  "Select count(*) Cnt From OCLG where SlpCode = 1 and U_CheckedIn = 'Yes' and U_Status = 'A' and U_PlanDate = '2026-09-30'",
  // A salesperson's checked-in, open visits with customer and visit subject
  "Select T0.ClgCode, T0.CardCode , CardName,T2.Name VisitReg,CntctTime,CntctDate,T0.Details,CntctSbjct From OCLG T0 Inner Join OCRD T1 on T0.CardCode = T1.CardCode Inner Join OCLS T2 on T2.Code = T0.CntctSbjct where T0.SlpCode = 1 and U_CheckedIn = 'Yes' and U_Status = 'A'",
  // Activity statuses (activity planning)
  'select * from OCLS',
  // Customer groups
  "select * from OCRG where GroupType = 'C'",
  // Payment terms
  'Select GroupNum, PymntGroup from OCTG',
  // Territories (below the root)
  'Select territryID, descript From OTER where parent > 0',
  // Committed / on-order quantity of one item in one warehouse
  "SELECT ItemCode, WhsCode AS WarehouseCode, IsCommited AS Committed, OnOrder AS Ordered FROM OITW WHERE ItemCode = 'AEM/104' and WhsCode='KEFG' ORDER BY WhsCode",
  // Sales orders by status in a date range, with a customer code/name search
  "SELECT DocEntry,DocNum,DocDate,CardCode,CardName,DocStatus,CANCELED FROM ORDR WHERE DocStatus = 'O' AND CANCELED = 'N' AND (CardCode LIKE '%%' OR CardName LIKE '%%') AND DocDate >= '2026-09-01' AND DocDate <= '2026-09-23' ORDER BY DocDate DESC",
  // Sales orders by status in a date range
  "SELECT DocEntry,DocNum,DocDate,CardCode,CardName,DocStatus AS DocumentStatus,CANCELED AS CancelStatus FROM ORDR WHERE DocStatus = 'C' AND CANCELED = 'N' AND DocDate >= '2026-09-01' AND DocDate <= '2026-09-30' ORDER BY DocDate DESC",
  // Sales order approval requests of a salesperson in a date range, by approval status ('Y' approved, ...)
  "Select T0.[WddCode],T0.[WtmCode],T0.[ObjType],T0.[CurrStep],T0.[CreateDate], T0.[CreateTime],T0.[DraftEntry],T2.[USER_CODE] [FromUser], T3.[DocNum], T3.[DocDate] ,T3.[CardCode], T3.[CardName] From [OWDD] T0 Inner Join [OUSR] T2 on T2.[USERID] = T0.[UserSign] Inner Join [ODRF] T3 on T3.[DocEntry] = T0.[DraftEntry] Where T0.[Status] = 'Y' and T3.[DocStatus] <> 'C' And T0.[ObjType] = 17 and T3.[SlpCode] = 1 and t3.DocDate between '20250301' and '20260930' order by T3.[DocDate] desc",
  // Approval requests (drafts) of a salesperson for a customer, by approval status ('W' waiting, 'N' rejected, ...)
  "SELECT DISTINCT T0.WddCode, T0.WtmCode, T0.ObjType, T0.CurrStep, T0.CreateDate, T0.CreateTime, T0.DraftEntry, T2.USER_CODE AS FromUser, T3.DocNum, T3.DocDate, T3.CardCode, T3.CardName FROM OWDD T0 INNER JOIN WST1 T1 ON T0.CurrStep = T1.WstCode INNER JOIN OUSR T2 ON T2.USERID = T0.UserSign INNER JOIN ODRF T3 ON T3.DocEntry = T0.DraftEntry WHERE T0.Status = 'W' AND T3.SlpCode = 1 AND T3.CardCode = 'D11137' AND T3.DocDate >= '2026-09-01' AND T3.DocDate <= '2026-09-30' ORDER BY T0.CreateDate DESC, T0.CreateTime DESC",
];

const LITERAL = /N?'(?:[^']|'')*'|\b\d+(?:\.\d+)?\b/g;
const shapeOf = (sql: string) => sql.replace(LITERAL, '?').replace(/\s+/g, ' ').replace(/\s*;?\s*$/, '').trim().toLowerCase();
const literalsOf = (sql: string) =>
  (sql.match(LITERAL) ?? []).map((l) => (l.endsWith("'") ?l.replace(/^N?'|'$/g, '').replace(/''/g, "'") : Number(l)));

const STATEMENT_BY_SHAPE = new Map(
  STATEMENTS.map((sql) => {
    let i = 0;
    return [shapeOf(sql), sql.replace(LITERAL, () => `@p${i++}`)] as const;
  }),
);

// Removes block comments that sit outside quoted text - the dashboard appends a cache-buster marker
// to its queries (slash-star r=0 star-slash).
function stripComments(text: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") quoted = !quoted;
    if (!quoted && text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end >= 0) {
        out += ' ';
        i = end + 1;
        continue;
      }
    }
    out += text[i];
  }
  return out;
}

/** Splits "'a', 12.5, 'it''s'" into ["a", "12.5", "it's"]: quoted values may contain commas and ''. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (i >= text.length) break;
    let value = '';
    if (text[i] === "'" || (text[i] === 'N' && text[i + 1] === "'")) {
      i += text[i] === 'N' ? 2 : 1;
      for (;;) {
        if (i >= text.length) throw new BadRequestException('Unterminated quoted value');
        if (text[i] === "'") {
          if (text[i + 1] !== "'") break;
          value += "'";
          i += 2;
        } else {
          value += text[i++];
        }
      }
      i++; // closing quote
      while (/\s/.test(text[i] ?? '')) i++;
      if (i < text.length && text[i] !== ',') throw new BadRequestException('Unexpected text after a quoted value');
    } else {
      const end = text.indexOf(',', i);
      value = text.slice(i, end < 0 ? text.length : end).trim();
      i = end < 0 ? text.length : end;
    }
    args.push(value);
    if (text[i] === ',') {
      i++;
      if (i >= text.length) args.push(''); // trailing comma = empty last argument
    }
  }
  return args;
}

/** Turns the legacy `query` text into an allowed statement (or shop proc) + bound params, or throws 400. */
export function parseSellerkitQuery(query: string): { sql?: string; proc?: string; sap?: SapAction; params: Record<string, unknown> } {
  const text = stripComments(query ?? '');

  const statement = STATEMENT_BY_SHAPE.get(shapeOf(text));
  if (statement) {
    return { sql: statement, params: Object.fromEntries(literalsOf(text).map((v, i) => [`p${i}`, v])) };
  }

  const m = /^\s*(?:EXEC(?:UTE)?\s+)?(?:\[?dbo\]?\.)?\[?(\w+)\]?(?:\s+(.*?))?\s*;?\s*$/is.exec(text);
  const name = m && Object.keys(PROCS).find((n) => n.toLowerCase() === m[1].toLowerCase());
  if (!m || !name) {
    throw new BadRequestException('Query not allowed. Ask the API team to add it to the approved Sellerkit list.');
  }
  const def = PROCS[name];
  const args = splitArgs(m[2] ?? '');
  if (args.length !== def.params.length) {
    throw new BadRequestException(`${name} expects ${def.params.length} argument(s): ${def.params.map((p) => p.name).join(', ')}`);
  }
  const params: Record<string, unknown> = {};
  def.params.forEach((p, i) => {
    if (p.type === 'int' && !/^-?\d+$/.test(args[i])) {
      throw new BadRequestException(`${p.name} must be a whole number`);
    }
    if (p.type === 'decimal' && !/^-?\d+(\.\d+)?$/.test(args[i])) {
      throw new BadRequestException(`${p.name} must be a number`);
    }
    if (p.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(args[i])) {
      throw new BadRequestException(`${p.name} must be a date like 2026-04-01`);
    }
    if (p.type === 'xml') {
      // The text is bound as a parameter (never run as SQL). SQL Server refuses nvarchar text that
      // declares encoding="UTF-8", so drop the XML declaration; cap the size.
      const xml = args[i].replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
      if (!xml.startsWith('<') || xml.length > 200_000) {
        throw new BadRequestException(`${p.name} must be XML of at most 200000 characters`);
      }
      params[p.name] = xml;
      return;
    }
    params[p.name] = p.type === 'int' || p.type === 'decimal' ? Number(args[i]) : args[i];
  });
  return { sql: def.sql, proc: def.proc, sap: def.sap?.(params), params };
}
