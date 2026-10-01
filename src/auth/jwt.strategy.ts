import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { effectiveSapUrl } from '../tenant/sap-url.js';
import { NAME_ID_CLAIM, decryptClaims } from './claims-cipher.js';
import type { AuthenticatedRequestUser, JwtPayload, SignedLoginToken } from '../common/types.js';
import type { AdminJwtPayload } from '../control-panel/admin-jwt-payload.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly claimsKey: string;

  constructor(
    config: ConfigService,
    private readonly sapIdentityCache: SapIdentityCache,
    private readonly tenants: TenantService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
    this.claimsKey = config.getOrThrow<string>('JWT_CLAIMS_KEY');
  }

  validate(token: SignedLoginToken | AdminJwtPayload): AuthenticatedRequestUser | AdminJwtPayload {
    // Admin-panel tokens (Control Panel) share this same strategy/secret but
    // carry no SAP identity to attach - AdminAuthGuard is what actually
    // gates access to admin routes based on `role`.
    if ('role' in token) {
      return token;
    }

    let payload: JwtPayload;
    let claims: Record<string, string>;
    try {
      claims = decryptClaims(this.claimsKey, token.encryptedClaims);
      payload = { sub: Number(claims.Id), userCode: claims[NAME_ID_CLAIM], tenantCode: claims.TenantCode };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // The user's SAP session lives in a server-side cache filled at login (SapLogin can switch it).
    // After a restart or deploy the cache is empty, so rebuild it from the signed, encrypted claims
    // the login put in this token instead of logging everyone out.
    let sap = this.sapIdentityCache.get(payload.sub);
    if (!sap) {
      const tenant = this.tenants.find(payload.tenantCode);
      if (!tenant || !claims.SAPUserName || !claims.SAPPassword || !claims.SAPUrl || !claims.SapDB) {
        throw new UnauthorizedException('Session expired, please log in again');
      }
      sap = { sapUrl: effectiveSapUrl(tenant, claims.SAPUrl), sapCompanyDb: claims.SapDB, sapUsername: claims.SAPUserName, sapPassword: claims.SAPPassword };
      this.sapIdentityCache.set(payload.sub, sap);
    }
    return { ...payload, sap };
  }
}
