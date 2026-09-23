import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequestUser } from '../common/types.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Rejects admin-panel tokens here too - they share the same secret/strategy
  // but must never be usable against the mobile app's own routes (they carry
  // no SAP identity, and belong to a different trust boundary entirely).
  handleRequest<TUser = AuthenticatedRequestUser>(err: unknown, user: AuthenticatedRequestUser | false): TUser {
    if (err || !user || !('sap' in user)) {
      throw new UnauthorizedException();
    }
    return user as TUser;
  }
}
