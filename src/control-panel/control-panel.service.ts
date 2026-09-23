import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import type { InsigRes } from '../common/types.js';
import type { UserDetailsDto } from '../crm/dto/crm.dto.js';
import type { CatalogueDto, EditUserDto, NotificationDto } from './dto/control-panel.dto.js';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

@Injectable()
export class ControlPanelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  private async proc<T = Record<string, unknown>>(tenantCode: string, procName: string, params: Record<string, unknown> = {}) {
    const rows = await this.db.execProc<T>(tenantCode, 'app', procName, params);
    return rows.length > 0 ? { status: true, message: 'Success', data: rows } : { status: false, message: 'No data found' };
  }

  async loginCheck(tenantCode: string, userName: string, password: string): Promise<InsigRes<{ accessToken: string }>> {
    const rows = await this.db.execProc(tenantCode, 'app', 'CtrlLogin', { UserName: userName, Password: password });
    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: AdminJwtPayload = { role: 'admin', tenantCode: tenantCode.toUpperCase(), userName };
    return { status: true, message: 'Success', data: { accessToken: await this.jwt.signAsync(payload) } };
  }

  async attendanceInfo(tenantCode: string, fromDate: string, toDate: string) {
    return this.db.execProc(tenantCode, 'app', 'AttendenceUser', { fromdate: fromDate, todate: toDate });
  }

  async userRoll(tenantCode: string, userRoll: number) {
    return this.db.execProc(tenantCode, 'app', 'GetReportTo', { UserRoll: userRoll });
  }

  async userDetailsFromUserCode(tenantCode: string, id: string) {
    return this.db.execProc<UserDetailsDto>(tenantCode, 'app', 'USerDetatailsFromUserCode', { Id: id });
  }

  editUser(tenantCode: string, user: EditUserDto): Promise<InsigRes> {
    return this.proc(tenantCode, 'EditUser', {
      Id: user.Id,
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
    });
  }

  async reportingEmployees(tenantCode: string, id: string) {
    return this.db.execProc(tenantCode, 'app', 'GetReportingEmployees', { Id: id });
  }

  async userNames(tenantCode: string) {
    return this.db.query(tenantCode, 'app', 'SELECT Id, UserName FROM Users');
  }

  async sendNotification(tenantCode: string, nt: NotificationDto): Promise<InsigRes> {
    return this.db.withTransaction(tenantCode, 'app', async (execProc) => {
      const [header] = await execProc<{ FromUserID: number }>('Nt_InsertHeader', {
        FromUserId: nt.FromUserId,
        MsgHeading: nt.MsgHeading,
        Description: nt.Description,
        ImageUrl: nt.ImageUrl ?? null,
      });
      if (!header) {
        return { status: false, message: 'No data found' };
      }
      for (const recipient of nt.ListUser) {
        await execProc('Nt_HeaderList', {
          FromUserID: header.FromUserID,
          UserId: recipient.Id,
          IsSeen: recipient.IsSeen ?? false,
        });
      }
      return { status: true, message: 'Success' };
    });
  }

  async sendCatalogue(tenantCode: string, nt: CatalogueDto): Promise<InsigRes> {
    return this.db.withTransaction(tenantCode, 'app', async (execProc) => {
      const [header] = await execProc<{ Id: number }>('Ct_Header', {
        FromUserId: nt.FromUserId,
        MsgHeader: nt.MsgHeader,
        MsgDescription: nt.MsgDescription,
      });
      if (!header) {
        return { status: false, message: 'No data found' };
      }
      for (const recipient of nt.ListUser) {
        await execProc('Ct_InsertUserlist', {
          HeaderId: header.Id,
          UserId: recipient.Id,
          IsSeen: recipient.IsSeen ?? false,
        });
      }
      if (nt.AttachmentLists) {
        await execProc('Ct_InsertAttachment', {
          HeaderId: header.Id,
          FileName: nt.AttachmentLists.FileName,
          FileType: nt.AttachmentLists.FileType,
          FileUrl: nt.AttachmentLists.FileUrl,
        });
      }
      return { status: true, message: 'Success' };
    });
  }
}
