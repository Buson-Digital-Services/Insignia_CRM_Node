import { Body, Controller, Get, HttpCode, Param, ParseArrayPipe, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { ControlPanelService } from './control-panel.service.js';
import { BulkActivityDto, CatalogueDto, EditUserDto, NotificationDto } from './dto/control-panel.dto.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { CurrentAdmin } from './current-admin.decorator.js';
import { ShopCode, int } from '../tenant/shop-code.decorator.js';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

// Route names/methods/parameters are the legacy .NET ControlPanelController's (plus
// ServiceLayerController's createActivity). Unlike the legacy API, everything except the
// login needs the admin JWT that GetLogin returns.
@Controller()
export class ControlPanelController {
  constructor(private readonly controlPanel: ControlPanelService) {}

  // Only unauthenticated route: exchanges UserName/Password for an admin JWT.
  @Get('GetLogin/:UserName/:Password')
  login(@ShopCode() shop: string, @Param('UserName') userName: string, @Param('Password') password: string) {
    return this.controlPanel.loginCheck(shop, userName, password);
  }

  @UseGuards(AdminAuthGuard)
  @Get('GetAttendenceInfo/:fromdate/:todate')
  attendanceInfo(@CurrentAdmin() admin: AdminJwtPayload, @Param('fromdate') fromDate: string, @Param('todate') toDate: string) {
    return this.controlPanel.attendanceInfo(admin.tenantCode, fromDate, toDate);
  }

  @UseGuards(AdminAuthGuard)
  @Get('Rolldetails/:UserRoll')
  userRoll(@CurrentAdmin() admin: AdminJwtPayload, @Param('UserRoll') userRoll: string) {
    return this.controlPanel.userRoll(admin.tenantCode, int('UserRoll', userRoll));
  }

  @UseGuards(AdminAuthGuard)
  @Get('UserDetailsFromUserCode/:Id')
  userDetails(@CurrentAdmin() admin: AdminJwtPayload, @Param('Id') id: string) {
    return this.controlPanel.userDetailsFromUserCode(admin.tenantCode, id);
  }

  @UseGuards(AdminAuthGuard)
  @Post('EditUser')
  @HttpCode(200)
  editUser(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: EditUserDto) {
    return this.controlPanel.editUser(admin.tenantCode, body);
  }

  @UseGuards(AdminAuthGuard)
  @Get('ReportEmp/:Id')
  reportingEmployees(@CurrentAdmin() admin: AdminJwtPayload, @Param('Id') id: string) {
    return this.controlPanel.reportingEmployees(admin.tenantCode, id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('UserNames')
  userNames(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.controlPanel.userNames(admin.tenantCode);
  }

  @UseGuards(AdminAuthGuard)
  @Post('Notification')
  @HttpCode(200)
  sendNotification(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: NotificationDto) {
    return this.controlPanel.sendNotification(admin.tenantCode, body);
  }

  @UseGuards(AdminAuthGuard)
  @Post('Catalogue')
  @HttpCode(200)
  sendCatalogue(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: CatalogueDto) {
    return this.controlPanel.sendCatalogue(admin.tenantCode, body);
  }

  // Legacy ServiceLayerController POST createActivity (Activities Excel Sync page). Body is the raw row array.
  @UseGuards(AdminAuthGuard)
  @Post('createActivity')
  @HttpCode(200)
  @ApiBody({ type: [BulkActivityDto] })
  bulkCreateActivities(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body(new ParseArrayPipe({ items: BulkActivityDto, whitelist: true, forbidNonWhitelisted: true })) rows: BulkActivityDto[],
  ) {
    return this.controlPanel.bulkCreateActivities(admin.tenantCode, rows);
  }

  // Legacy saveAllFiles(IFormFile File): multipart upload, any field name.
  @UseGuards(AdminAuthGuard)
  @Post('saveAllFiles')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { File: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  uploadFile(@UploadedFiles() files: Express.Multer.File[]) {
    return { status: true, message: 'Success', data: { path: files?.[0]?.path } };
  }
}
