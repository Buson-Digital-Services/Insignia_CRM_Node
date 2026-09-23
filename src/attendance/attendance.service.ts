import { Injectable } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';
import { DatabaseService } from '../database/database.service.js';
import type { InsigRes } from '../common/types.js';

export class AttendanceDto {
  @IsInt()
  UserId!: number;

  @IsString()
  DeviceCode!: string;

  @IsString()
  TimeStamp!: string; // ISO datetime

  @IsString()
  Latitude!: string;

  @IsString()
  Longitude!: string;

  @IsString()
  Location!: string;

  @IsString()
  Comments!: string;

  @IsInt()
  LocationType!: number;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly db: DatabaseService) {}

  async record(tenantCode: string, att: AttendanceDto): Promise<InsigRes> {
    const rows = await this.db.execProc(tenantCode, 'app', 'AttendenceInfo', {
      UserId: att.UserId,
      DeviceCode: att.DeviceCode,
      TimeStamp: att.TimeStamp,
      Latitude: att.Latitude,
      Longitude: att.Longitude,
      Location: att.Location,
      Comments: att.Comments,
      LocationType: att.LocationType,
    });
    return rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' };
  }
}
