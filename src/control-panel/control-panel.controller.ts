import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { ControlPanelService } from './control-panel.service.js';
import { CatalogueDto, EditUserDto, NotificationDto } from './dto/control-panel.dto.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { CurrentAdmin } from './current-admin.decorator.js';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

@Controller('control-panel')
export class ControlPanelController {
  constructor(private readonly controlPanel: ControlPanelService) {}

  // Only unauthenticated route: exchanges UserName/Password for an admin JWT.
  @Get('login')
  login(@Query('tenantCode') tenantCode: string, @Query('userName') userName: string, @Query('password') password: string) {
    return this.controlPanel.loginCheck(tenantCode, userName, password);
  }

  @UseGuards(AdminAuthGuard)
  @Get('attendance')
  attendanceInfo(@CurrentAdmin() admin: AdminJwtPayload, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) {
    return this.controlPanel.attendanceInfo(admin.tenantCode, fromDate, toDate);
  }

  @UseGuards(AdminAuthGuard)
  @Get('roles/:userRoll')
  userRoll(@CurrentAdmin() admin: AdminJwtPayload, @Param('userRoll') userRoll: string) {
    return this.controlPanel.userRoll(admin.tenantCode, Number(userRoll));
  }

  @UseGuards(AdminAuthGuard)
  @Get('users/:id')
  userDetails(@CurrentAdmin() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.controlPanel.userDetailsFromUserCode(admin.tenantCode, id);
  }

  @UseGuards(AdminAuthGuard)
  @Post('users')
  editUser(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: EditUserDto) {
    return this.controlPanel.editUser(admin.tenantCode, body);
  }

  @UseGuards(AdminAuthGuard)
  @Get('users/:id/reporting-employees')
  reportingEmployees(@CurrentAdmin() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.controlPanel.reportingEmployees(admin.tenantCode, id);
  }

  @UseGuards(AdminAuthGuard)
  @Get('users')
  userNames(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.controlPanel.userNames(admin.tenantCode);
  }

  @UseGuards(AdminAuthGuard)
  @Post('notifications')
  sendNotification(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: NotificationDto) {
    return this.controlPanel.sendNotification(admin.tenantCode, body);
  }

  @UseGuards(AdminAuthGuard)
  @Post('catalogue')
  sendCatalogue(@CurrentAdmin() admin: AdminJwtPayload, @Body() body: CatalogueDto) {
    return this.controlPanel.sendCatalogue(admin.tenantCode, body);
  }

  @UseGuards(AdminAuthGuard)
  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return { status: true, message: 'Success', data: { path: file.path } };
  }
}
