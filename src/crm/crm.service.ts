import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { EmailService } from './email.service.js';
import { buildDataSetXml } from './dataset-xml.util.js';
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

  private async runProcHeadLine(
    tenantCode: string,
    kind: DbKind,
    proc: string,
    params: Record<string, unknown>,
  ): Promise<HeadLineResult> {
    const [head, line] = await this.db.execProcSets(tenantCode, kind, proc, params);
    if (!head?.length && !line?.length) {
      return { respType: 'No data found.', respCode: '500' };
    }
    return { respType: 'Success', respCode: '200', data: { Head: head ?? [], Line: line ?? [] } };
  }

  private async runDiscountCalc(tenantCode: string, proc: string, req: DiscountCalcRequest) {
    const xml = buildDataSetXml('SCHEMES', req.SCHEMES as unknown as Record<string, unknown>[]);
    const rows = await this.db.execProc(tenantCode, 'sapDb', proc, { xml, mode: 1 });
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
    const [user] = await this.db.execProc<{ Email: string; UserName: string }>(tenantCode, 'app', 'Userdetails', {
      DeviceCode: deviceCode,
    });
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

  async getCountry(tenantCode: string, countryName: string) {
    const rows = await this.db.query(tenantCode, 'app', 'SELECT * FROM CountryMaster WHERE CountryName = @CountryName', {
      CountryName: countryName,
    });
    return rows.length > 0 ? { status: true, message: 'Success', country: rows[0] } : { status: false, message: 'No Data Found' };
  }

  // ---- master data (read-only mirror of SAP's own tables) ----

  itemMaster(tenantCode: string) {
    return this.runProc(tenantCode, 'sapDb', 'BZ_POS_ItemMaster');
  }

  customerMaster(tenantCode: string) {
    return this.runProc(tenantCode, 'sapDb', 'BZ_POS_CustomerMaster');
  }

  addressMaster(tenantCode: string) {
    return this.runProc(tenantCode, 'sapDb', 'BZ_POS_AddressMaster');
  }

  getFilteredItemsInStock(tenantCode: string, search?: string, mainGroup?: string, subGroup?: string, whsCode?: string) {
    return this.runProc(tenantCode, 'sapDb', 'GetFilteredItemsInstock', {
      Search: search ?? null,
      MainGroup: mainGroup ?? null,
      SubGroup: subGroup ?? null,
      WhsCode: whsCode ?? null,
    });
  }

  getFilteredItems(tenantCode: string, search?: string, mainGroup?: string, subGroup?: string, packSize?: string) {
    return this.runProc(tenantCode, 'sapDb', 'GetItems', {
      Search: search ?? null,
      MainGroup: mainGroup ?? null,
      SubGroup: subGroup ?? null,
      PackSize: packSize ?? null,
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
    return this.runProc(tenantCode, 'sapDb', 'GetPlanDetails', { date: date ?? null, slpcode: slpCode });
  }

  getCustomerDetailsBySalesperson(tenantCode: string, slpCode: number) {
    return this.runProc(tenantCode, 'sapDb', 'BZ_CRM_GET_CUST_SLPCODE', { slpcode: slpCode });
  }

  getQuotationDetails(tenantCode: string, docEntry: number) {
    return this.runProcHeadLine(tenantCode, 'sapDb', 'GetQuotationDetails', { docentry: docEntry });
  }

  getOrderDetails(tenantCode: string, docEntry: number) {
    return this.runProcHeadLine(tenantCode, 'sapDb', 'GetOrderDetails', { docentry: docEntry });
  }

  getDraftDetails(tenantCode: string, docEntry: number) {
    return this.runProcHeadLine(tenantCode, 'sapDb', 'GetDraftDetails', { docentry: docEntry });
  }

  getQuotationHeadLine(tenantCode: string, docEntry: number) {
    return this.runProcHeadLine(tenantCode, 'sapDb', 'sp_GetQuotation', { docentry: docEntry });
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

  async createQuotation(sap: SapIdentity, request: QuotationRequest): Promise<InsigRes<{ DocEntry: number }>> {
    const payload = {
      CardCode: request.CardCode,
      DocDate: request.DocDate,
      DocDueDate: request.DocDueDate,
      TaxDate: request.TaxDate,
      Comments: request.Comments,
      SalesPersonCode: request.SalesPersonCode,
      Series: request.series,
      NumAtCard: request.NumAtCard || undefined,
      DiscountPercent: request.DiscountPercent && request.DiscountPercent > 0 ? request.DiscountPercent : undefined,
      U_DeviceTransID: request.U_DeviceTransID || undefined,
      AddressExtension: request.AddressExtension,
      DocumentLines: request.DocumentLines.map((line) => ({
        ItemCode: line.ItemCode,
        ItemDescription: line.ItemDescription,
        DiscountPercent: line.DiscountPercent,
        Quantity: line.Quantity,
        Price: line.UnitPrice && line.UnitPrice > 0 ? line.UnitPrice : undefined,
        WarehouseCode: line.WarehouseCode,
        TaxCode: line.TaxCode,
        Currency: line.Currency,
      })),
    };

    const created = await this.sap.request<{ DocEntry: number }>(sap, 'post', 'Quotations', payload);
    return { status: true, message: 'Quotation Created sucessfully', data: created };
  }

  async updateQuotation(sap: SapIdentity, docEntry: number, request: QuotationRequest): Promise<InsigRes> {
    const payload = {
      DocDate: request.DocDate,
      DocDueDate: request.DocDueDate,
      TaxDate: request.TaxDate,
      Comments: request.Comments,
      SalesPersonCode: request.SalesPersonCode,
      NumAtCard: request.NumAtCard || undefined,
      DiscountPercent: request.DiscountPercent && request.DiscountPercent > 0 ? request.DiscountPercent : undefined,
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
        TaxCode: line.TaxCode,
        Currency: line.Currency,
      })),
    };

    await this.sap.request(sap, 'patch', `Quotations(${docEntry})`, payload);
    return { status: true, message: 'Quotation Updated Successfully' };
  }

  async createSalesOrder(sap: SapIdentity, model: SalesOrderModel): Promise<InsigRes<{ DocEntry: number }>> {
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
              TaxCode: line.TaxCode,
              ShipDate: line.ShipDate,
              WarehouseCode: line.WarehouseCode,
              Currency: line.Currency,
            },
      ),
    };

    const created = await this.sap.request<{ DocEntry: number }>(sap, 'post', 'Orders', payload);
    return { status: true, message: 'Sales Order Created', data: created };
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
