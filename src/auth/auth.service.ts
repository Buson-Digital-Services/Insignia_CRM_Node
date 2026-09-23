import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import type { AuthenticatedUser, JwtPayload } from '../common/types.js';
import type { LoginDto } from './dto/login.dto.js';

interface UserRow {
  Id: number;
  UserCode: string;
  UserName: string;
  Branch: string;
  Email: string;
  SAPUserName: string;
  SAPPassword: string;
  SAPUrl: string;
  SapDB: string;
  SlpCode: string;
  Active: string;
}

export interface CountryRow {
  CountryName: string;
  QueryURL: string;
  LocalURL: string;
  ReportURL: string;
  SchemeReq: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sap: SapService,
    private readonly jwt: JwtService,
    private readonly sapIdentityCache: SapIdentityCache,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: AuthenticatedUser; country: CountryRow | null }> {
    // Same stored proc the legacy app calls: validates UserCode/Password and,
    // as a side effect, records the device's DeviceCode/FcmToken against the
    // user row. First recordset = matching user(s), second = that country's
    // URLs (CountryMaster row).
    const [userRows, countryRows] = await this.db.execProcSets<UserRow | CountryRow>(dto.tenantCode, 'app', 'UpdateDeviceCodetest', {
      UserCode: dto.userCode,
      Password: dto.password,
      DeviceCode: dto.deviceCode,
      FcMToken: dto.fcmToken ?? '',
      CountryName: dto.tenantCode,
    });

    const row = userRows?.[0] as UserRow | undefined;
    if (!row) {
      throw new UnauthorizedException('User Not Found');
    }

    const sapIdentity = {
      sapUrl: row.SAPUrl,
      sapCompanyDb: row.SapDB,
      sapUsername: row.SAPUserName,
      sapPassword: row.SAPPassword,
    };

    try {
      await this.sap.verifyCredentials(sapIdentity);
    } catch (err) {
      this.logger.warn(`SAP login failed for ${row.SAPUserName}/${row.SapDB}: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid SAP Credentials');
    }

    const tenantCode = dto.tenantCode.toUpperCase();

    // Keep the SAP password server-side only. The JWT (signed, not
    // encrypted) and the HTTP response body both go to the caller's device,
    // so neither may carry it - see JwtStrategy for how it's re-attached
    // per-request from this cache instead.
    this.sapIdentityCache.set(row.Id, sapIdentity);

    const payload: JwtPayload = { sub: row.Id, userCode: row.UserCode, tenantCode };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: row.Id, userCode: row.UserCode, tenantCode },
      country: (countryRows?.[0] as CountryRow | undefined) ?? null,
    };
  }
}
