// Shared request-scoped context types. A "tenant" = one country/shop deployment's DB.
// SAP identity is NOT tenant-wide - it comes from the logged-in user's own row
// (SAPUrl/SapDB/SAPUserName/SAPPassword), since different users/branches in the
// same country DB can point at different SAP company databases.

export interface SqlConnectionConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  domain?: string; // set => Windows (NTLM) login for `user`; unset => SQL Server login
}

export interface TenantConfig {
  code: string; // e.g. "TZ"
  name: string; // e.g. "Tanzania"
  db: SqlConnectionConfig; // app DB: Users, MenuAuth, notifications, versions...
  sapDb: SqlConnectionConfig; // SAP-side mirror DB: items, customers, quotations, discount schemes...
  urls: CountryUrls; // returned by GET /api/GetUrls/:country before login
  // Rewrites the Service Layer address stored on users' rows (SAPUrl) without touching the DB,
  // e.g. Kenya: https://insigniadxb.fortiddns.com:50000 -> https://192.168.10.22:50000 (the name on its certificate).
  sapUrlRedirect?: { from: string[]; to: string };
  // While testing: ignore the SAPUrl stored on users' rows and connect every user to `sap.sapUrl` (TENANT_<CODE>_SAP_URL).
  sapUrlFromEnv?: boolean;
  // Live-SAP protection while testing: every user's SAP session uses this company instead of
  // the SapDB on their Users row (which points at the live company). Remove it to go live.
  sapCompanyDbForUsers?: string;
  sap: SapIdentity; // shop-wide Service Layer account, only for admin jobs (Control Panel bulk activity upload)
}

export type DbKind = 'app' | 'sapDb';

export interface CountryUrls {
  countryName: string;
  queryURL: string;
  localURL: string; // base URL the Flutter app appends GetLoginDetails/... to
  reportURL: string;
  schemeReq: boolean;
}

export interface SapIdentity {
  sapUrl: string; // Service Layer base URL, e.g. http://host:port/b1s/v1/
  sapCompanyDb: string;
  sapUsername: string;
  sapPassword: string;
}

// Public-safe user summary returned in the login HTTP response body -
// deliberately excludes SapIdentity, which never leaves the server.
export interface AuthenticatedUser {
  id: number;
  userCode: string;
  tenantCode: string;
}

// Shape actually carried inside the signed JWT. Deliberately excludes
// SapIdentity - a JWT is only *signed*, not encrypted, so its payload is
// trivially base64-readable by anyone holding the token (e.g. on the phone).
// The SAP password never leaves the server.
export interface JwtPayload {
  sub: number;
  userCode: string;
  tenantCode: string;
}

// What the mobile login JWT actually carries - JwtStrategy decrypts it into a JwtPayload.
export interface SignedLoginToken {
  encryptedClaims: string;
}

// What @CurrentUser() actually returns to a controller: the JWT claims plus
// the caller's SAP identity, re-attached server-side per request from
// SapIdentityCache (see jwt.strategy.ts) rather than trusted from the token.
export interface AuthenticatedRequestUser extends JwtPayload {
  sap: SapIdentity;
}

// Legacy response envelope every ported endpoint mirrors, so the existing
// mobile app (which already parses {status, message, data}) needs no changes.
export interface InsigRes<T = unknown> {
  status: boolean;
  message: string;
  data?: T;
}
