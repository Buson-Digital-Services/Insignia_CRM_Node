import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { EmailService } from './email.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { buildDataSetXml } from './dataset-xml.util.js';
import * as Q from './sap-queries.js';
import type { DbKind, InsigRes, SapIdentity } from '../common/types.js';
import type {
  ActivitesDTO,
  BusinessPartnerRequest,
  CheckedInDTO,
  CheckedoutDTO,
  DiscountCalcRequest,
  QuotationRequest,
  SalesOrderModel,
  UserDetailsDto,
} from './dto/crm.dto.js';

export interface HeadLineResult {
  respType: string;
  respCode: string;
  data?: { Head: unknown[]; Line: unknown[] };
  respDesc?: string;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sap: SapService,
    private readonly email: EmailService,
    private readonly tenants: TenantService,
  ) {}

  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // ---- generic helpers matching the legacy {status,message,data} envelope ----

  private async runProc<T = Record<string, unknown>>(
    tenantCode: string,
    kind: DbKind,
    proc: string,
    params: Record<string, unknown> = {},
  ): Promise<InsigRes<T[]>> {
    const rows = await this.db.execProc<T>(tenantCode, kind, proc, params);
    return rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' };
  }

  // SAP-side reads run as plain queries (sap-queries.ts), not procs: shops' SAP DBs
  // don't all have the custom procs and must not be changed.
  private async runSapQuery<T = Record<string, unknown>>(tenantCode: string, text: string, params: Record<string, unknown> = {}): Promise<InsigRes<T[]>> {
    const rows = await this.db.query<T>(tenantCode, 'sapDb', text, params);
    return rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' };
  }

  private async runSapHeadLine(tenantCode: string, text: string, params: Record<string, unknown>): Promise<HeadLineResult> {
    const [head, line] = await this.db.querySets(tenantCode, 'sapDb', text, params);
    if (!head?.length && !line?.length) {
      return { respType: 'No data found.', respCode: '500' };
    }
    return { respType: 'Success', respCode: '200', data: { Head: head ?? [], Line: line ?? [] } };
  }

  private async runDiscountCalc(tenantCode: string, proc: string, req: DiscountCalcRequest) {
    // Shops with schemeReq=false (TENANT_<CODE>_SCHEME_REQ, also returned by GetUrls) have no
    // usable scheme setup - their procs are missing or point at unavailable scheme DBs.
    if (!this.tenants.get(tenantCode).urls.schemeReq) {
      return { status: false, message: 'Discount schemes are not enabled for this country' };
    }
    const xml = buildDataSetXml('SCHEMES', req.SCHEMES as unknown as Record<string, unknown>[]);
    // @DocEntry is only echoed into the result rows; the legacy API always passed 1 (positionally).
    const rows = await this.db.execProc(tenantCode, 'sapDb', proc, { xml, DocEntry: 1 });
    return rows.length > 0 ? { status: true, message: 'Sucess', data: rows } : { status: false, message: 'No Data Found' };
  }

  // ---- menus / users / auth-adjacent (all stored-proc passthroughs) ----

  listOfMenus(tenantCode: string) {
    return this.runProc(tenantCode, 'app', 'Get_Menus');
  }

  async getUserMenuIds(tenantCode: string, userKey: number): Promise<number[]> {
    const rows = await this.db.query<{ MenuKey: number }>(tenantCode, 'app', 'SELECT MenuKey FROM MenuAuth WHERE UserKey = @UserKey', {
      UserKey: userKey,
    });
    return rows.map((r) => r.MenuKey);
  }

  async menuAuth(tenantCode: string, userKey: number, companyCode: string, menuKey: number, authStatus: number): Promise<InsigRes> {
    await this.db.query(
      tenantCode,
      'app',
      `MERGE INTO MenuAuth AS target
       USING (SELECT @UserKey AS UserKey, @MenuKey AS MenuKey) AS source
       ON (target.UserKey = source.UserKey AND target.MenuKey = source.MenuKey)
       WHEN MATCHED THEN UPDATE SET AuthStatus = @AuthStatus
       WHEN NOT MATCHED THEN INSERT (UserKey, CompanyCode, MenuKey, AuthStatus) VALUES (@UserKey, @CompanyCode, @MenuKey, @AuthStatus);`,
      { UserKey: userKey, CompanyCode: companyCode, MenuKey: menuKey, AuthStatus: authStatus },
    );
    return { status: true, message: 'The data was successfully inserted' };
  }

  getUser(tenantCode: string, deviceCode: string, fcmToken: string) {
    return this.runProc(tenantCode, 'app', 'Userdetails', { DeviceCode: deviceCode, FcMToken: fcmToken });
  }

  async triggerOtp(tenantCode: string, deviceCode: string): Promise<InsigRes> {
    // Not Userdetails: that proc also overwrites the user's FCMToken.
    const [user] = await this.db.query<{ Email: string; UserName: string }>(
      tenantCode,
      'app',
      'SELECT TOP 1 Email, UserName FROM Users WHERE DeviceCode = @DeviceCode',
      { DeviceCode: deviceCode },
    );
    if (!user) {
      return { status: false, message: 'No data found' };
    }

    const otp = this.generateOtp();
    if (!(await this.email.sendOtp(user.Email, user.UserName, otp))) {
      return { status: false, message: 'Mail Not Send' };
    }

    return this.runProc(tenantCode, 'app', 'UpdateTimestamp', { DeviceCode: deviceCode, Email: user.Email, Otp: otp });
  }

  compareOtp(tenantCode: string, deviceCode: string, otp: string) {
    return this.runProc(tenantCode, 'app', 'CompareOTP', { DeviceCode: deviceCode, otp });
  }

  async sendCredentials(tenantCode: string, email: string): Promise<InsigRes> {
    const rows = await this.db.execProc<{ UserCode: string; Password: string }>(tenantCode, 'app', 'sendU_Credentials', { Email: email });
    const row = rows[0];
    if (!row) {
      return { status: false, message: 'No data found' };
    }
    if (!(await this.email.sendCredentials(email, row.UserCode, row.Password))) {
      return { status: false, message: 'Mail Not Send' };
    }
    return { status: true, message: 'Success', data: rows };
  }

  updatePassword(tenantCode: string, deviceCode: string, password: string) {
    return this.runProc(tenantCode, 'app', 'SetPassword', { DeviceCode: deviceCode, Password: password });
  }

  createUser(tenantCode: string, user: UserDetailsDto) {
    return this.runProc(tenantCode, 'app', 'CreateUser', {
      Branch: user.Branch,
      UserCode: user.UserCode,
      UserName: user.UserName,
      Password: user.Password,
      DeviceCode: user.DeviceCode,
      Email: user.Email,
      SapuserName: user.SapuserName,
      Sappassword: user.Sappassword,
      Sapurl: user.Sapurl,
      Active: user.Active,
      UserRoll: user.UserRoll,
      ReportTo: user.ReportTo,
      SapDB: user.SapDB,
      QueryUrl: user.QueryUrl,
      SlpCode: user.SlpCode,
    });
  }

  userDetailsForCrm(tenantCode: string) {
    return this.runProc(tenantCode, 'app', 'UserDetailsForCRM');
  }

  getReportingEmployees(tenantCode: string, id: number) {
    return this.runProc(tenantCode, 'app', 'GetReportingEmployees', { id });
  }

  postVersion(tenantCode: string, version: string, url: string, content: string) {
    return this.runProc(tenantCode, 'app', 'InsertVertion', { vertion: version, Url: url, Content: content });
  }

  getVersion(tenantCode: string) {
    return this.runProc(tenantCode, 'app', 'GetVertion');
  }

  getMessage(tenantCode: string, id: string) {
    return this.runProc(tenantCode, 'app', 'Nt_GetMsg', { Id: id });
  }

  async resetDeviceCode(tenantCode: string, deviceCode: string, userCode: string): Promise<{ status: boolean; msg: string }> {
    const rows = await this.db.execProc<{ Msg: string }>(tenantCode, 'app', 'BZ_ResetDevicecode', {
      DeviceCode: deviceCode,
      UserCode: userCode,
    });
    return rows.length > 0 ? { status: true, msg: rows[0].Msg } : { status: false, msg: 'unable to reset the device code' };
  }

  // ---- master data (read-only mirror of SAP's own tables) ----

  private readonly hasBrandField = new Map<string, boolean>();

  async itemMaster(tenantCode: string, whsCode: string) {
    let withBrand = this.hasBrandField.get(tenantCode.toUpperCase());
    if (withBrand === undefined) {
      const [col] = await this.db.query<{ len: number | null }>(tenantCode, 'sapDb', "SELECT COL_LENGTH('OITM', 'U_BRAND') AS len");
      withBrand = col?.len != null;
      this.hasBrandField.set(tenantCode.toUpperCase(), withBrand);
    }
    return this.runSapQuery(tenantCode, Q.ITEM_MASTER(withBrand), { whscode: whsCode });
  }

  customerMaster(tenantCode: string) {
    return this.runSapQuery(tenantCode, Q.CUSTOMER_MASTER);
  }

  addressMaster(tenantCode: string) {
    return this.runSapQuery(tenantCode, Q.ADDRESS_MASTER);
  }

  getFilteredItemsInStock(tenantCode: string, search?: string, mainGroup?: string, subGroup?: string, whsCode?: string) {
    return this.runSapQuery(tenantCode, Q.FILTERED_ITEMS_IN_STOCK, {
      Search: search ?? null,
      MainGroup: mainGroup ?? null,
      SubGroup: subGroup ?? null,
      WhsCode: whsCode ?? null,
    });
  }

  getFilteredItems(tenantCode: string, search?: string, mainGroup?: string, subGroup?: string, packSize?: string) {
    // The original GetItems proc treated '' and the string 'null' as "no filter".
    const orNull = (v?: string) => (v && v !== 'null' ? v : null);
    return this.runSapQuery(tenantCode, Q.ITEMS, {
      Search: orNull(search),
      MainGrp: orNull(mainGroup),
      SubGrp: orNull(subGroup),
      PackSize: orNull(packSize),
    });
  }

  getMainGroups(tenantCode: string) {
    return this.db
      .query(tenantCode, 'sapDb', 'SELECT * FROM [@PRDMAINGRP]')
      .then((rows) => (rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' }));
  }

  getSubGroups(tenantCode: string) {
    return this.db
      .query(tenantCode, 'sapDb', 'SELECT * FROM [@PRDSUBGRP]')
      .then((rows) => (rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' }));
  }

  getPlanDetails(tenantCode: string, date: string | undefined, slpCode: number) {
    return this.runSapQuery(tenantCode, Q.PLAN_DETAILS, { selecteddate: date ?? null, slpcode: slpCode });
  }

  getCustomerDetailsBySalesperson(tenantCode: string, slpCode: number) {
    return this.runProc(tenantCode, 'sapDb', 'BZ_CRM_GET_CUST_SLPCODE', { slpcode: slpCode });
  }

  getQuotationDetails(tenantCode: string, docEntry: number) {
    return this.runSapHeadLine(tenantCode, Q.QUOTATION_DETAILS, { docentry: docEntry });
  }

  getOrderDetails(tenantCode: string, docEntry: number) {
    return this.runSapHeadLine(tenantCode, Q.ORDER_DETAILS, { docentry: docEntry });
  }

  getDraftDetails(tenantCode: string, docEntry: number) {
    return this.runSapHeadLine(tenantCode, Q.DRAFT_DETAILS, { docentry: docEntry });
  }

  getQuotationHeadLine(tenantCode: string, docEntry: number) {
    return this.runSapHeadLine(tenantCode, Q.QUOTATION_FULL, { docentry: docEntry });
  }

  // ---- discount/scheme calculation (business logic lives entirely in SQL) ----

  discountCalcOrder(tenantCode: string, req: DiscountCalcRequest) {
    return this.runDiscountCalc(tenantCode, 'BZ_Scheme_Calculation_SaleOrder', req);
  }

  discountCalcOrderAbstract(tenantCode: string, req: DiscountCalcRequest) {
    return this.runDiscountCalc(tenantCode, 'BZ_Scheme_Calculation_SaleOrder_Abstract', req);
  }

  discountCalcQuotation(tenantCode: string, req: DiscountCalcRequest) {
    return this.runDiscountCalc(tenantCode, 'BZ_Scheme_Calculation_Quotation', req);
  }

  discountCalcQuotationAbstract(tenantCode: string, req: DiscountCalcRequest) {
    return this.runDiscountCalc(tenantCode, 'BZ_Scheme_Calculation_Quotation_Abstract', req);
  }

  // ---- SAP writes, via Service Layer (the old app used the Windows-only DI-API here) ----

  async createCustomer(sap: SapIdentity, model: BusinessPartnerRequest): Promise<InsigRes<{ CardCode: string }>> {
    const payload = {
      CardName: model.CardName,
      CardType: 'cCustomer',
      GroupCode: model.GroupCode,
      FederalTaxID: model.FederalTaxID,
      AdditionalID: model.AdditionalID,
      Territory: model.Territory,
      Cellular: model.Cellular,
      SalesPersonCode: model.SalesPersonCode,
      ContactPerson: model.ContactPerson,
      CreditLimit: model.CreditLimit,
      Notes: model.Notes,
      PayTermsGrpCode: model.PayTermsGrpCode,
      Series: model.Series,
      Valid: model.Valid ?? 'tYES',
      Frozen: model.Frozen ?? 'tNO',
      U_TinCer: model.U_TinCer,
      U_VatCer: model.U_VatCer,
      BPAddresses: (model.BPAddresses ?? []).map((a) => ({
        AddressName: a.AddressName,
        Street: a.Street,
        ZipCode: a.ZipCode,
        City: a.City,
        Country: a.Country,
        State: a.State,
        AddressType: a.AddressType,
        AddressName2: a.AddressName2,
        AddressName3: a.AddressName3,
      })),
      ContactEmployees: (model.ContactEmployees ?? []).map((c) => ({ Name: c.Name })),
    };

    const created = await this.sap.request<{ CardCode: string }>(sap, 'post', 'BusinessPartners', payload);
    return { status: true, message: 'Customer Created Successfully', data: created };
  }

  // SAP answers "No matching records found (-2028)" without saying which value it doesn't know. After such a
  // failure (only then, so working documents pay nothing) look up what the client sent and name the values this
  // company doesn't have. `objectCode`: '17' sales order, '23' quotation.
  private async postDocument(
    tenantCode: string,
    identity: SapIdentity,
    path: string,
    payload: Record<string, unknown>,
    refs: { objectCode: string; series?: number; cardCode?: string; salesPerson?: number; lines: { itemCode?: string; warehouse?: string; taxCode?: string }[] },
  ): Promise<{ created: { DocEntry: number; DocNum?: number }; draft: boolean }> {
    const ask = (sql: string, p: Record<string, unknown> = {}) => this.db.query<Record<string, unknown>>(tenantCode, 'sapDb', sql, p);
    const [last] = await ask('SELECT ISNULL(MAX(DocEntry), 0) AS n FROM ODRF');
    try {
      return { created: await this.sap.request<{ DocEntry: number }>(identity, 'post', path, payload), draft: false };
    } catch (err) {
      if (!String((err as Error).message).includes('-2028')) throw err;
      // When a document needs approval SAP saves it as a draft and the Service Layer still answers -2028 (it cannot
      // read back an order that does not exist yet). The draft is real: find the one just created by this account.
      const [draft] = await ask(
        'SELECT TOP 1 D.DocEntry, D.DocNum FROM ODRF D INNER JOIN OUSR U ON U.USERID = D.UserSign WHERE D.DocEntry > @after AND D.ObjType = @type AND D.CardCode = @card AND U.USER_CODE = @user ORDER BY D.DocEntry DESC',
        { after: last?.n ?? 0, type: refs.objectCode, card: refs.cardCode, user: identity.sapUsername.trim() },
      );
      if (draft) return { created: { DocEntry: Number(draft.DocEntry), DocNum: Number(draft.DocNum) }, draft: true };
      const missing: string[] = [];
      const check = async (label: string, value: unknown, sql: string, valid?: { sql: string; fmt: (r: Record<string, unknown>) => string }) => {
        if (value === undefined || value === null || value === '' || (await ask(sql, { v: value })).length > 0) return;
        const options = valid ? ` (valid: ${(await ask(valid.sql)).map(valid.fmt).join(', ') || 'none'})` : '';
        missing.push(`${label} ${value}${options}`);
      };
      await check('Series', refs.series, `SELECT 1 FROM NNM1 WHERE Series = @v AND ObjectCode = '${refs.objectCode}'`, {
        sql: `SELECT Series, SeriesName FROM NNM1 WHERE ObjectCode = '${refs.objectCode}'`,
        fmt: (r) => `${r.Series}=${r.SeriesName}`,
      });
      await check('CardCode', refs.cardCode, 'SELECT 1 FROM OCRD WHERE CardCode = @v');
      await check('SalesPersonCode', refs.salesPerson, 'SELECT 1 FROM OSLP WHERE SlpCode = @v');
      for (const item of new Set(refs.lines.map((l) => l.itemCode))) await check('ItemCode', item, 'SELECT 1 FROM OITM WHERE ItemCode = @v');
      for (const whs of new Set(refs.lines.map((l) => l.warehouse))) await check('WarehouseCode', whs, 'SELECT 1 FROM OWHS WHERE WhsCode = @v');
      for (const tax of new Set(refs.lines.map((l) => l.taxCode))) {
        await check('TaxCode', tax, "SELECT 1 FROM OVTG WHERE Code = @v AND Category = 'O'", {
          sql: "SELECT Code FROM OVTG WHERE Category = 'O' AND Inactive = 'N'",
          fmt: (r) => String(r.Code),
        });
      }
      if (missing.length === 0) throw err;
      throw new BadRequestException(`SAP rejected the document - not found in this company: ${missing.join('; ')}`);
    }
  }

  async createQuotation(sap: SapIdentity, request: QuotationRequest, tenantCode: string): Promise<InsigRes<{ DocEntry: number; DocNum?: number; IsDraft?: boolean }>> {
    const payload = {
      CardCode: request.CardCode,
      CardName: request.CardName || undefined,
      DocDate: request.DocDate,
      DocDueDate: request.DocDueDate,
      TaxDate: request.TaxDate,
      Comments: request.Comments,
      SalesPersonCode: request.SalesPersonCode,
      NumAtCard: request.NumAtCard || undefined,
      U_DeviceTransID: request.U_DeviceTransID || undefined,
      AddressExtension: request.AddressExtension,
      DocumentLines: request.DocumentLines.map((line) => ({
        ItemCode: line.ItemCode,
        ItemDescription: line.ItemDescription,
        DiscountPercent: line.DiscountPercent,
        Quantity: line.Quantity,
        Price: line.UnitPrice && line.UnitPrice > 0 ? line.UnitPrice : undefined,
        WarehouseCode: line.WarehouseCode,
        VatGroup: line.TaxCode, // Service Layer ignores TaxCode on lines; VatGroup is the tax field
        Currency: line.Currency,
      })),
    };

    const { created, draft } = await this.postDocument(tenantCode, sap, 'Quotations', payload, {
      objectCode: '23',
      cardCode: request.CardCode,
      salesPerson: request.SalesPersonCode,
      lines: request.DocumentLines.map((l) => ({ itemCode: l.ItemCode, warehouse: l.WarehouseCode, taxCode: l.TaxCode })),
    });
    return draft
      ? { status: true, message: 'Quotation needs approval. Hence saved as Draft!!!', data: { ...created, IsDraft: true } }
      : { status: true, message: 'Quotation Created sucessfully', data: created };
  }

  async updateQuotation(sap: SapIdentity, docEntry: number, request: QuotationRequest): Promise<InsigRes> {
    const payload = {
      CardName: request.CardName || undefined,
      DocDate: request.DocDate,
      DocDueDate: request.DocDueDate,
      TaxDate: request.TaxDate,
      Comments: request.Comments,
      SalesPersonCode: request.SalesPersonCode,
      NumAtCard: request.NumAtCard || undefined,
      U_DeviceTransID: request.U_DeviceTransID || undefined,
      AddressExtension: request.AddressExtension,
      // Service Layer replaces DocumentLines wholesale on PATCH - matches the
      // legacy delete-then-readd loop over the DI-API Lines collection.
      DocumentLines: request.DocumentLines.map((line) => ({
        ItemCode: line.ItemCode,
        ItemDescription: line.ItemDescription,
        Quantity: line.Quantity,
        Price: line.UnitPrice && line.UnitPrice > 0 ? line.UnitPrice : undefined,
        DiscountPercent: line.DiscountPercent,
        WarehouseCode: line.WarehouseCode,
        VatGroup: line.TaxCode, // Service Layer ignores TaxCode on lines; VatGroup is the tax field
        Currency: line.Currency,
      })),
    };

    await this.sap.request(sap, 'patch', `Quotations(${docEntry})`, payload);
    return { status: true, message: 'Quotation Updated Successfully' };
  }

  // Which approval (if any) an order needs: runs the shop's BZ_CRM_CHeckApproval proc, which returns the SAP
  // account the order must be created under (credit limit, credit days, cash, NC products...) and a message.
  // The account's password comes from the DB and never leaves the server. Fails closed: a failing check
  // stops the order (only "this shop has no such proc" - e.g. Zambia - skips it).
  private async checkApproval(tenantCode: string, model: SalesOrderModel): Promise<{ sapUser: string; sapPassword: string; message: string } | null> {
    const lines: { itemCode: string; warehouse: string; qty: number; price: number; net: number; rate: number }[] = [];
    for (const line of model.DocumentLines) {
      if (line.BaseEntry && line.BaseEntry > 0) {
        // a line copied from a quotation: its item, price, discount and tax come from that quotation line
        const [q] = await this.db.query<{ ItemCode: string; WhsCode: string; Price: number; DiscPrcnt: number; VatPrcnt: number }>(
          tenantCode,
          'sapDb',
          'SELECT ItemCode, WhsCode, Price, DiscPrcnt, VatPrcnt FROM QUT1 WHERE DocEntry = @DocEntry AND LineNum = @LineNum',
          { DocEntry: line.BaseEntry, LineNum: line.BaseLine ?? 0 },
        );
        if (q) {
          lines.push({ itemCode: q.ItemCode, warehouse: line.WarehouseCode || q.WhsCode, qty: line.Quantity, price: q.Price, net: line.Quantity * q.Price * (1 - (q.DiscPrcnt ?? 0) / 100), rate: q.VatPrcnt ?? 0 });
        }
      } else {
        const [tax] = line.TaxCode ? await this.db.query<{ Rate: number }>(tenantCode, 'sapDb', 'SELECT Rate FROM OVTG WHERE Code = @Code', { Code: line.TaxCode }) : [];
        const price = line.UnitPrice ?? 0;
        lines.push({ itemCode: line.ItemCode ?? '', warehouse: line.WarehouseCode ?? '', qty: line.Quantity, price, net: line.Quantity * price * (1 - (line.DiscountPercent ?? 0) / 100), rate: tax?.Rate ?? 0 });
      }
    }
    // Worked out here, never taken from the request: a client-supplied total could dodge the credit-limit check.
    const docTotal = Math.round(lines.reduce((sum, l) => sum + l.net * (1 + l.rate / 100), 0) * 100) / 100;
    const xml = buildDataSetXml(
      'SCHEMES',
      lines.map((l, i) => ({ LineNum: i + 1, ItemCode: l.itemCode, Quantity: l.qty, PriceBefDi: l.price, U_Cartons: 0, Balance: 0, Customer: model.CardCode, Warehouse: l.warehouse })),
      'DocumentElements',
    );

    let rows: { SAPName?: string | null; SAPPassword?: string | null; RespMessage?: string | null }[];
    try {
      rows = await this.db.execProc(tenantCode, 'sapDb', 'BZ_CRM_CHeckApproval', { CardCode: model.CardCode, DocTotal: docTotal, xml });
    } catch (err) {
      if ((err as { number?: number }).number === 2812) return null; // no approval procedure in this shop's SAP DB
      throw err;
    }
    const r = rows?.[0];
    return r?.SAPName && r.SAPPassword ? { sapUser: r.SAPName, sapPassword: r.SAPPassword, message: r.RespMessage || 'Sales Order Created' } : null;
  }

  async createSalesOrder(sap: SapIdentity, model: SalesOrderModel, tenantCode: string): Promise<InsigRes<{ DocEntry: number; DocNum?: number; IsDraft?: boolean }>> {
    const approval = await this.checkApproval(tenantCode, model);
    // Created under the approval account when one is required, so SAP routes it to the right approver.
    const acting: SapIdentity = approval ? { ...sap, sapUsername: approval.sapUser, sapPassword: approval.sapPassword } : sap;
    const payload = {
      CardCode: model.CardCode,
      CardName: model.CardName,
      DocDate: model.DocDate,
      DocDueDate: model.DocDueDate,
      Comments: model.Comments,
      NumAtCard: model.NumAtCard,
      SalesPersonCode: model.SalesPersonCode,
      Series: model.Series,
      U_OrderDate: model.U_OrderDate,
      U_Order_Type: model.U_Order_Type,
      U_GP_Approval: model.U_GP_Approval,
      U_Received_Time: model.U_Received_Time,
      U_DeviceCode: model.U_DeviceCode,
      U_DeviceTransID: model.U_DeviceTransID,
      U_latitude: model.U_latitude,
      U_longitude: model.U_longitude,
      DocumentLines: model.DocumentLines.map((line) =>
        line.BaseEntry && line.BaseEntry > 0
          ? {
              BaseType: 23, // oQuotations
              BaseEntry: line.BaseEntry,
              BaseLine: line.BaseLine,
              Quantity: line.Quantity,
              WarehouseCode: line.WarehouseCode || undefined,
            }
          : {
              ItemCode: line.ItemCode,
              ItemDescription: line.ItemDescription,
              Quantity: line.Quantity,
              UnitPrice: line.UnitPrice,
              DiscountPercent: line.DiscountPercent,
              VatGroup: line.TaxCode,
              ShipDate: line.ShipDate,
              WarehouseCode: line.WarehouseCode,
              Currency: line.Currency,
            },
      ),
    };

    const { created, draft } = await this.postDocument(tenantCode, acting, 'Orders', payload, {
      objectCode: '17',
      series: model.Series,
      cardCode: model.CardCode,
      salesPerson: model.SalesPersonCode,
      // lines copied from a quotation carry no item/tax of their own
      lines: model.DocumentLines.filter((l) => !(l.BaseEntry && l.BaseEntry > 0)).map((l) => ({ itemCode: l.ItemCode, warehouse: l.WarehouseCode, taxCode: l.TaxCode })),
    });
    return {
      status: true,
      message: approval?.message ?? (draft ? 'Document needs approval. Hence saved as Draft!!!' : 'Sales Order Created'),
      data: draft ? { ...created, IsDraft: true } : created,
    };
  }

  async saveDraftAsDocument(sap: SapIdentity, docEntry: number): Promise<InsigRes> {
    // Service Layer's equivalent of the DI-API's Documents.SaveDraftToDocument().
    await this.sap.request(sap, 'post', `Drafts(${docEntry})/DraftToDocument`, {});
    return { status: true, message: 'order saved Successfully' };
  }

  async createActivity(sap: SapIdentity, active: ActivitesDTO): Promise<InsigRes<{ ClgCode: number }>> {
    const payload = {
      CardCode: active.CardCode,
      Details: active.Details,
      Activity: 'cn_Meeting',
      Subject: active.Subject,
      SalesEmployee: active.SalesEmployee,
      StartDate: active.U_PlanDate,
      StartTime: active.U_PlanTime,
      U_PlanDate: active.U_PlanDate,
      U_PlanTime: active.U_PlanTime,
      U_Status: active.U_Status,
    };
    const created = await this.sap.request<{ ClgCode: number }>(sap, 'post', 'Activities', payload);
    return { status: true, message: 'Activity Created sucessfully', data: created };
  }

  async updateActivity(sap: SapIdentity, clgCode: number, activity: ActivitesDTO): Promise<InsigRes> {
    const payload = {
      Details: activity.Details,
      Activity: 'cn_Meeting',
      Subject: activity.Subject,
      SalesEmployee: activity.SalesEmployee,
      StartDate: activity.U_PlanDate,
      StartTime: activity.U_PlanTime,
      U_PlanDate: activity.U_PlanDate,
      U_PlanTime: activity.U_PlanTime,
      U_Status: activity.U_Status,
    };
    await this.sap.request(sap, 'patch', `Activities(${clgCode})`, payload);
    return { status: true, message: 'Activity Updated sucessfully' };
  }

  async checkIn(sap: SapIdentity, clgCode: number, request: CheckedInDTO): Promise<InsigRes> {
    const payload = {
      StartDate: request.StartDate,
      StartTime: request.StartTime,
      U_Latitude: request.U_Latitude,
      U_Longitude: request.U_Longitude,
      U_CheckedIn: request.U_CheckedIn,
      U_CheckinAdd: request.U_CheckinAdd,
    };
    await this.sap.request(sap, 'patch', `Activities(${clgCode})`, payload);
    return { status: true, message: 'success' };
  }

  async checkOut(sap: SapIdentity, clgCode: number, request: CheckedoutDTO): Promise<InsigRes> {
    const payload = {
      Notes: request.Notes,
      Closed: 'tYES',
      CloseDate: request.CloseDate,
      EndTime: request.EndTime,
      Duration: request.Duration,
      U_OrdProsValue: request.U_OrdProsValue ?? 0,
      U_PymntVal: request.U_PymntVal ?? 0,
      U_Complaints: request.U_Complaints ?? '',
      U_Remarks1: request.U_Remarks1 ?? '',
      U_Remarks2: request.U_Remarks2 ?? '',
      U_COLatitude: request.U_COLatitude ?? '',
      U_COLongitude: request.U_COLongitude ?? '',
      U_CheckOutAdd: request.U_CheckOutAdd ?? '',
      U_Link1: request.U_Link1 ?? '',
      U_Link2: request.U_Link2 ?? '',
      U_Link3: request.U_Link3 ?? '',
      U_Link4: request.U_Link4 ?? '',
      U_Products: request.U_Products ?? '',
      U_BrandContr: request.U_BrandContr ?? '',
      U_PPComp: request.U_PPComp ?? '',
      U_BrandinPromo: request.U_BrandinPromo ?? '',
      U_Advertise: request.U_Advertise ?? '',
      U_AdvFormt: request.U_AdvFormt ?? '',
      U_NxtFollowup: request.U_NxtFollowup,
      U_Status: request.U_Status ?? '',
      U_Project: request.U_Project ?? '',
      U_Customer: request.U_Customer ?? '',
      U_Consultant: request.U_Consultant ?? '',
      U_Subgroup: request.U_Subgroup ?? '',
      U_CheckedIn: request.U_CheckedIn ?? '',
    };
    await this.sap.request(sap, 'patch', `Activities(${clgCode})`, payload);
    return { status: true, message: 'success' };
  }

  async getQuotation(sap: SapIdentity, docEntry: number) {
    return this.sap.request(sap, 'get', `Quotations(${docEntry})`);
  }
}
