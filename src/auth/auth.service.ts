import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { effectiveSapUrl } from '../tenant/sap-url.js';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import { NAME_ID_CLAIM, encryptClaims } from './claims-cipher.js';
import type { AuthenticatedRequestUser, AuthenticatedUser, SapIdentity, SignedLoginToken } from '../common/types.js';
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
  DeviceCode: string | null;
  QueryURL: string | null;
  FCMToken: string | null;
  VisitCount: number;
  TodayDeliveryCount: number;
  U_CrpUsr: string | null;
  U_RepotingTo: number | null;
  ManagerFCM: string | null;
  // sales order numbering series SAP would use for this user, and today's own sales orders
  Series: number | null;
  SeriesName: string | null;
  TodaySoldQty: number;
  TodaySoldAmount: number;
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
    private readonly tenants: TenantService,
    private readonly config: ConfigService,
  ) {}

  // Legacy SapLogin: checks a SAP username/password with a fresh Service Layer login. When the
  // caller is logged in to the app, their SAP session switches to these credentials (what the
  // legacy `?sapuser=` connection did); without a token it only verifies.
  async sapLogin(shop: string, sapUser: string, sapPassword: string, user?: AuthenticatedRequestUser | null): Promise<{ status: true; message: string }> {
    if (!sapUser || !sapPassword) {
      throw new BadRequestException('sapUser and sapPassword are required');
    }
    const tenant = this.tenants.get(user?.tenantCode ?? shop);
    const base: Pick<SapIdentity, 'sapUrl' | 'sapCompanyDb'> = user?.sap ?? {
      sapUrl: tenant.sap.sapUrl,
      sapCompanyDb: tenant.sapCompanyDbForUsers ?? tenant.sap.sapCompanyDb,
    };
    const identity: SapIdentity = { sapUrl: base.sapUrl, sapCompanyDb: base.sapCompanyDb, sapUsername: sapUser, sapPassword };
    try {
      await this.sap.checkCredentials(identity);
    } catch (err) {
      this.logger.warn(`SapLogin failed for ${sapUser}/${identity.sapCompanyDb}: ${(err as Error).message}`);
      if ((err as { status?: number }).status === 401) {
        throw new UnauthorizedException('Invalid SAP Credentials');
      }
      throw new BadRequestException('SAP Connection Failed');
    }
    if (user) {
      this.sapIdentityCache.set(user.sub, identity);
    }
    return { status: true, message: `SAP Connected ${sapUser}` };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; user: AuthenticatedUser; country: CountryRow | null }> {
    // Same checks as Tanzania's UpdateDeviceCodetest proc, run from here so every shop
    // works with its DBs as they are (Kenya's doesn't have that proc). Unlike the proc,
    // everything is verified read-only first; the one write (binding this device + FCM
    // token to the user row) happens only once the whole login has succeeded.
    const tenant = this.tenants.get(dto.tenantCode);
    const creds = { UserCode: dto.userCode, Password: dto.password };
    const [user] = await this.db.query<UserRow>(tenant.code, 'app', 'SELECT * FROM Users WHERE UserCode = @UserCode AND [Password] = @Password', creds);
    // Salesperson data lives in the shop's SAP DB (the proc cross-joined it by a hardcoded DB name).
    const [slp] = user
      ? await this.db.query<Pick<UserRow, 'U_CrpUsr' | 'U_RepotingTo' | 'TodayDeliveryCount' | 'VisitCount' | 'Series' | 'SeriesName' | 'TodaySoldQty' | 'TodaySoldAmount'>>(
          tenant.code,
          'sapDb',
          `SELECT b.U_CrpUsr, b.U_RepotingTo,
             (SELECT COUNT(*) FROM ODLN WHERE SlpCode = b.SlpCode AND DocDate = CAST(GETDATE() AS DATE)) AS TodayDeliveryCount,
             (SELECT COUNT(*) FROM OCLG WHERE SlpCode = b.SlpCode AND CntctDate = CAST(GETDATE() AS DATE)) AS VisitCount,
             -- today's own, non-cancelled sales orders: total quantity and total amount
             (SELECT ISNULL(SUM(l.Quantity), 0) FROM RDR1 l INNER JOIN ORDR o ON o.DocEntry = l.DocEntry
               WHERE o.SlpCode = b.SlpCode AND o.DocDate = CAST(GETDATE() AS DATE) AND o.CANCELED = 'N') AS TodaySoldQty,
             (SELECT ISNULL(SUM(o.DocTotal), 0) FROM ORDR o
               WHERE o.SlpCode = b.SlpCode AND o.DocDate = CAST(GETDATE() AS DATE) AND o.CANCELED = 'N') AS TodaySoldAmount,
             s.Series, s.SeriesName
           FROM OSLP b
           -- sales order (object 17) series SAP picks for this SAP user: their own default, else the company default
           OUTER APPLY (
             SELECT TOP 1 n.Series, n.SeriesName FROM NNM1 n
             WHERE n.Series = COALESCE(
               (SELECT TOP 1 d.Series FROM NNM2 d INNER JOIN OUSR u ON u.USERID = d.UserSign WHERE u.USER_CODE = @SapUser AND d.ObjectCode = '17'),
               (SELECT TOP 1 DfltSeries FROM ONNM WHERE ObjectCode = '17'))
           ) s
           WHERE b.SlpCode = @SlpCode`,
          { SlpCode: user.SlpCode, SapUser: (user.SAPUserName ?? '').trim() },
        )
      : [];
    const [manager] = slp
      ? await this.db.query<Pick<UserRow, 'ManagerFCM'>>(tenant.code, 'app', "SELECT TOP 1 NULLIF(FCMToken, '') AS ManagerFCM FROM Users WHERE SlpCode = @SlpCode", {
          SlpCode: slp.U_RepotingTo,
        })
      : [];

    // The proc inner-joined the salesperson and their reporting manager, so a user
    // missing either came back as "not found" - keep that.
    if (!user || !slp || !manager) {
      throw new UnauthorizedException('User Not Found');
    }
    const row: UserRow = { ...user, ...slp, ...manager };
    const [countryRow] = await this.db.query<CountryRow>(tenant.code, 'app', 'SELECT * FROM CountryMaster WHERE CountryName = @CountryName', {
      CountryName: tenant.name, // keyed by name, e.g. 'Tanzania'
    });

    const sapIdentity = {
      sapUrl: effectiveSapUrl(tenant, row.SAPUrl),
      sapCompanyDb: tenant.sapCompanyDbForUsers ?? row.SapDB,
      sapUsername: row.SAPUserName,
      sapPassword: row.SAPPassword,
    };

    try {
      await this.sap.verifyCredentials(sapIdentity);
    } catch (err) {
      this.logger.warn(`SAP login failed for ${row.SAPUserName}/${sapIdentity.sapCompanyDb}: ${(err as Error).message}`);
      // Only a 401 from SAP means wrong credentials. Unreachable / timed out must not send people to reset passwords.
      if ((err as { status?: number }).status === 401) {
        throw new UnauthorizedException('Invalid SAP Credentials');
      }
      throw new BadRequestException('SAP Connection Failed');
    }

    const fcmToken = dto.fcmToken ?? '';
    await this.db.query(tenant.code, 'app', 'UPDATE Users SET DeviceCode = @DeviceCode, FCMToken = @FcMToken WHERE UserCode = @UserCode AND [Password] = @Password', {
      ...creds,
      DeviceCode: dto.deviceCode,
      FcMToken: fcmToken,
    });
    row.DeviceCode = dto.deviceCode;
    row.FCMToken = fcmToken;

    const tenantCode = tenant.code;

    // The API itself never trusts SAP creds from the token - JwtStrategy
    // re-attaches them per request from this server-side cache.
    this.sapIdentityCache.set(row.Id, sapIdentity);

    // Same claim set/names as the legacy GenerateToken (which the web dashboard
    // decrypts) plus TenantCode, which JwtStrategy needs to route to the shop's DB.
    const country = countryRow ?? null;
    const urls = tenant.urls;
    const s = (v: unknown) => (v == null ? '' : String(v));
    const encryptedClaims = encryptClaims(this.config.getOrThrow<string>('JWT_CLAIMS_KEY'), {
      [NAME_ID_CLAIM]: s(row.UserCode),
      UserName: s(row.UserName),
      Id: s(row.Id),
      Branch: s(row.Branch),
      DeviceCode: s(row.DeviceCode),
      Email: s(row.Email),
      SAPUserName: s(row.SAPUserName),
      SAPPassword: s(row.SAPPassword),
      SAPUrl: s(row.SAPUrl), // as stored in the database
      SapDB: s(sapIdentity.sapCompanyDb), // the company this session really uses
      SlpCode: s(row.SlpCode),
      QueryURL: s(row.QueryURL),
      FCMToken: s(row.FCMToken),
      Active: s(row.Active),
      VisitCount: s(row.VisitCount ?? 0),
      DeliveryCount: s(row.TodayDeliveryCount ?? 0),
      Series: s(row.Series),
      SeriesName: s(row.SeriesName),
      TodaySoldQty: s(row.TodaySoldQty ?? 0),
      TodaySoldAmount: s(row.TodaySoldAmount ?? 0),
      // Same URLs GetUrls returned (.env), so the app keeps calling this API via Localurl.
      // (Shop DBs' CountryMaster rows still point at the old .NET servers.)
      Queryurl: s(urls.queryURL),
      Localurl: s(urls.localURL),
      Reporturl: s(urls.reportURL),
      TenantCode: tenantCode,
    });

    const payload: SignedLoginToken = { encryptedClaims }; // nothing readable without the key

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: row.Id, userCode: row.UserCode, tenantCode },
      country,
    };
  }
}
