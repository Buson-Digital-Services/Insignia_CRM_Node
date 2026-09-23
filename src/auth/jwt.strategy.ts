import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SapIdentityCache } from './sap-identity-cache.service.js';
import type { AuthenticatedRequestUser, JwtPayload } from '../common/types.js';
import type { AdminJwtPayload } from '../control-panel/admin-jwt-payload.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly sapIdentityCache: SapIdentityCache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload | AdminJwtPayload): AuthenticatedRequestUser | AdminJwtPayload {
    // Admin-panel tokens (Control Panel) share this same strategy/secret but
    // carry no SAP identity to attach - AdminAuthGuard is what actually
    // gates access to admin routes based on `role`.
    if (!('sub' in payload)) {
      return payload;
    }

    // The JWT never carries the SAP password (see AuthService.login) - it's
    // re-attached here from the server-side cache populated at login time.
    const sap = this.sapIdentityCache.get(payload.sub);
    if (!sap) {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    return { ...payload, sap };
  }
}
