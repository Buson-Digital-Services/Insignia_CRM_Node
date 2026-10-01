import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import type { InsigRes } from '../common/types.js';
import type { UserDetailsDto } from '../crm/dto/crm.dto.js';
import type { BulkActivityDto, CatalogueDto, EditUserDto, NotificationDto } from './dto/control-panel.dto.js';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

@Injectable()
export class ControlPanelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly sap: SapService,
    private readonly tenants: TenantService,
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
    const payload: AdminJwtPayload = { role: 'admin', tenantCode: this.tenants.get(tenantCode).code, userName };
    return { status: true, message: 'Success', data: { accessToken: await this.jwt.signAsync(payload) } };
  }

  async attendanceInfo(tenantCode: string, fromDate: string, toDate: string) {
    return this.db.execProc(tenantCode, 'app', 'AttendenceUser', { fromdate: fromDate, todate: toDate });
  }

  async userRoll(tenantCode: string, userRoll: number) {
    return this.db.execProc(tenantCode, 'app', 'GetReportTo', { Id: userRoll });
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
      const [header] = await execProc<{ Id: number }>('Nt_InsertHeader', {
        FromUserID: nt.FromUserId,
        MsgHeading: nt.MsgHeading,
        MsgDescription: nt.Description,
        ImgUrl: nt.ImageUrl ?? null,
      });
      if (!header) {
        return { status: false, message: 'No data found' };
      }
      for (const recipient of nt.ListUser) {
        // Nt_GetMsg joins Nt_List.NtHeaderId = Nt_Header.Id - the legacy code passed the
        // sender's FromUserID here, so recipients never saw the message.
        await execProc('Nt_HeaderList', {
          NtHeaderId: header.Id,
          ToUserId: recipient.Id,
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

  // Port of legacy SLayer/Company.cs CreateActivities: runs as the shop-wide
  // SAP account (TENANT_<CODE>_SAP_*), checks every CardCode exists before
  // posting anything, then posts row by row. SAP has no multi-document
  // transaction over Service Layer, so a mid-batch failure reports which rows
  // already went in rather than pretending to roll back.
  async bulkCreateActivities(tenantCode: string, rows: BulkActivityDto[]): Promise<InsigRes<{ created: number[] }>> {
    const sap = this.tenants.get(tenantCode).sap;

    for (const row of rows) {
      const key = encodeURIComponent(row.CardCode.replace(/'/g, "''"));
      try {
        await this.sap.request(sap, 'get', `BusinessPartners('${key}')?$select=CardCode`);
      } catch (err) {
        return { status: false, message: `Invalid Customer Code (${row.CardCode}): ${(err as Error).message}`, data: { created: [] } };
      }
    }

    const created: number[] = [];
    for (const row of rows) {
      try {
        const activity = await this.sap.request<{ ClgCode: number }>(sap, 'post', 'Activities', {
          ...row,
          U_Status: row.U_Status ?? 'A',
          U_IsPlanned: row.U_IsPlanned ?? 'Yes',
        });
        created.push(activity.ClgCode);
      } catch (err) {
        return {
          status: false,
          message: `Error on creating activity for Card Code ${row.CardCode} (${created.length} of ${rows.length} already created): ${(err as Error).message}`,
          data: { created },
        };
      }
    }
    return { status: true, message: 'Activity created successfully.', data: { created } };
  }
}
