import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AttendanceService, AttendanceDto } from './attendance.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequestUser } from '../common/types.js';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post()
  record(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: AttendanceDto) {
    return this.attendance.record(user.tenantCode, body);
  }
}
