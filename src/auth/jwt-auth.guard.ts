import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { unauthorized } from './auth-failure.js';
import type { AuthenticatedRequestUser } from '../common/types.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Rejects admin-panel tokens here too - they share the same secret/strategy
  // but must never be usable against the mobile app's own routes (they carry
  // no SAP identity, and belong to a different trust boundary entirely).
  handleRequest<TUser = AuthenticatedRequestUser>(err: unknown, user: AuthenticatedRequestUser | false, info: unknown, context: ExecutionContext): TUser {
    if (err || !user || !('sap' in user)) {
      throw unauthorized(err, user ? undefined : info);
    }
    // A token only works under its own shop's localURL (http://<host>/api/<Country>/...).
    const req = context.switchToHttp().getRequest<{ tenantFromUrl?: string }>();
    if (req.tenantFromUrl && req.tenantFromUrl !== user.tenantCode) {
      throw new ForbiddenException('This login belongs to a different country');
    }
    return user as TUser;
  }
}
