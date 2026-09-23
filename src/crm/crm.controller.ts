import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { CrmService } from './crm.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequestUser } from '../common/types.js';
import {
  ActivitesDTO,
  BusinessPartnerRequest,
  CheckedInDTO,
  CheckedoutDTO,
  CreateUserBody,
  DiscountCalcRequest,
  MenuAuthDto,
  PostVersionDto,
  QuotationRequest,
  ResetDeviceCodeDto,
  SalesOrderModel,
  UpdatePasswordDto,
} from './dto/crm.dto.js';

// Routes below are split into two groups:
// - Public (no @UseGuards): account-recovery/pre-login flows that run before a
//   JWT exists, so they take `tenantCode` explicitly instead of reading it off
//   a token. Mirrors what the legacy CRMController left unauthenticated.
// - Guarded: everything that needs the caller's own SAP identity, or touches
//   real business data - pulled from the JWT via @CurrentUser(), same as /crm/connect.
const UPLOAD_DIR = join(process.cwd(), 'uploads');

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @UseGuards(JwtAuthGuard)
  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  saveFile(@UploadedFile() file: Express.Multer.File) {
    return { status: true, message: 'Success', data: { path: file.path } };
  }

  // ---- pre-login / account recovery ----

  @Get('menus')
  listOfMenus(@Query('tenantCode') tenantCode: string) {
    return this.crm.listOfMenus(tenantCode);
  }

  @Get('users/:deviceCode/:fcmToken')
  getUser(@Query('tenantCode') tenantCode: string, @Param('deviceCode') deviceCode: string, @Param('fcmToken') fcmToken: string) {
    return this.crm.getUser(tenantCode, deviceCode, fcmToken);
  }

  @Get('otp/trigger/:deviceCode')
  triggerOtp(@Query('tenantCode') tenantCode: string, @Param('deviceCode') deviceCode: string) {
    return this.crm.triggerOtp(tenantCode, deviceCode);
  }

  @Get('otp/compare/:deviceCode/:otp')
  compareOtp(@Query('tenantCode') tenantCode: string, @Param('deviceCode') deviceCode: string, @Param('otp') otp: string) {
    return this.crm.compareOtp(tenantCode, deviceCode, otp);
  }

  @Get('credentials/:email')
  sendCredentials(@Query('tenantCode') tenantCode: string, @Param('email') email: string) {
    return this.crm.sendCredentials(tenantCode, email);
  }

  @Post('password')
  updatePassword(@Body() body: UpdatePasswordDto) {
    return this.crm.updatePassword(body.tenantCode, body.deviceCode, body.password);
  }

  @Post('users')
  createUser(@Body() body: CreateUserBody) {
    return this.crm.createUser(body.tenantCode, body);
  }

  @Post('device-code/reset')
  resetDeviceCode(@Body() body: ResetDeviceCodeDto) {
    return this.crm.resetDeviceCode(body.tenantCode, body.deviceCode, body.userCode);
  }

  @Get('versions')
  getVersion(@Query('tenantCode') tenantCode: string) {
    return this.crm.getVersion(tenantCode);
  }

  @Post('versions')
  postVersion(@Body() body: PostVersionDto) {
    return this.crm.postVersion(body.tenantCode, body.version, body.url, body.content);
  }

  @Get('messages/:id')
  getMessage(@Query('tenantCode') tenantCode: string, @Param('id') id: string) {
    return this.crm.getMessage(tenantCode, id);
  }

  @Get('countries/:countryName')
  getCountry(@Query('tenantCode') tenantCode: string, @Param('countryName') countryName: string) {
    return this.crm.getCountry(tenantCode, countryName);
  }

  @Get('menus/selected/:userKey')
  getUserMenuIds(@Query('tenantCode') tenantCode: string, @Param('userKey') userKey: string) {
    return this.crm.getUserMenuIds(tenantCode, Number(userKey));
  }

  @Post('menus/auth')
  menuAuth(@Body() body: MenuAuthDto) {
    return this.crm.menuAuth(body.tenantCode, body.userKey, body.companyCode, body.menuKey, body.authStatus);
  }

  // ---- guarded: needs the caller's JWT (tenant + own SAP identity) ----

  @UseGuards(JwtAuthGuard)
  @Get('users/for-crm')
  userDetailsForCrm(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.userDetailsForCrm(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:id/reporting-employees')
  getReportingEmployees(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.crm.getReportingEmployees(user.tenantCode, Number(id));
  }

  @UseGuards(JwtAuthGuard)
  @Get('items')
  itemMaster(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.itemMaster(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('customers')
  customerMaster(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.customerMaster(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('addresses')
  addressMaster(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.addressMaster(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('items/in-stock')
  getFilteredItemsInStock(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query('search') search?: string,
    @Query('mainGroup') mainGroup?: string,
    @Query('subGroup') subGroup?: string,
    @Query('whsCode') whsCode?: string,
  ) {
    return this.crm.getFilteredItemsInStock(user.tenantCode, search, mainGroup, subGroup, whsCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('items/filter')
  getFilteredItems(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query('search') search?: string,
    @Query('mainGroup') mainGroup?: string,
    @Query('subGroup') subGroup?: string,
    @Query('packSize') packSize?: string,
  ) {
    return this.crm.getFilteredItems(user.tenantCode, search, mainGroup, subGroup, packSize);
  }

  @UseGuards(JwtAuthGuard)
  @Get('items/main-groups')
  getMainGroups(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.getMainGroups(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('items/sub-groups')
  getSubGroups(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.crm.getSubGroups(user.tenantCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('plan-details')
  getPlanDetails(@CurrentUser() user: AuthenticatedRequestUser, @Query('date') date: string | undefined, @Query('slpCode') slpCode: string) {
    return this.crm.getPlanDetails(user.tenantCode, date, Number(slpCode));
  }

  @UseGuards(JwtAuthGuard)
  @Get('customers/by-salesperson/:slpCode')
  getCustomerDetailsBySalesperson(@CurrentUser() user: AuthenticatedRequestUser, @Param('slpCode') slpCode: string) {
    return this.crm.getCustomerDetailsBySalesperson(user.tenantCode, Number(slpCode));
  }

  @UseGuards(JwtAuthGuard)
  @Get('quotations/:docEntry')
  getQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.getQuotation(user.sap, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('quotations/:docEntry/full')
  getQuotationHeadLine(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.getQuotationHeadLine(user.tenantCode, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('quotations/:docEntry/details')
  getQuotationDetails(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.getQuotationDetails(user.tenantCode, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:docEntry/details')
  getOrderDetails(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.getOrderDetails(user.tenantCode, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Get('drafts/:docEntry/details')
  getDraftDetails(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.getDraftDetails(user.tenantCode, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Post('drafts/:docEntry/save')
  saveDraft(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string) {
    return this.crm.saveDraftAsDocument(user.sap, Number(docEntry));
  }

  @UseGuards(JwtAuthGuard)
  @Post('discounts/order')
  discountCalcOrder(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcOrder(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('discounts/order/abstract')
  discountCalcOrderAbstract(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcOrderAbstract(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('discounts/quotation')
  discountCalcQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcQuotation(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('discounts/quotation/abstract')
  discountCalcQuotationAbstract(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: DiscountCalcRequest) {
    return this.crm.discountCalcQuotationAbstract(user.tenantCode, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('customers/sap')
  createCustomer(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: BusinessPartnerRequest) {
    return this.crm.createCustomer(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('quotations')
  createQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: QuotationRequest) {
    return this.crm.createQuotation(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('quotations/:docEntry')
  updateQuotation(@CurrentUser() user: AuthenticatedRequestUser, @Param('docEntry') docEntry: string, @Body() body: QuotationRequest) {
    return this.crm.updateQuotation(user.sap, Number(docEntry), body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sales-orders')
  createSalesOrder(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: SalesOrderModel) {
    return this.crm.createSalesOrder(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('activities')
  createActivity(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: ActivitesDTO) {
    return this.crm.createActivity(user.sap, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('activities/:clgCode')
  updateActivity(@CurrentUser() user: AuthenticatedRequestUser, @Param('clgCode') clgCode: string, @Body() body: ActivitesDTO) {
    return this.crm.updateActivity(user.sap, Number(clgCode), body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('activities/:clgCode/check-in')
  checkIn(@CurrentUser() user: AuthenticatedRequestUser, @Param('clgCode') clgCode: string, @Body() body: CheckedInDTO) {
    return this.crm.checkIn(user.sap, Number(clgCode), body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('activities/:clgCode/check-out')
  checkOut(@CurrentUser() user: AuthenticatedRequestUser, @Param('clgCode') clgCode: string, @Body() body: CheckedoutDTO) {
    return this.crm.checkOut(user.sap, Number(clgCode), body);
  }
}
