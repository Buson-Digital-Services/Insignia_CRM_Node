import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AttendanceService, AttendanceDto } from './attendance.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequestUser } from '../common/types.js';

// Legacy .NET AttendenceController: POST AttendenceInfo.
@Controller()
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('AttendenceInfo')

  @HttpCode(200)
  record(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: AttendanceDto) {
    return this.attendance.record(user.tenantCode, body);
  }
}
