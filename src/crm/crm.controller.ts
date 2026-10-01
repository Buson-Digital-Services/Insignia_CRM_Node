import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { CrmService } from './crm.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ShopCode, int } from '../tenant/shop-code.decorator.js';
import type { AuthenticatedRequestUser } from '../common/types.js';
import {
  ActivitesDTO,
  BusinessPartnerRequest,
  CheckedInDTO,
  CheckedoutDTO,
  DiscountCalcRequest,
  MenuAuthDto,
  PostVersionDto,
  QuotationRequest,
  ResetDeviceCodeDto,
  SalesOrderModel,
  UserDetailsDto,
} from './dto/crm.dto.js';

// Route names, methods and parameter positions are the legacy .NET CRMController's
// (C:\Workspace\CRM - TEST\Server\Controllers\CRMController.cs), so the existing frontend
// works unchanged under {localURL}. Differences from the legacy API, all deliberate:
// - data/SAP routes need the login JWT; the legacy `sapuser` query parameter is ignored
//   (the SAP session comes from the token, not from a name in the URL);
// - pre-login routes take the shop from the localURL they are called under (@ShopCode);
// - query names are matched case-insensitively (main.ts lower-cases them), like ASP.NET.
const UPLOAD_DIR = join(process.cwd(), 'uploads');

@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // ---- pre-login / account recovery (no token yet) ----

  @Get('Getmenus')
  listOfMenus(@ShopCode() shop: string) {
    return this.crm.listOfMenus(shop);
  }

  @Get('GetSelectedId/:userkey')
  getUserMenuIds(@ShopCode() shop: string, @Param('userkey') userKey: string) {
    return this.crm.getUserMenuIds(shop, int('userkey', userKey));
  }

  @Get('GetUserDetails/:Devicecode/:FcMToken')
  getUser(@ShopCode() shop: string, @Param('Devicecode') deviceCode: string, @Param('FcMToken') fcmToken: string) {
    return this.crm.getUser(shop, deviceCode, fcmToken);
  }

  @Get('ResetPassword/:Devicecode')
  triggerOtp(@ShopCode() shop: string, @Param('Devicecode') deviceCode: string) {
    return this.crm.triggerOtp(shop, deviceCode);
  }

  @Get('CompareOTP/:Devicecode/:otp')
  compareOtp(@ShopCode() shop: string, @Param('Devicecode') deviceCode: string, @Param('otp') otp: string) {
    return this.crm.compareOtp(shop, deviceCode, otp);
  }

  @Get('SendMail/:Mail')
  sendCredentials(@ShopCode() shop: string, @Param('Mail') email: string) {
    return this.crm.sendCredentials(shop, email);
  }

  @Get('Updatepsw/:Devicecode/:Password')
  updatePassword(@ShopCode() shop: string, @Param('Devicecode') deviceCode: string, @Param('Password') password: string) {
    return this.crm.updatePassword(shop, deviceCode, password);
  }

  @Post('CreateUser')

  @HttpCode(200)
  createUser(@ShopCode() shop: string, @Body() body: UserDetailsDto) {
    return this.crm.createUser(shop, body);
  }

  @Post('Savedata')

  @HttpCode(200)
  menuAuth(@ShopCode() shop: string, @Body() body: MenuAuthDto) {
    return this.crm.menuAuth(shop, body.UserKey, body.CompanyCode, body.MenuKey, body.AuthStatus);
  }

  @Post('PostVertion')

  @HttpCode(200)
  postVersion(@ShopCode() shop: string, @Body() body: PostVersionDto) {
    return this.crm.postVersion(shop, body.vertion, body.Url, body.Content);
  }

  @Get('GetVertion')
  getVersion(@ShopCode() shop: string) {
    return this.crm.getVersion(shop);
  }

  @Get('GetMsg/:Id')
  getMessage(@ShopCode() shop: string, @Param('Id') id: string) {
    return this.crm.getMessage(shop, id);
  }

  @Post('ResetDevicecode')

  @HttpCode(200)
  resetDeviceCode(@ShopCode() shop: string, @Body() body: ResetDeviceCodeDto) {
    return this.crm.resetDeviceCode(shop, body.DeviceCode, body.UserCode);
  }

  // ---- needs the login JWT (shop + the caller's own SAP session) ----

  @UseGuards(JwtAuthGuard)
  @Get('UserDetailsForCRM')
  userDetailsForCrm(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.userDetailsForCrm(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetReportingEmplyoees/:Id')
  getReportingEmployees(@CurrentUser() user: AuthenticatedRequestUser, @Param('Id') id: string) {
    return this.crm.getReportingEmployees(user.tenantCode, int('Id', id));
  }

  // Legacy took no parameter (it read a fixed DB); batch stock is per warehouse, so whscode is required.
  @UseGuards(JwtAuthGuard)
  @Get('ItemMaster')
  @ApiQuery({ name: 'whscode', required: true })
  itemMaster(@CurrentUser() user: AuthenticatedRequestUser, @Query('whscode') whsCode: string) {
    if (!whsCode) {
      throw new BadRequestException('whscode is required');
    }
    return this.crm.itemMaster(user.tenantCode, whsCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('CustomerMaster')
  customerMaster(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.customerMaster(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('AddressMaster')
  addressMaster(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.addressMaster(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetFilteredItemsInstock')
  getFilteredItemsInStock(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query('search') search?: string,
    @Query('maingroup') mainGroup?: string,
    @Query('subgroup') subGroup?: string,
    @Query('whscode') whsCode?: string,
  ) {
    return this.crm.getFilteredItemsInStock(user.tenantCode, search, mainGroup, subGroup, whsCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetFilteredItems')
  getFilteredItems(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query('search') search?: string,
    @Query('maingroup') mainGroup?: string,
    @Query('subgroup') subGroup?: string,
    @Query('packsize') packSize?: string,
  ) {
    return this.crm.getFilteredItems(user.tenantCode, search, mainGroup, subGroup, packSize);
  }

  @UseGuards(JwtAuthGuard)
  @Get('Getmaingroup')
  getMainGroups(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.getMainGroups(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetSubgroup')
  getSubGroups(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.getSubGroups(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetPlanDetails')
  @ApiQuery({ name: 'date', required: false, type: String, format: 'date', description: 'Defaults to today' })
  getPlanDetails(@CurrentUser() user: AuthenticatedRequestUser, @Query('date') date: string | undefined, @Query('slpcode') slpCode: string) {
    return this.crm.getPlanDetails(user.tenantCode, date, int('slpcode', slpCode));
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetCustomerDetails')
  getCustomerDetailsBySalesperson(@CurrentUser() user: AuthenticatedRequestUser, @Query('slpcode') slpCode: string) {
    return this.crm.getCustomerDetailsBySalesperson(user.tenantCode, int('slpcode', slpCode));
  }

  // Legacy GetQuotation ran sp_GetQuotation (header + lines from the SAP DB).
  @UseGuards(JwtAuthGuard)
  @Get('GetQuotation')
  getQuotationHeadLine(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.getQuotationHeadLine(user.tenantCode, int('docentry', docEntry));
  }

  // Legacy QuotationbyDocentry fetched one hardcoded quotation from the Service Layer; this takes ?docentry=.
  @UseGuards(JwtAuthGuard)
  @Get('QuotationbyDocentry')
  getQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.getQuotation(user.sap, int('docentry', docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetQuotationDetails')
  getQuotationDetails(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.getQuotationDetails(user.tenantCode, int('docentry', docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetOrderDetails')
  getOrderDetails(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.getOrderDetails(user.tenantCode, int('docentry', docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('GetDraftDetails')
  getDraftDetails(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.getDraftDetails(user.tenantCode, int('docentry', docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Post('SaveDraftDetails')
  @HttpCode(200)
  saveDraft(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string) {
    return this.crm.saveDraftAsDocument(user.sap, int('docentry', docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Post('DisCalculation_Order')
  @HttpCode(200)
  discountCalcOrder(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcOrder(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('DisCalculation_Order_Abstract')
  @HttpCode(200)
  discountCalcOrderAbstract(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcOrderAbstract(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('DisCalculation_Quo')
  @HttpCode(200)
  discountCalcQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcQuotation(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('DisCalculation_Quo_Abstract')
  @HttpCode(200)
  discountCalcQuotationAbstract(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcQuotationAbstract(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CreateCustomer')
  @HttpCode(200)
  createCustomer(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: BusinessPartnerRequest) {
    return this.crm.createCustomer(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CreateQuotation')
  @HttpCode(200)
  createQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: QuotationRequest) {
    return this.crm.createQuotation(user.sap, body, user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('UpdateQuotation')
  @HttpCode(200)
  updateQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Query('docentry') docEntry: string, @Body() body: QuotationRequest) {
    return this.crm.updateQuotation(user.sap, int('docentry', docEntry), body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CreateSalesOrder')
  @HttpCode(200)
  @ApiBody({
    type: SalesOrderModel,
    examples: {
      frontend: {
        summary: 'Request as the frontend sends it (numbers may be sent as text)',
        value: {
          CardCode: 'D11137',
          CardName: 'INSIGNIA AFRICA LTD - UGANDA',
          Comments: 'new order',
          DocDate: '2026-09-30',
          DocDueDate: '2026-09-30',
          DocumentLines: [
            {
              BaseEntry: 0,
              Currency: 'TZS',
              DiscountPercent: '0.00',
              ItemCode: '10101W001A',
              ItemDescription: 'ALKALI RESISTING PRIMER (WB) WHITE - 20 LT',
              Quantity: '12.00',
              ShipDate: '2026-09-30',
              TaxCode: '01',
              UnitPrice: '2000.00',
              WarehouseCode: 'KEFG',
            },
          ],
          DocumentStatus: 'bost_Open',
          NumAtCard: 'TESTERSSS',
          SalesPersonCode: '1',
          Series: '1506',
          U_DeviceCode: '',
          U_DeviceTransID: '360805f7-2b07-4f9b-8b10-6d339d38c9ba',
          U_GP_Approval: '1',
          U_latitude: '11.014084242162879',
          U_longitude: '76.96248024382152',
          U_Order_Type: '1',
          U_OrderDate: '2026-09-30',
          U_Received_Time: '15:51',
        },
      },
    },
  })
  createSalesOrder(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: SalesOrderModel) {
    return this.crm.createSalesOrder(user.sap, body, user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CreateActivities')
  @HttpCode(200)
  createActivity(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: ActivitesDTO) {
    return this.crm.createActivity(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('UpdateActivity')
  @HttpCode(200)
  updateActivity(@CurrentUser() user: AuthenticatedRequestUser, @Query('clgcode') clgCode: string, @Body() body: ActivitesDTO) {
    return this.crm.updateActivity(user.sap, int('clgcode', clgCode), body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CheckIn')
  @HttpCode(200)
  checkIn(@CurrentUser() user: AuthenticatedRequestUser, @Query('clgcode') clgCode: string, @Body() body: CheckedInDTO) {
    return this.crm.checkIn(user.sap, int('clgcode', clgCode), body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('CheckOut')
  @HttpCode(200)
  checkOut(@CurrentUser() user: AuthenticatedRequestUser, @Query('clgcode') clgCode: string, @Body() body: CheckedoutDTO) {
    return this.crm.checkOut(user.sap, int('clgcode', clgCode), body);
  }

  // Legacy SaveToPhysicalLocation took JSON bytes plus a server path chosen by the client
  // (an arbitrary-file-write hole). Same route, but a normal multipart upload into uploads/.
  @UseGuards(JwtAuthGuard)
  @Post('SaveToPhysicalLocation')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  saveFile(@UploadedFiles() files: Express.Multer.File[]) {
    return { status: true, message: 'Success', data: { path: files?.[0]?.path } };
  }
}
